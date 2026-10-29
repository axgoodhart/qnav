import * as fsp from 'fs/promises';
import * as path from 'path';
import { EntryCandidate } from './types';
import { looksLikeBundlerTemplate } from './entryResolver';

/** One HTML file found inside a project. */
export interface HtmlFileEntry {
  /** Path relative to the project folder (or to the loose file's directory). */
  relPath: string;
  /** URL path under the serving root. */
  urlPath: string;
  size: number;
  mtime: string;
  /** True when the file references source modules and needs a dev server. */
  requiresBundler: boolean;
  /** Number of directories between the root and the file. */
  depth: number;
}

export interface HtmlListing {
  files: HtmlFileEntry[];
  truncated: boolean;
}

// Mirror the silent-pick exclusions in entryResolver: generated, VCS and
// dependency folders are never browsed. Build output IS listed: those files
// open fine over static.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.cache', '.history',
  '__pycache__', 'venv', '.venv', 'coverage', '.turbo',
  '__macosx', '.ds_store',
]);

const MAX_FILES = 500;
const MAX_DEPTH = 6;
const HEAD_BYTES = 16 * 1024;

function toUrlPath(rel: string): string {
  return '/' + rel.split(path.sep).map(seg => encodeURIComponent(seg)).join('/');
}

function isHtml(name: string): boolean {
  return /\.html?$/i.test(name);
}

async function readHead(abs: string): Promise<string> {
  try {
    const handle = await fsp.open(abs, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
      return buf.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

/**
 * List every HTML file under a root, shallow or recursive. Bounded: stops
 * descending past MAX_DEPTH and stops collecting past MAX_FILES.
 */
export async function listHtmlFiles(root: string, recursive = true): Promise<HtmlListing> {
  const files: HtmlFileEntry[] = [];
  let truncated = false;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!recursive) continue;
        const lower = e.name.toLowerCase();
        if (lower.startsWith('.') || SKIP_DIRS.has(lower)) continue;
        if (depth + 1 > MAX_DEPTH) { truncated = true; continue; }
        stack.push({ dir: abs, depth: depth + 1 });
      } else if (e.isFile() && isHtml(e.name)) {
        if (files.length >= MAX_FILES) { truncated = true; break; }
        let st: import('fs').Stats | null = null;
        try { st = await fsp.stat(abs); } catch { continue; }
        if (!st.isFile()) continue;
        const rel = path.relative(root, abs);
        files.push({
          relPath: rel,
          urlPath: toUrlPath(rel),
          size: st.size,
          mtime: st.mtime.toISOString(),
          requiresBundler: looksLikeBundlerTemplate(await readHead(abs)),
          depth,
        });
      }
    }
    if (files.length >= MAX_FILES) { truncated = true; break; }
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { files, truncated };
}

export interface ResolvedHtmlFile {
  relPath: string;
  urlPath: string;
  requiresBundler: boolean;
}

/**
 * Validate an Explore selection: must be an existing .html file inside the
 * root after symlink resolution. Returns null for anything else.
 */
export async function resolveHtmlFile(root: string, rel: string): Promise<ResolvedHtmlFile | null> {
  if (!rel || typeof rel !== 'string' || path.isAbsolute(rel)) return null;
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!isHtml(abs)) return null;
  let st: import('fs').Stats | null = null;
  try { st = await fsp.stat(abs); } catch { return null; }
  if (!st.isFile()) return null;
  // Containment again after symlink resolution.
  try {
    const realRoot = await fsp.realpath(root);
    const realAbs = await fsp.realpath(abs);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) return null;
  } catch {
    return null;
  }
  return { relPath: path.relative(root, abs), urlPath: toUrlPath(path.relative(root, abs)), requiresBundler: looksLikeBundlerTemplate(await readHead(abs)) };
}

/** Build a candidate for a saved entry that was never auto-detected (e.g. nested). */
export async function candidateForHtmlFile(projectPath: string, rel: string): Promise<EntryCandidate | null> {
  const file = await resolveHtmlFile(projectPath, rel);
  if (!file) return null;
  let mtime = '';
  try { mtime = (await fsp.stat(path.join(projectPath, file.relPath))).mtime.toISOString(); } catch { /* ignore */ }
  const base = path.basename(file.relPath).toLowerCase();
  const isIndex = base === 'index.html' || base === 'index.htm';
  return {
    relPath: file.relPath,
    servingRoot: projectPath,
    urlPath: file.urlPath,
    kind: isIndex ? 'root-index' : 'root-html',
    label: file.relPath,
    score: 50,
    isBuild: false,
    mtime: mtime || undefined,
    requiresBundler: file.requiresBundler || undefined,
  };
}
