import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Canonical path: resolved, symlinks followed when the path exists, Unicode
 * normalised (macOS returns NFD names from readdir; NFC keeps ids stable).
 */
export function canonicalPath(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // Path may not exist (yet); keep the resolved form.
  }
  return resolved.normalize('NFC');
}

/**
 * Stable project id from the canonical path relative to the scan root.
 * Display names are never used, so two projects that share a name stay apart
 * and renaming the scan root does not invalidate ids.
 */
export function projectIdFor(projectPath: string, scanRoot: string): string {
  const rel = path.relative(canonicalPath(scanRoot), canonicalPath(projectPath)).normalize('NFC');
  const digest = createHash('sha1').update(rel).digest('hex');
  return `p_${digest.slice(0, 12)}`;
}

export function shortHash(input: string, len = 10): string {
  return createHash('sha1').update(input).digest('hex').slice(0, len);
}
