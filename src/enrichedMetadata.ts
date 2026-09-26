import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectMetadata } from './metadataDetector';
import { SemanticTags } from './tagTaxonomy';
import { TagDetector } from './tagDetector';

export interface FileActivity {
  date: string; // ISO date
  count: number; // files modified that day
}

export interface MediaAsset {
  type: 'image' | 'video' | 'audio';
  path: string;
  relativePath: string;
  filename: string;
  size: number;
}

/**
 * Project maturity classification
 * - poc: Proof of concept - small project (<10 files) less than 30 days old
 * - beta: Has tests but incomplete coverage or missing documentation
 * - stable: Mature project with tests, docs, and regular commits
 * - archived: Explicitly archived or no changes in 180+ days
 * - dormant: No activity in 90+ days but not archived
 */
export type ProjectMaturity = 'poc' | 'beta' | 'stable' | 'archived' | 'dormant';

export interface MaturityDetails {
  classification: ProjectMaturity;
  reason: string;
  daysSinceLastActivity: number;
  hasTests: boolean;
  hasDocs: boolean;
}

export interface EnrichedProjectMetadata extends ProjectMetadata {
  fileActivity?: FileActivity[];
  mediaAssets?: MediaAsset[];
  screenshot?: string; // relative path to thumbnail/screenshot
  lastModified?: string; // ISO timestamp
  fileCount?: number;
  hasHistory?: boolean;
  maturity?: MaturityDetails;
  semanticTags?: SemanticTags; // Rich semantic categorization
}

export class MetadataEnricher {
  /**
   * Enrich project metadata with timeline, media, and visual data
   */
  async enrichMetadata(project: ProjectMetadata): Promise<EnrichedProjectMetadata> {
    const enriched: EnrichedProjectMetadata = { ...project };

    try {
      // Get file activity timeline
      enriched.fileActivity = await this.getFileActivity(project.path);

      // Find media assets (images, videos)
      enriched.mediaAssets = await this.findMediaAssets(project.path);

      // Try to find a screenshot/thumbnail
      enriched.screenshot = await this.findScreenshot(project.path);

      // Get last modification time
      enriched.lastModified = await this.getLastModified(project.path);

      // Count total files
      enriched.fileCount = await this.countFiles(project.path);

      // Check if project has .history folder
      enriched.hasHistory = await this.hasHistoryFolder(project.path);

      // Detect project maturity classification
      enriched.maturity = await this.detectMaturity(
        project.path,
        project.name,
        enriched.lastModified,
        enriched.fileCount,
        enriched.fileActivity
      );

      // Detect semantic tags
      const tagDetector = new TagDetector();
      enriched.semanticTags = await tagDetector.detectTags(
        project.path,
        project.name,
        project.tech,
        enriched.fileCount,
        enriched.maturity?.daysSinceLastActivity
      );
    } catch (error) {
      // Silent fail - return basic metadata if enrichment fails
    }

    return enriched;
  }

