import * as fsp from 'fs/promises';
import * as path from 'path';
import { EntryCandidate } from './types';

const BUILD_DIRS = ['dist', 'build', 'out', 'docs', 'site', '_site', 'www', 'public'];
const NESTED_SKIP = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.cache', '.history', '__pycache__', 'venv', '.venv',
  'coverage', '.turbo', 'src', 'components', 'assets', 'static', 'lib', 'vendor', 'test', 'tests',
  '__MACOSX', 'data', ...BUILD_DIRS,
]);

async function statOrNull(p: string) {
  try { return await fsp.stat(p); } catch { return null; }
}

async function readHead(p: string, bytes = 16 * 1024): Promise<string> {
  try {
    const handle = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

/**
 * An HTML file that only works through a bundler: it references source
 * modules (TS/JSX/Vue/Svelte) or a bundler's /src entry. Serving it as a
 * plain file would show a blank page with console errors.
 */
export function looksLikeBundlerTemplate(html: string): boolean {
  if (/<script[^>]+src=["'][^"']*\.(tsx?|jsx|vue|svelte|mts)["']/i.test(html)) return true;
  if (/<script[^>]+type=["']module["'][^>]+src=["']\.?\/src\//i.test(html)) return true;
  if (/%PUBLIC_URL%/.test(html)) return true; // CRA public/index.html
  return false;
}

function toUrlPath(rel: string): string {
  return '/' + rel.split(path.sep).map(seg => encodeURIComponent(seg)).join('/');
}

function isHtml(name: string): boolean {
  return /\.html?$/i.test(name);
}

/**
 * Enumerate plausible static entry points for a folder project.
 * Only the project root, well-known build output folders, and one level of
 * nested folders holding an index.html are considered. Nothing deeper is
 * ever picked silently.
 */
export async function findEntryCandidates(projectPath: string, hasBundler: boolean): Promise<EntryCandidate[]> {
  const out: EntryCandidate[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fsp.readdir(projectPath, { withFileTypes: true });
  } catch {
    return out;
  }

  const folderName = path.basename(projectPath).toLowerCase().replace(/\.[^.]+$/, '');

  // ---- root HTML files ----
  for (const e of entries) {
    if (!e.isFile() || !isHtml(e.name)) continue;
    const abs = path.join(projectPath, e.name);
    const st = await statOrNull(abs);
    const head = await readHead(abs);
    const bundler = looksLikeBundlerTemplate(head);
    const lower = e.name.toLowerCase();
    const isIndex = lower === 'index.html' || lower === 'index.htm';
    let score = isIndex ? 100 : 60;
    if (!isIndex && lower.replace(/\.[^.]+$/, '') === folderName) score = 70;
    if (bundler) score -= 200;
    out.push({
      relPath: e.name,
      servingRoot: projectPath,
      urlPath: toUrlPath(e.name),
      kind: isIndex ? 'root-index' : 'root-html',
      label: isIndex ? `${e.name} (project root)` : e.name,
      score,
      isBuild: false,
      mtime: st ? st.mtime.toISOString() : undefined,
      requiresBundler: bundler || undefined,
    });
  }

  // ---- built output folders ----
  for (const dir of BUILD_DIRS) {
    const abs = path.join(projectPath, dir, 'index.html');
    const st = await statOrNull(abs);
    if (!st || !st.isFile()) continue;
    const head = await readHead(abs);
    const bundler = looksLikeBundlerTemplate(head);
    // public/index.html in a bundler project is a template, not output.
    if (dir === 'public' && (hasBundler || bundler)) continue;
    const isBuild = dir !== 'public' && dir !== 'docs';
    out.push({
      relPath: path.join(dir, 'index.html'),
      servingRoot: isBuild ? path.join(projectPath, dir) : projectPath,
      urlPath: isBuild ? '/' : toUrlPath(path.join(dir, 'index.html')),
      kind: isBuild ? 'built-output' : 'nested-index',
      label: isBuild ? `${dir}/index.html (existing build)` : `${dir}/index.html`,
      score: isBuild ? 40 : 45,
      isBuild,
      mtime: st.mtime.toISOString(),
      requiresBundler: bundler || undefined,
    });
  }

  // ---- one level of nested folders with an index.html ----
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const lower = e.name.toLowerCase();
    if (NESTED_SKIP.has(lower) || lower.startsWith('.')) continue;
    const abs = path.join(projectPath, e.name, 'index.html');
    const st = await statOrNull(abs);
    if (!st || !st.isFile()) continue;
    const head = await readHead(abs);
    const bundler = looksLikeBundlerTemplate(head);
    out.push({
      relPath: path.join(e.name, 'index.html'),
      servingRoot: projectPath,
      urlPath: toUrlPath(path.join(e.name, 'index.html')),
      kind: 'nested-index',
      label: `${e.name}/index.html`,
      score: 30 - (bundler ? 200 : 0),
      isBuild: false,
      mtime: st.mtime.toISOString(),
      requiresBundler: bundler || undefined,
    });
  }

  out.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));
  return out;
}

