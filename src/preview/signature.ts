import * as fsp from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', 'coverage',
  '__pycache__', 'venv', '.venv', 'env', '.history', '__MACOSX', '.idea', '.vscode', 'target', 'vendor', '.parcel-cache', '.svelte-kit', '.astro',
]);
const SKIP_FILES = /^(\.DS_Store|Thumbs\.db|.*\.log|.*\.tmp|.*\.swp)$/i;

export interface SourceSignature {
  hash: string;
  fileCount: number;
  truncated: boolean;
}

/**
 * Cheap fingerprint of a project's source: sorted relative paths with size
 * and mtime, hashed. Dependencies, build output, caches and qnav's own data
 * are excluded so a capture is only "stale" when something the author edited
 * changed.
 */
export async function computeSourceSignature(projectPath: string, maxFiles = 4000): Promise<SourceSignature> {
  const hash = createHash('sha1');
  let count = 0;
  let truncated = false;
  const st = await fsp.stat(projectPath);
  if (st.isFile()) {
    hash.update(`${path.basename(projectPath)}:${st.size}:${Math.floor(st.mtimeMs)}`);
    return { hash: hash.digest('hex').slice(0, 16), fileCount: 1, truncated: false };
  }
  const walk = async (dir: string, rel: string): Promise<void> => {
    if (truncated) return;
    let entries: import('fs').Dirent[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (truncated) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (rel === '' && e.name === 'data' && path.basename(projectPath) === 'qnav')) continue;
        await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        if (SKIP_FILES.test(e.name)) continue;
        try {
          const s = await fsp.stat(path.join(dir, e.name));
          hash.update(`${rel}/${e.name}:${s.size}:${Math.floor(s.mtimeMs)}\n`);
          count++;
          if (count >= maxFiles) { truncated = true; return; }
        } catch { /* unreadable */ }
      }
    }
  };
  await walk(projectPath, '');
  return { hash: hash.digest('hex').slice(0, 16), fileCount: count, truncated };
}