  /**
   * Get file modification activity grouped by date (last 30 days)
   */
  private async getFileActivity(projectPath: string): Promise<FileActivity[]> {
    const activityMap = new Map<string, number>();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    try {
      await this.scanFilesRecursive(projectPath, async (filePath) => {
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs > thirtyDaysAgo) {
            const date = new Date(stats.mtimeMs).toISOString().split('T')[0];
            activityMap.set(date, (activityMap.get(date) || 0) + 1);
          }
        } catch {
          // Skip files we can't stat
        }
      });
    } catch {
      return [];
    }

    // Convert to array and sort by date
    const activity = Array.from(activityMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return activity.slice(-30); // Last 30 days
  }

  /**
   * Find media assets (images, videos, audio)
   */
  private async findMediaAssets(projectPath: string): Promise<MediaAsset[]> {
    const assets: MediaAsset[] = [];
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
    const videoExts = ['.mp4', '.mov', '.avi', '.webm'];
    const audioExts = ['.mp3', '.wav', '.ogg', '.m4a'];

    try {
      await this.scanFilesRecursive(projectPath, async (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        let type: 'image' | 'video' | 'audio' | null = null;

        if (imageExts.includes(ext)) type = 'image';
        else if (videoExts.includes(ext)) type = 'video';
        else if (audioExts.includes(ext)) type = 'audio';

        if (type) {
          try {
            const stats = await fs.stat(filePath);
            assets.push({
              type,
              path: filePath,
              relativePath: path.relative(projectPath, filePath),
              filename: path.basename(filePath),
              size: stats.size
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }, 2); // Only scan 2 levels deep
    } catch {
      return [];
    }

    // Limit to 50 assets per project
    return assets.slice(0, 50);
  }

  /**
   * Find a screenshot or thumbnail for the project
   */
  private async findScreenshot(projectPath: string): Promise<string | undefined> {
    const screenshotNames = [
      'screenshot.png', 'screenshot.jpg',
      'thumbnail.png', 'thumbnail.jpg',
      'preview.png', 'preview.jpg',
      'cover.png', 'cover.jpg',
      'demo.png', 'demo.jpg'
    ];

    try {
      const files = await fs.readdir(projectPath);

      for (const name of screenshotNames) {
        if (files.some(f => f.toLowerCase() === name.toLowerCase())) {
          return name;
        }
      }

      // Check for any .png or .jpg in root
      const images = files.filter(f =>
        /\.(png|jpe?g)$/i.test(f) &&
        !/node_modules|dist|build/.test(f)
      );

      if (images.length > 0) {
        return images[0];
      }
    } catch {
      // No screenshot found
    }

    return undefined;
  }

  /**
   * Get the most recent modification time for any file in the project
   */
  private async getLastModified(projectPath: string): Promise<string> {
    let latestTime = 0;

    try {
      await this.scanFilesRecursive(projectPath, async (filePath) => {
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs > latestTime) {
            latestTime = stats.mtimeMs;
          }
        } catch {
          // Skip
        }
      }, 2); // Only scan 2 levels deep
    } catch {
      // Return project folder's mtime
      try {
        const stats = await fs.stat(projectPath);
        return new Date(stats.mtimeMs).toISOString();
      } catch {
        return new Date().toISOString();
      }
    }

    return new Date(latestTime || Date.now()).toISOString();
  }

  /**
   * Count total files in project
   */
  private async countFiles(projectPath: string): Promise<number> {
    let count = 0;

    try {
      await this.scanFilesRecursive(projectPath, async () => {
        count++;
      }, 3); // Scan 3 levels deep
    } catch {
      return 0;
    }

    return count;
  }

  /**
   * Check if project has a .history folder
   */
  private async hasHistoryFolder(projectPath: string): Promise<boolean> {
    try {
      const historyPath = path.join(projectPath, '.history');
      const stats = await fs.stat(historyPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Detect project maturity classification based on activity patterns
   * Classifications:
   * - dormant: No activity in 90+ days
   * - archived: Has 'archive' in name or no changes in 180+ days
   * - poc: <10 files and <30 days old
   * - beta: Has tests but incomplete coverage or missing docs
   * - stable: Has tests + docs + regular commits
   */
  private async detectMaturity(
    projectPath: string,
    projectName: string,
    lastModified?: string,
    fileCount?: number,
    fileActivity?: FileActivity[]
  ): Promise<MaturityDetails> {
    const now = Date.now();
    const lastModifiedMs = lastModified ? new Date(lastModified).getTime() : now;
    const daysSinceLastActivity = Math.floor((now - lastModifiedMs) / (24 * 60 * 60 * 1000));

    // Check for tests and docs
    const hasTests = await this.hasTestFiles(projectPath);
    const hasDocs = await this.hasDocumentation(projectPath);

    // Check if project name suggests archived status
    const nameContainsArchive = /archive|archived|old|deprecated|legacy/i.test(projectName);

    // Calculate project age (approximate using lastModified as proxy)
    const projectCreatedMs = await this.getProjectCreationTime(projectPath);
    const projectAgeDays = Math.floor((now - projectCreatedMs) / (24 * 60 * 60 * 1000));

    // Check for regular activity (commits/changes in multiple weeks)
    const hasRegularActivity = this.hasRegularCommitPattern(fileActivity);

    // Classification logic (in priority order)

    // 1. Archived: Explicit archive markers or 180+ days inactive
    if (nameContainsArchive || daysSinceLastActivity >= 180) {
      return {
        classification: 'archived',
        reason: nameContainsArchive
          ? 'Project name indicates archived status'
          : `No activity for ${daysSinceLastActivity} days (180+ threshold)`,
        daysSinceLastActivity,
        hasTests,
        hasDocs
      };
    }

    // 2. Dormant: 90+ days without activity (but less than 180)
    if (daysSinceLastActivity >= 90) {
      return {
        classification: 'dormant',
        reason: `No activity for ${daysSinceLastActivity} days (90+ threshold)`,
        daysSinceLastActivity,
        hasTests,
        hasDocs
      };
    }

    // 3. POC: Small project (<10 files) that is young (<30 days)
    if ((fileCount || 0) < 10 && projectAgeDays < 30) {
      return {
        classification: 'poc',
        reason: `Small project (${fileCount || 0} files) less than 30 days old`,
        daysSinceLastActivity,
        hasTests,
        hasDocs
      };
    }

    // 4. Stable: Has tests + docs + regular activity pattern
    if (hasTests && hasDocs && hasRegularActivity) {
      return {
        classification: 'stable',
        reason: 'Has tests, documentation, and regular commit activity',
        daysSinceLastActivity,
        hasTests,
        hasDocs
      };
    }

    // 5. Beta: Has tests but missing docs, or has activity but incomplete setup
    if (hasTests || (fileCount || 0) >= 10) {
      const reasons: string[] = [];
      if (hasTests && !hasDocs) reasons.push('has tests but missing documentation');
      if (!hasTests && hasDocs) reasons.push('has documentation but missing tests');
      if (!hasTests && !hasDocs) reasons.push('project is active but missing tests and docs');
      if (!hasRegularActivity) reasons.push('irregular commit activity');

      return {
        classification: 'beta',
        reason: reasons.length > 0 ? reasons.join('; ') : 'In active development',
        daysSinceLastActivity,
        hasTests,
        hasDocs
      };
    }

    // Default to POC for small, new-ish projects
    return {
      classification: 'poc',
      reason: 'Small or new project without established patterns',
      daysSinceLastActivity,
      hasTests,
      hasDocs
    };
  }

  /**
   * Check if project has test files
   */
  private async hasTestFiles(projectPath: string): Promise<boolean> {
    const testIndicators = [
      'test', 'tests', '__tests__', 'spec', 'specs',
      'test.js', 'test.ts', 'spec.js', 'spec.ts',
      'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
      'pytest.ini', 'conftest.py', 'tox.ini',
      'Cargo.toml' // Rust has tests inline, check for test modules later
    ];

    try {
      const files = await fs.readdir(projectPath);

      // Check for test directories or config files
      for (const file of files) {
        const lowerFile = file.toLowerCase();
        if (testIndicators.some(indicator => lowerFile.includes(indicator))) {
          return true;
        }
      }

      // Check for test files in common locations
      const testPatterns = ['*.test.ts', '*.test.js', '*.spec.ts', '*.spec.js', 'test_*.py', '*_test.py'];
      let foundTestFile = false;

      await this.scanFilesRecursive(projectPath, async (filePath) => {
        const fileName = path.basename(filePath).toLowerCase();
        if (
          fileName.includes('.test.') ||
          fileName.includes('.spec.') ||
          fileName.startsWith('test_') ||
          fileName.endsWith('_test.py')
        ) {
          foundTestFile = true;
        }
      }, 2);

      return foundTestFile;
    } catch {
      return false;
    }
  }

  /**
   * Check if project has documentation
   */
  private async hasDocumentation(projectPath: string): Promise<boolean> {
    const docIndicators = [
      'README.md', 'README.txt', 'README.rst', 'README',
      'docs', 'documentation', 'doc',
      'CHANGELOG.md', 'CHANGELOG.txt',
      'CONTRIBUTING.md', 'API.md'
    ];

    try {
      const files = await fs.readdir(projectPath);

      for (const file of files) {
        if (docIndicators.some(indicator =>
          file.toLowerCase() === indicator.toLowerCase()
        )) {
          // For README, check if it has meaningful content (more than just a title)
          if (file.toLowerCase().startsWith('readme')) {
            try {
              const content = await fs.readFile(path.join(projectPath, file), 'utf-8');
              // Consider docs meaningful if > 100 chars
              if (content.length > 100) {
                return true;
              }
            } catch {
              // If we can't read it, still count it
              return true;
            }
          } else {
            return true;
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get approximate project creation time
   */
  private async getProjectCreationTime(projectPath: string): Promise<number> {
    try {
      // Try to get the oldest file modification time as a proxy for creation
      let oldestTime = Date.now();

      await this.scanFilesRecursive(projectPath, async (filePath) => {
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < oldestTime) {
            oldestTime = stats.mtimeMs;
          }
        } catch {
          // Skip
        }
      }, 2);

      return oldestTime;
    } catch {
      return Date.now();
    }
  }

  /**
   * Check if project has regular commit/activity pattern
   * Regular = activity in at least 2 different weeks in the last 30 days
   */
  private hasRegularCommitPattern(fileActivity?: FileActivity[]): boolean {
    if (!fileActivity || fileActivity.length === 0) {
      return false;
    }

    // Group activity by week
    const weekSet = new Set<string>();

    for (const activity of fileActivity) {
      const date = new Date(activity.date);
      // Get week number (ISO week)
      const week = this.getISOWeek(date);
      weekSet.add(`${date.getFullYear()}-W${week}`);
    }

    // Regular activity = at least 2 different weeks
    return weekSet.size >= 2;
  }

  /**
   * Get ISO week number for a date
   */
  private getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Recursively scan files in a directory
   */
  private async scanFilesRecursive(
    dir: string,
    callback: (filePath: string) => Promise<void>,
    maxDepth: number = 5,
    currentDepth: number = 0
  ): Promise<void> {
    if (currentDepth > maxDepth) return;

    // Skip common large/unimportant directories
    const skipDirs = [
      'node_modules', '.git', 'dist', 'build', '.next',
      '__pycache__', 'venv', '.venv', 'target', 'vendor'
    ];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (skipDirs.includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile()) {
          await callback(fullPath);
        } else if (entry.isDirectory()) {
          await this.scanFilesRecursive(fullPath, callback, maxDepth, currentDepth + 1);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
}

/**
 * Standalone function to detect project maturity
 * Useful for quick maturity checks without full metadata enrichment
 */
export async function detectMaturity(projectPath: string, projectName: string): Promise<MaturityDetails> {
  const enricher = new MetadataEnricher();

  // Get minimal data needed for maturity detection
  const lastModified = await enricher['getLastModified'](projectPath);
  const fileCount = await enricher['countFiles'](projectPath);
  const fileActivity = await enricher['getFileActivity'](projectPath);

  return enricher['detectMaturity'](projectPath, projectName, lastModified, fileCount, fileActivity);
}
