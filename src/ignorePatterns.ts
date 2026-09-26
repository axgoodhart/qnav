import { minimatch } from 'minimatch';
import * as path from 'path';

/**
 * Default patterns to ignore (similar to .gitignore)
 */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.DS_Store',
  '.DS_Store?',
  '._*',
  '*.log',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.nuxt/**',
  '.cache/**',
  'tmp/**',
  'temp/**',
  '*.tmp',
  '__pycache__/**',
  '*.pyc',
  '.venv/**',
  'venv/**',
  '.env',
  '.env.local',
  'target/**', // Rust
  'vendor/**', // Go, PHP
  '.idea/**', '.idea',
  '.vscode/**', '.vscode',
  '.zed/**', '.zed',
  '.claude/**', '.claude',
  '.cursor/**', '.cursor',
  '.history/**', '.history',
  '__MACOSX/**', '__MACOSX',
  '*.swp',
  '*.swo',
  '.turbo/**',
  'out/**',
  'qnav/data/**', // qnav-owned preview/capture data
];

export class IgnorePatternMatcher {
  private patterns: string[];
  private negationPatterns: string[];

  constructor(customPatterns: string[] = []) {
    const allPatterns = [...DEFAULT_IGNORE_PATTERNS, ...customPatterns];

    // Separate negation patterns (starting with !)
    this.negationPatterns = allPatterns
      .filter(p => p.startsWith('!'))
      .map(p => p.slice(1));

    this.patterns = allPatterns.filter(p => !p.startsWith('!'));
  }

  /**
   * Check if a file path should be ignored
   */
  shouldIgnore(filePath: string, basePath: string): boolean {
    const relativePath = path.relative(basePath, filePath);

    // Check if explicitly included (negation patterns)
    for (const pattern of this.negationPatterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return false;
      }
    }

    // Check if matches ignore patterns
    for (const pattern of this.patterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return true;
      }
    }

    return false;
  }

  /**
   * Filter an array of paths, removing ignored ones
   */
  filterPaths(paths: string[], basePath: string): string[] {
    return paths.filter(p => !this.shouldIgnore(p, basePath));
  }
}
