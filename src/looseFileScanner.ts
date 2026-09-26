/**
 * Loose file scanner
 *
 * The original scanner only emitted a project for each top-level *directory*,
 * which silently dropped all the standalone .html / .py / .js / .swift files
 * sitting at the root. For a creative-coding sketchbook those files ARE the
 * portfolio. This module fills that gap.
 *
 * Each loose file becomes its own ProjectMetadata record (kind = 'file').
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IgnorePatternMatcher } from './ignorePatterns';
import { ProjectMetadata, ProjectCategory } from './metadataDetector';
import { parseFileContent, isReadableSource, ContentSignals, classifyExt } from './contentParser';
import { detectGenres, Genre } from './genres';

/**
 * Files we treat as "could be a project on its own."
 * (Excludes assets like .png, .mid, .psd, .zip, .json — those aren't sketches.)
 */
const PROJECT_FILE_EXTS = new Set([
  '.html', '.htm',
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.tsx', '.mts', '.cts',
  '.py',
  '.css',
  '.swift',
]);

/**
 * Markdown files: only emit them as projects if they look like real
 * standalone writing (not a stray README floating in the wrong directory).
 */
const MD_EXTS = new Set(['.md', '.markdown']);

/**
 * Map an extension to a friendly project type label.
 */
function fileType(ext: string): string {
  const lang = classifyExt(ext);
  switch (lang) {
    case 'html':       return 'HTML sketch';
    case 'javascript': return 'JS script';
    case 'typescript': return 'TS module';
    case 'python':     return 'Python script';
    case 'css':        return 'CSS module';
    case 'swift':      return 'Swift source';
    case 'markdown':   return 'Document';
    default:           return 'File';
  }
}

/**
 * Pick a backward-compatible category label so the existing dashboard filters
 * still work. New consumers should look at `genres` instead.
 */
function legacyCategory(genres: Genre[]): ProjectCategory {
  if (genres.includes('mobile')) return 'Mobile';
  if (genres.includes('backend')) return 'Backend';
  if (genres.includes('fullstack')) return 'Fullstack';
  if (genres.includes('frontend') || genres.includes('ui-lab') || genres.includes('creative-coding') || genres.includes('audio') || genres.includes('3d') || genres.includes('visual')) {
    return 'Frontend';
  }
  if (genres.includes('script') || genres.includes('tool')) return 'Tooling';
  return 'Unknown';
}

/**
 * Build the human-facing description for a loose file. Keyword-style is fine
 * — we don't try to write sentences.
 */
function buildDescription(name: string, type: string, signals: ContentSignals): string {
  if (signals.description && signals.description.length >= 12) return signals.description;
  if (signals.title && signals.title.length >= 4 && signals.title.toLowerCase() !== name.toLowerCase()) {
    return signals.title;
  }
  // Synthesize a tag-soup description from the signals.
  const bits: string[] = [];
  if (signals.libraries.length) bits.push(signals.libraries.slice(0, 4).join(' + '));
  if (signals.apis.length) bits.push(signals.apis.slice(0, 4).join(', '));
  if (signals.lineCount) bits.push(`${signals.lineCount} lines`);
  if (bits.length === 0) return type;
  return `${type} — ${bits.join(' · ')}`;
}

/**
 * Infer "state" from polish + size signals (cheap and meaningful for sketches).
 */
function inferLooseState(signals: ContentSignals): string {
  if (signals.isStub) return 'Stub';
  if (signals.polish >= 0.45) return 'Polished';
  if (signals.lineCount > 200) return 'Substantial';
  return 'Sketch';
}

/**
 * Convert a single loose file into a ProjectMetadata record.
 */
async function fileToProject(filePath: string): Promise<ProjectMetadata | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (!PROJECT_FILE_EXTS.has(ext) && !MD_EXTS.has(ext)) return null;
  if (!isReadableSource(filePath)) return null;

  const signals = await parseFileContent(filePath);

  // Markdown gating: only keep if it has real prose AND isn't a generic README
  if (MD_EXTS.has(ext)) {
    const baseName = path.basename(filePath).toLowerCase();
    if (baseName.startsWith('readme')) return null;
    if (!signals.description || signals.description.length < 60) return null;
  }

  const name = path.basename(filePath, ext);
  const type = fileType(ext);

  const tech: string[] = [];
  if (ext === '.html') tech.push('HTML');
  if (ext === '.css') tech.push('CSS');
  if (signals.hasInlineCss) tech.push('CSS');
  if (signals.hasInlineJs && ext === '.html') tech.push('JavaScript');
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') tech.push('JavaScript');
  if (ext === '.ts' || ext === '.tsx') tech.push('TypeScript');
  if (ext === '.py') tech.push('Python');
  if (ext === '.swift') tech.push('Swift');
  for (const lib of signals.libraries) if (!tech.includes(lib)) tech.push(lib);

  const genres = detectGenres({
    name,
    tech,
    libraries: signals.libraries,
    apis: signals.apis,
    language: signals.language,
    isStub: signals.isStub,
    hasInlineCss: signals.hasInlineCss,
    hasInlineJs: signals.hasInlineJs,
    fileCount: 1,
  });

  return {
    name,
    type,
    state: inferLooseState(signals),
    tech: tech.length ? tech : ['Unknown'],
    desc: buildDescription(name, type, signals),
    path: filePath,
    category: legacyCategory(genres),
    kind: 'file',
    genres,
    family: null, // populated by variantGrouper
    signals: {
      libraries: signals.libraries,
      apis: signals.apis,
      polish: signals.polish,
      isStub: signals.isStub,
      sizeBytes: signals.sizeBytes,
      lineCount: signals.lineCount,
      hasInlineCss: signals.hasInlineCss,
      hasInlineJs: signals.hasInlineJs,
    },
  };
}

export class LooseFileScanner {
  constructor(
    private rootPath: string,
    private ignoreMatcher: IgnorePatternMatcher
  ) {}

  async scanLooseFiles(): Promise<ProjectMetadata[]> {
    const out: ProjectMetadata[] = [];
    let entries: any[];
    try {
      entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(this.rootPath, entry.name);
      if (this.ignoreMatcher.shouldIgnore(filePath, this.rootPath)) continue;
      try {
        const project = await fileToProject(filePath);
        if (project) out.push(project);
      } catch {
        // skip unreadable files
      }
    }

    return out;
  }
}
