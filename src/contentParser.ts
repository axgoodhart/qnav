/**
 * Content parser
 *
 * Reads the actual contents of a single file (HTML, JS/TS, Python, CSS, MD)
 * and extracts the signals the metadata layer cares about:
 *   - human-readable title / description
 *   - imported / sourced libraries (CDN, npm, py)
 *   - "API" usage (web audio, midi, three.js mesh, openai chat completions, ...)
 *   - whether the file is just a stub / sandbox
 *   - whether the file looks "polished" (very likely LLM-generated or templated)
 *   - whether the file mixes HTML+CSS+JS in one
 *
 * Everything is best-effort, fast, and never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface ContentSignals {
  title?: string;
  description?: string;
  libraries: string[];     // human-readable library names: "Three.js", "Tone.js", ...
  apis: string[];          // capability tags: "webaudio", "midi", "mesh", "shader", "chat-completions", ...
  hasInlineCss: boolean;
  hasInlineJs: boolean;
  hasInlineHtml: boolean;
  isStub: boolean;
  polish: number;          // 0..1 — higher means more "templated/AI-written" looking
  sizeBytes: number;
  lineCount: number;
  language: string;        // 'html' | 'javascript' | 'typescript' | 'python' | 'css' | 'swift' | 'markdown' | 'unknown'
}

const DEFAULT_SIGNALS = (): ContentSignals => ({
  libraries: [],
  apis: [],
  hasInlineCss: false,
  hasInlineJs: false,
  hasInlineHtml: false,
  isStub: false,
  polish: 0,
  sizeBytes: 0,
  lineCount: 0,
  language: 'unknown',
});

/* ------------------------------------------------------------------ */
/*  Library catalog                                                    */
/* ------------------------------------------------------------------ */

/**
 * Map of url-fragment / package-name → friendly library label.
 * Order matters: more-specific patterns are checked first.
 */
const LIBRARY_PATTERNS: Array<[RegExp, string]> = [
  // 3D / WebGL / shaders
  [/three(?:[.-]min)?\.js|three@|\bthree\b/i, 'Three.js'],
  [/babylonjs?|babylon@/i, 'Babylon.js'],
  [/pixi(?:js)?@?/i, 'Pixi.js'],
  [/regl@?/i, 'regl'],
  [/troika-three/i, 'Troika'],

  // Audio / music
  [/tone(?:[.-]min)?\.js|tone@/i, 'Tone.js'],
  [/howler/i, 'Howler.js'],
  [/wavesurfer/i, 'Wavesurfer.js'],
  [/peaks(?:js)?/i, 'Peaks.js'],
  [/soundfont-player/i, 'soundfont-player'],
  [/abcjs/i, 'abcjs'],
  [/vexflow/i, 'VexFlow'],

  // Generative / creative coding
  [/p5(?:[.-]min)?\.js|\bp5@/i, 'p5.js'],
  [/processing(?:[.-]min)?\.js/i, 'Processing.js'],
  [/two(?:[.-]min)?\.js/i, 'Two.js'],
  [/paper(?:[.-]min)?\.js/i, 'Paper.js'],

  // Animation
  [/gsap|greensock/i, 'GSAP'],
  [/anime(?:[.-]min)?\.js/i, 'anime.js'],
  [/lottie/i, 'Lottie'],
  [/motion(?:[.-]min)?\.js|framer-motion/i, 'Motion'],
  [/popmotion/i, 'Popmotion'],

  // Visualization
  [/d3(?:[.-]min)?\.js|d3@|\bd3-/i, 'D3'],
  [/chart(?:[.-]min)?\.js|chartjs/i, 'Chart.js'],
  [/recharts/i, 'Recharts'],
  [/echarts/i, 'ECharts'],
  [/plotly/i, 'Plotly'],
  [/visx/i, 'visx'],

  // 2D physics / games
  [/matter(?:[.-]min)?\.js/i, 'Matter.js'],
  [/cannon(?:[.-]min)?\.js|cannon-es/i, 'Cannon.js'],
  [/phaser/i, 'Phaser'],
  [/kaboom/i, 'Kaboom.js'],
  [/excalibur/i, 'Excalibur'],

  // Fancy backgrounds / effects
  [/vanta/i, 'Vanta'],
  [/particles(?:[.-]min)?\.js|tsparticles/i, 'particles.js'],

  // Frameworks / UI libs
  [/\breact\b|react@|react-dom/i, 'React'],
  [/\bvue\b|vue@/i, 'Vue'],
  [/\bsvelte\b|svelte@/i, 'Svelte'],
  [/\bnext\b|next@/i, 'Next.js'],
  [/\bnuxt\b|nuxt@/i, 'Nuxt'],
  [/\bastro\b|astro@/i, 'Astro'],
  [/\bsolid-js\b|solid@/i, 'Solid'],
  [/\bqwik\b|qwik@/i, 'Qwik'],
  [/\blit\b|lit@|lit-element|lit-html/i, 'Lit'],
  [/preact/i, 'Preact'],
  [/alpinejs?|alpine@/i, 'Alpine.js'],
  [/htmx/i, 'htmx'],
  [/jquery/i, 'jQuery'],
  [/bootstrap/i, 'Bootstrap'],
  [/tailwind/i, 'Tailwind'],
  [/material-ui|@mui/i, 'Material UI'],
  [/shoelace|@shoelace-style/i, 'Shoelace'],
  [/daisyui/i, 'DaisyUI'],

  // PDF
  [/pdf(?:[.-]min)?\.js|pdfjs/i, 'PDF.js'],
  [/pdf-lib/i, 'pdf-lib'],

  // Editor / code
  [/codemirror/i, 'CodeMirror'],
  [/monaco-editor/i, 'Monaco'],
  [/ace(?:[.-]min)?\.js/i, 'Ace Editor'],
  [/prosemirror/i, 'ProseMirror'],
  [/quill/i, 'Quill'],

  // Build / runtime
  [/\bvite\b|vite@/i, 'Vite'],
  [/\bremotion\b|remotion@/i, 'Remotion'],
  [/electron/i, 'Electron'],
  [/tauri/i, 'Tauri'],
  [/firebase/i, 'Firebase'],
  [/supabase/i, 'Supabase'],

  // AI / LLM clients
  [/openai/i, 'OpenAI SDK'],
  [/@anthropic-ai|anthropic-sdk/i, 'Anthropic SDK'],
  [/langchain/i, 'LangChain'],
  [/transformers(?:\.js)?/i, 'Transformers.js'],
];