export interface StaticSelection {
  chosen?: EntryCandidate;
  needsChoice: boolean;
  explanation: string[];
}

/**
 * Decide which candidate to show automatically. Rules, in order:
 *  1. A saved override wins if it still exists.
 *  2. A runnable root index.html wins.
 *  3. Exactly one runnable root HTML file wins.
 *  4. Several root HTML files with no index → ask.
 *  5. A single existing build output is shown, labelled as a build.
 *  6. A single one-level nested index.html is shown with its project root.
 *  7. Otherwise ask (or nothing).
 */
export function selectEntry(candidates: EntryCandidate[], overrideRel?: string): StaticSelection {
  const explanation: string[] = [];
  if (overrideRel) {
    const match = candidates.find(c => c.relPath === overrideRel);
    if (match) {
      explanation.push(`Using saved entry point ${overrideRel}.`);
      return { chosen: match, needsChoice: false, explanation };
    }
    explanation.push(`Saved entry point ${overrideRel} no longer exists; falling back to detection.`);
  }

  const runnable = candidates.filter(c => !c.requiresBundler);
  if (runnable.length === 0) {
    if (candidates.length) explanation.push('Every HTML entry references source modules and needs a bundler.');
    return { needsChoice: false, explanation };
  }

  const rootIndex = runnable.find(c => c.kind === 'root-index');
  if (rootIndex) {
    explanation.push('index.html found at the project root.');
    const others = runnable.filter(c => c !== rootIndex).length;
    if (others) explanation.push(`${others} other entry point${others > 1 ? 's' : ''} available in the entry selector.`);
    return { chosen: rootIndex, needsChoice: false, explanation };
  }

  const rootHtml = runnable.filter(c => c.kind === 'root-html');
  if (rootHtml.length === 1) {
    explanation.push(`Single HTML file at the project root: ${rootHtml[0].relPath}.`);
    return { chosen: rootHtml[0], needsChoice: false, explanation };
  }
  if (rootHtml.length > 1) {
    explanation.push(`${rootHtml.length} HTML files at the project root and no index.html; choose one.`);
    return { needsChoice: true, explanation };
  }

  const builds = runnable.filter(c => c.kind === 'built-output');
  if (builds.length === 1) {
    explanation.push(`Showing existing build output ${builds[0].relPath} (built ${builds[0].mtime}). It may not reflect current source.`);
    return { chosen: builds[0], needsChoice: false, explanation };
  }
  if (builds.length > 1) {
    explanation.push(`${builds.length} build outputs found; choose one.`);
    return { needsChoice: true, explanation };
  }

  const nested = runnable.filter(c => c.kind === 'nested-index');
  if (nested.length === 1) {
    explanation.push(`One nested index.html (${nested[0].relPath}); served with the project root so sibling assets resolve.`);
    return { chosen: nested[0], needsChoice: false, explanation };
  }
  if (nested.length > 1) {
    explanation.push(`${nested.length} nested index.html files; choose one.`);
    return { needsChoice: true, explanation };
  }

  return { needsChoice: false, explanation };
}
