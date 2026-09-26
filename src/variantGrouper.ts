/**
 * Variant grouper
 *
 * Groups projects whose names are clearly iterations of the same idea so the
 * dashboard can show them as one family with multiple revisions.
 *
 * Examples that should land in the same family:
 *
 *   zynth, zynth 2, zynth 3
 *   alexgoodhart, alexgoodhart 2
 *   byAlexGoodhart, byAlexGoodhart copy
 *   experiments, experiments2, experiments3, experiments4, experiments6
 *   PracticalliaV2.html, Practicallia, oldPracticalia, Old Practicallia.html
 *   Swarm.html, Swarm_20250828034941.html, Swarm_20250828035013.html
 *   PDFStream.html, PDFStreamX.html, PDFStreamY.html, PDFStreamer.html
 *   AnotherOS.html, AnotherOS copy.html
 *   appv1, appv2, app3
 *   bg11.html, bg11-refactored.html
 *
 * Strategy: normalize each project name into a "family key" by aggressively
 * stripping iteration markers. Same key → same family.
 */

import { ProjectMetadata } from './metadataDetector';

/**
 * Lowercase, strip noise, and reduce to a canonical family key.
 */
export function familyKey(rawName: string): string {
  let s = rawName.toLowerCase();

  // Strip extension
  s = s.replace(/\.[a-z0-9]{1,5}$/i, '');

  // Strip timestamps like _20250828034941, -20250828, _2024_01_01
  s = s.replace(/[_-]\d{6,14}([_-]\d+)?$/g, '');
  s = s.replace(/[_-]\d{4}[_-]\d{2}[_-]\d{2}([_-]\d+)?$/g, '');

  // Strip "(1)" / "(copy)" / "[2]"
  s = s.replace(/[\s_-]*[\(\[][\d copy]+[\)\]]\s*$/g, '');

  // Strip " copy", " copy 2", "copy"
  s = s.replace(/[\s_-]*copy(\s+\d+)?$/g, '');

  // Strip leading "old", "new", "pre-", "old-"
  s = s.replace(/^old[\s_-]+/i, '');
  s = s.replace(/^new[\s_-]+/i, '');
  s = s.replace(/^pre[\s_-]+/i, '');
  s = s.replace(/^the[\s_-]+/i, '');

  // Strip trailing "old", "new", "delete me", "dontuse", etc.
  s = s.replace(/[\s_-]+(old|new|legacy|deprecated|backup|bak|delete[\s_-]?me|temp|tmp|wip|draft|final)$/i, '');
  s = s.replace(/^delete[\s_-]?me[\s_-]+/i, '');

  // Strip trailing -main / -master / -refactored / -clean
  s = s.replace(/[\s_-](main|master|refactored|clean|cleaned|fixed|working)$/i, '');

  // Strip "v1", "v2", "version1", "v12" — but require at least 1 char of
  // stem before the "v" so a project literally named "v8" survives.
  s = s.replace(/^(.+?)[\s_-]*v(?:ersion)?\s*\d+$/i, '$1');

  // Strip a trailing "X" / "Y" / "Z" (PDFStreamX → pdfstream)
  // Only when there's at least 6 chars before it, so "codex" (stem "code")
  // doesn't collide with "code".
  s = s.replace(/^(.{6,})[xyz]$/i, '$1');

  // Strip trailing digits (with optional separator). Keep at least 3
  // chars of stem so "v8", "h2" don't get gutted but "app3" still groups
  // with "appv1"/"appv2".
  const stemMatch = s.match(/^(.+?)[\s_-]*\d+$/);
  if (stemMatch && stemMatch[1].length >= 3) {
    s = stemMatch[1];
  }

  // Collapse runs of separators / whitespace
  s = s.replace(/[\s_-]+/g, '');

  return s.trim();
}

/**
 * Stamp each project with a family key and return a Map<key, members[]>.
 * Singleton families (one member only) get `family = null` so the UI can
 * cleanly skip the "iterations" badge.
 */
export function groupVariants(projects: ProjectMetadata[]): Map<string, ProjectMetadata[]> {
  const families = new Map<string, ProjectMetadata[]>();
  for (const p of projects) {
    const key = familyKey(p.name);
    if (!key) continue;
    if (!families.has(key)) families.set(key, []);
    families.get(key)!.push(p);
  }

  for (const [key, members] of families) {
    if (members.length < 2) {
      for (const m of members) m.family = null;
    } else {
      for (const m of members) m.family = key;
    }
  }

  return families;
}

/**
 * Pretty-print a family key as a display name (best effort).
 */
export function familyDisplayName(key: string): string {
  // Insert spaces between camelCase humps
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}