/**
 * "Capability" / API tags. These are higher-level than libraries —
 * they capture *what the file is doing*, regardless of which library it uses.
 */
const API_PATTERNS: Array<[RegExp, string]> = [
  [/\bAudioContext\b|webkitAudioContext|getUserMedia.*audio|new\s+AudioContext|\.createOscillator\(/, 'web-audio'],
  [/\bnavigator\.requestMIDIAccess|MIDIAccess|MIDIInput|MIDIOutput|\bWebMidi\b/, 'midi'],
  [/\bnew\s+THREE\.|THREE\.Mesh|\.Mesh\(|\bScene\(\)|PerspectiveCamera|WebGLRenderer|ShaderMaterial/, 'mesh'],
  [/precision\s+(?:mediump|highp)\s+float|gl_FragColor|gl_Position|uniform\s+(?:float|vec[234]|sampler2D)/, 'shader'],
  [/\bgetContext\(['"`]webgl/, 'webgl'],
  [/\bgetContext\(['"`]2d/, 'canvas-2d'],
  [/chat\.completions|openai\.chat|messages\.create|\/v1\/chat\/completions/, 'chat-completions'],
  [/\bsse\b|EventSource|text\/event-stream|stream:\s*true/, 'streaming'],
  [/\bspeechSynthesis|webkitSpeechRecognition|SpeechRecognition\b/, 'speech'],
  [/getUserMedia.*video|MediaStream|MediaRecorder/, 'webrtc-media'],
  [/\bnew\s+WebSocket\b|wss?:\/\//, 'websocket'],
  [/\bIntersectionObserver\b/, 'intersection-observer'],
  [/\bResizeObserver\b/, 'resize-observer'],
  [/\brequestAnimationFrame\b/, 'raf-loop'],
  [/\blocalStorage\b|\bsessionStorage\b/, 'browser-storage'],
  [/\bindexedDB\b|\bIDBDatabase\b/, 'indexeddb'],
  [/\bservice-?worker|navigator\.serviceWorker/i, 'service-worker'],
  [/<canvas[^>]*>/i, 'canvas'],
  [/<svg[^>]*>/i, 'svg'],
  [/\bdragstart\b|\bondrop\b|\bdraggable\b/i, 'drag-drop'],
  [/\bfetch\(|axios\.|\.ajax\(/, 'http-fetch'],
  [/\b(?:POST|GET|PUT|DELETE)\s+\/api\//, 'rest-api'],
  [/\bgraphql\b|\bgql`/i, 'graphql'],
];

/* ------------------------------------------------------------------ */
/*  HTML parsing                                                       */
/* ------------------------------------------------------------------ */

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractHtmlTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return;
  const text = unescapeHtml(m[1]).replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function extractHtmlMetaDescription(html: string): string | undefined {
  const m =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (!m) return;
  return unescapeHtml(m[1]).trim() || undefined;
}

function extractScriptSrcs(html: string): string[] {
  const srcs: string[] = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) srcs.push(m[1]);
  return srcs;
}

function extractLinkHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<link\b[^>]*\bhref=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) hrefs.push(m[1]);
  return hrefs;
}

function htmlHasInlineScript(html: string): boolean {
  // <script> with no src and non-empty body
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] && m[1].trim().length > 0) return true;
  }
  return false;
}

function htmlHasInlineStyle(html: string): boolean {
  return /<style\b[^>]*>[\s\S]*?<\/style>/i.test(html);
}

/* ------------------------------------------------------------------ */
/*  Library / API matching                                             */
/* ------------------------------------------------------------------ */

function matchLibraries(haystack: string): string[] {
  const found = new Set<string>();
  for (const [re, label] of LIBRARY_PATTERNS) {
    if (re.test(haystack)) found.add(label);
  }
  return [...found];
}

function matchApis(content: string): string[] {
  const found = new Set<string>();
  for (const [re, tag] of API_PATTERNS) {
    if (re.test(content)) found.add(tag);
  }
  return [...found];
}

/* ------------------------------------------------------------------ */
/*  Polish heuristic                                                   */
/* ------------------------------------------------------------------ */

/**
 * Score how "templated/AI-written" a file looks. 0 = handwritten/messy,
 * 1 = polished. Heuristics — not a classifier, just a sniff test.
 *
 *   + JSDoc / docstring header block
 *   + Section divider comments
 *   + Consistent indentation, no tab/space mixing
 *   + No trailing whitespace
 *   + Trailing newline at EOF
 *   + Sentence-cased comments (capital + period)
 *   + Uses const/let, no var
 *   + Has typed function signatures (TS) or JSDoc @param
 *   + (HTML-only) clean DOCTYPE + charset + viewport + named classes
 *   - Lots of trailing whitespace, mixed indents, var-heavy → low
 */
function scorePolish(content: string, ext: string): number {
  if (content.length < 200) return 0;
  let score = 0;
  const isHtml = ext === '.html' || ext === '.htm';
  const isJsLike = ext === '.js' || ext === '.mjs' || ext === '.cjs' ||
    ext === '.ts' || ext === '.jsx' || ext === '.tsx';

  // 1. Header comment block in the first ~15 lines
  const head = content.slice(0, 800);
  if (/^\s*\/\*\*[\s\S]+?\*\/|^\s*"""[\s\S]+?"""|^\s*'''[\s\S]+?'''/.test(head)) score += 0.18;
  if (isHtml && /<!--[\s\S]{40,}?-->/.test(head)) score += 0.10;
  if (/^\s*\/\/\s+[A-Z][^\n]{20,}/m.test(head)) score += 0.05;

  // 2. Section divider comments
  if (/\/\*[ \t]*-{4,}[\s\S]*?-{4,}[ \t]*\*\/|\/\/\s*-{4,}|<!--\s*={3,}/.test(content)) score += 0.10;

  // 3. Indentation consistency
  const allLines = content.split('\n');
  const indentedLines = allLines.filter(l => /^\s+\S/.test(l));
  if (indentedLines.length > 5) {
    const tabs = indentedLines.filter(l => l.startsWith('\t')).length;
    const twoSpace = indentedLines.filter(l => /^( {2})+\S/.test(l)).length;
    const fourSpace = indentedLines.filter(l => /^( {4})+\S/.test(l)).length;
    const dominant = Math.max(tabs, twoSpace, fourSpace);
    const ratio = dominant / indentedLines.length;
    if (ratio > 0.85) score += 0.15;
    else if (ratio > 0.65) score += 0.08;
  }

  // 4. Trailing whitespace cleanliness
  const trailingWS = allLines.filter(l => /\s+$/.test(l)).length;
  if (allLines.length > 10 && trailingWS / allLines.length < 0.05) score += 0.08;

  // 5. Trailing newline at EOF
  if (content.endsWith('\n') && !content.endsWith('\n\n\n')) score += 0.04;

  // 6. var penalty (modern JS uses const/let)
  if (isJsLike || isHtml) {
    const varCount = (content.match(/\bvar\s+/g) || []).length;
    const constLetCount = (content.match(/\b(?:const|let)\s+/g) || []).length;
    if (constLetCount > 3 && varCount === 0) score += 0.08;
    else if (varCount > constLetCount && varCount > 5) score -= 0.05;
  }

  // 7. Type annotations / JSDoc params
  if (/@param\s+\{[^}]+\}|:\s*(?:string|number|boolean|void|any|unknown)\b/.test(content)) score += 0.08;

  // 8. Sentence-cased comments (strong LLM tell)
  const commentLines = (content.match(/\/\/\s+[^\n]+/g) || []);
  if (commentLines.length >= 3) {
    const sentencey = commentLines.filter(c => /^\/\/\s+[A-Z].*[.!?]\s*$/.test(c)).length;
    if (sentencey / commentLines.length > 0.35) score += 0.10;
  }

  // 9. Heavy comment density
  const commentDensity = commentLines.length / Math.max(allLines.length, 1);
  if (commentDensity > 0.15) score += 0.05;

  // 10. HTML-specific: modern DOCTYPE + charset + viewport + semantic head
  if (isHtml) {
    if (/^\s*<!DOCTYPE html>/i.test(content)) score += 0.05;
    if (/<meta\s+charset=["']?utf-8/i.test(content)) score += 0.05;
    if (/<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width/i.test(content)) score += 0.08;
    // Named CSS classes rather than inline-style soup:
    const classCount = (content.match(/\sclass=["'][^"']+["']/g) || []).length;
    const inlineStyleCount = (content.match(/\sstyle=["'][^"']+["']/g) || []).length;
    if (classCount >= 5 && classCount > inlineStyleCount * 2) score += 0.08;
    // Semantic head tags often indicate a templated build
    if (/<meta\s+name=["']description["']/i.test(content)) score += 0.03;
  }

  // 11. "use strict" / module style at top
  if (isJsLike && /^(?:"use strict";|'use strict';|import\s)/m.test(content.slice(0, 400))) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

/* ------------------------------------------------------------------ */
/*  Stub heuristic                                                     */
/* ------------------------------------------------------------------ */

function isStubFile(content: string, ext: string, lineCount: number): boolean {
  const stripped = content.replace(/\s+/g, '');
  if (stripped.length < 200) return true;
  if (lineCount < 15) return true;

  if (ext === '.html') {
    // basically empty boilerplate?
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const bodyText = bodyMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      // No meaningful body content, no script, no style
      const hasJs = /<script\b/i.test(content);
      const hasCss = /<style\b/i.test(content) || /<link[^>]+stylesheet/i.test(content);
      if (bodyText.length < 30 && !hasJs && !hasCss) return true;
    }
    if (/Hello,?\s*world/i.test(content) && content.length < 1500) return true;
    if (/lorem ipsum/i.test(content) && content.length < 2000) return true;
  }

  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
    if (/^\s*console\.log/.test(content) && lineCount < 20) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Public API: parse a file                                           */
/* ------------------------------------------------------------------ */

const HTML_EXTS = new Set(['.html', '.htm']);
const JS_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const PY_EXTS = new Set(['.py']);
const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less']);
const SWIFT_EXTS = new Set(['.swift']);
const MD_EXTS = new Set(['.md', '.markdown']);

export function classifyExt(ext: string): string {
  ext = ext.toLowerCase();
  if (HTML_EXTS.has(ext)) return 'html';
  if (JS_EXTS.has(ext)) return 'javascript';
  if (TS_EXTS.has(ext)) return 'typescript';
  if (PY_EXTS.has(ext)) return 'python';
  if (CSS_EXTS.has(ext)) return 'css';
  if (SWIFT_EXTS.has(ext)) return 'swift';
  if (MD_EXTS.has(ext)) return 'markdown';
  return 'unknown';
}

const READABLE_EXTS = new Set<string>([
  ...HTML_EXTS, ...JS_EXTS, ...TS_EXTS, ...PY_EXTS, ...CSS_EXTS, ...SWIFT_EXTS, ...MD_EXTS,
]);

export function isReadableSource(filePath: string): boolean {
  return READABLE_EXTS.has(path.extname(filePath).toLowerCase());
}

const MAX_READ_BYTES = 256 * 1024; // 256 KB ceiling per file — keep scans fast

export async function parseFileContent(filePath: string): Promise<ContentSignals> {
  const signals = DEFAULT_SIGNALS();
  const ext = path.extname(filePath).toLowerCase();
  signals.language = classifyExt(ext);

  let content: string;
  try {
    const stat = await fs.stat(filePath);
    signals.sizeBytes = stat.size;
    if (stat.size > MAX_READ_BYTES) {
      // Read just the head — enough for libraries / title / opening comments
      const fh = await fs.open(filePath, 'r');
      try {
        const buf = Buffer.alloc(MAX_READ_BYTES);
        await fh.read(buf, 0, MAX_READ_BYTES, 0);
        content = buf.toString('utf-8');
      } finally {
        await fh.close();
      }
    } else {
      content = await fs.readFile(filePath, 'utf-8');
    }
  } catch {
    return signals;
  }

  signals.lineCount = content.length === 0 ? 0 : content.split('\n').length;

  if (signals.language === 'html') {
    signals.title = extractHtmlTitle(content);
    signals.description = extractHtmlMetaDescription(content);
    const srcs = extractScriptSrcs(content);
    const hrefs = extractLinkHrefs(content);
    signals.libraries = matchLibraries([...srcs, ...hrefs].join(' ') + '\n' + content.slice(0, 8000));
    signals.apis = matchApis(content);
    signals.hasInlineJs = htmlHasInlineScript(content);
    signals.hasInlineCss = htmlHasInlineStyle(content);
    signals.hasInlineHtml = true;
  } else if (signals.language === 'javascript' || signals.language === 'typescript') {
    // Top-of-file comment as description
    const head = content.slice(0, 1500);
    const blockComment = head.match(/^\s*\/\*\*([\s\S]+?)\*\//);
    if (blockComment) {
      const text = blockComment[1]
        .split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))
        .join(' ').trim();
      if (text) signals.description = text.slice(0, 200);
    } else {
      const lineComment = head.match(/^\s*(?:\/\/[^\n]*\n){1,5}/);
      if (lineComment) {
        const text = lineComment[0].replace(/\/\//g, '').replace(/\s+/g, ' ').trim();
        if (text.length > 10) signals.description = text.slice(0, 200);
      }
    }
    signals.libraries = matchLibraries(content);
    signals.apis = matchApis(content);
  } else if (signals.language === 'python') {
    const docstring = content.match(/^\s*(?:[ru]?["']{3})([\s\S]+?)(?:["']{3})/);
    if (docstring) signals.description = docstring[1].replace(/\s+/g, ' ').trim().slice(0, 200);
    signals.libraries = matchLibraries(content);
    signals.apis = matchApis(content);
  } else if (signals.language === 'css') {
    // not much to extract; libraries by @import
    signals.libraries = matchLibraries(content);
  } else if (signals.language === 'swift') {
    const head = content.slice(0, 1500);
    const blockComment = head.match(/^\s*\/\*\*([\s\S]+?)\*\//);
    if (blockComment) {
      signals.description = blockComment[1].replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    signals.libraries = matchLibraries(content);
    signals.apis = matchApis(content);
  } else if (signals.language === 'markdown') {
    signals.description = extractFirstMarkdownProse(content);
  }

  signals.polish = scorePolish(content, ext);
  signals.isStub = isStubFile(content, ext, signals.lineCount);

  return signals;
}

/* ------------------------------------------------------------------ */
/*  Markdown prose extractor (used here AND by the folder detector)    */
/* ------------------------------------------------------------------ */

/**
 * Pull the first real paragraph of prose out of a README/markdown blob.
 * Skips:
 *   - YAML front-matter
 *   - HTML tags / div blocks
 *   - Headings (#)
 *   - Image badges (![...] / <img>)
 *   - Bare URLs / shields.io badges
 *   - Code fences
 *   - Horizontal rules
 *   - Empty lines
 */
export function extractFirstMarkdownProse(md: string): string {
  if (!md) return '';
  let lines = md.split('\n');

  // Strip YAML front-matter
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) lines = lines.slice(end + 1);
  }

  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('```')) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('---') || line.startsWith('===')) continue;
    if (/^<\/?\w+/.test(line)) continue;        // any HTML tag (including <div align=...>, <p>, <br>)
    if (/^!\[.*\]\(.*\)/.test(line)) continue;   // image
    if (/^\[!\[.*\]\(.*\)\]\(.*\)/.test(line)) continue; // badge
    if (/^\[.+\]:\s*http/.test(line)) continue;  // link reference
    if (/^https?:\/\//.test(line)) continue;     // bare url
    if (/^\|.*\|$/.test(line)) continue;         // table row
    if (/^[-*]\s/.test(line)) continue;          // bullet (often a feature list, not a description)

    // Strip inline markdown decoration
    const cleaned = line
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
      .replace(/[*_`]+/g, '')
      .trim();
    if (cleaned.length >= 20) return cleaned.slice(0, 220);
  }
  return '';
}
