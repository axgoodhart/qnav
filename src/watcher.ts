import chokidar from 'chokidar';
import * as path from 'path';
import { ProjectScanner } from './scanner';
import { ProjectMetadata } from './metadataDetector';

export type ChangeCallback = (projects: ProjectMetadata[]) => void;

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private scanner: ProjectScanner;
  private onChange: ChangeCallback;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;

  constructor(
    scanPath: string,
    onChange: ChangeCallback,
    customIgnorePatterns: string[] = [],
    debounceMs: number = 2000
  ) {
    this.scanner = new ProjectScanner(scanPath, customIgnorePatterns);
    this.onChange = onChange;
    this.debounceMs = debounceMs;
  }

  /**
   * Start watching for file changes
   */
  async start(scanPath: string): Promise<void> {
    // Initial scan
    const initialProjects = await this.scanner.scanProjects();
    this.onChange(initialProjects);

    // Watch for changes
    this.watcher = chokidar.watch(scanPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.DS_Store',
        '**/dist/**',
        '**/build/**',
        '**/__pycache__/**',
        '**/target/**',
        '**/.next/**',
        '**/.venv/**',
        '**/venv/**',
      ],
      persistent: true,
      ignoreInitial: true, // Don't fire events for initial scan
      depth: 2, // Only watch top-level and one level deep
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    // Watch for new directories, deleted directories, and key file changes
    this.watcher
      .on('addDir', (dirPath) => this.handleChange('addDir', dirPath))
      .on('unlinkDir', (dirPath) => this.handleChange('unlinkDir', dirPath))
      .on('add', (filePath) => {
        // Only trigger on important files like package.json, README, etc.
        const filename = path.basename(filePath);
        if (this.isImportantFile(filename)) {
          this.handleChange('add', filePath);
        }
      })
      .on('unlink', (filePath) => {
        const filename = path.basename(filePath);
        if (this.isImportantFile(filename)) {
          this.handleChange('unlink', filePath);
        }
      })
      .on('change', (filePath) => {
        const filename = path.basename(filePath);
        if (this.isImportantFile(filename)) {
          this.handleChange('change', filePath);
        }
      });

    console.log(`📁 Watching for changes in: ${scanPath}`);
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Handle file system changes with debouncing
   */
  private handleChange(event: string, changedPath: string): void {
    console.log(`🔄 Change detected: ${event} ${changedPath}`);

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new timer to trigger rescan after debounce period
    this.debounceTimer = setTimeout(async () => {
      console.log('🔍 Rescanning projects...');
      const projects = await this.scanner.scanProjects();
      this.onChange(projects);
    }, this.debounceMs);
  }

  /**
   * Check if a file is important enough to trigger a rescan
   */
  private isImportantFile(filename: string): boolean {
    const importantFiles = [
      'package.json',
      'requirements.txt',
      'cargo.toml',
      'go.mod',
      'pubspec.yaml',
      'setup.py',
      'pyproject.toml',
    ];

    return (
      importantFiles.includes(filename.toLowerCase()) ||
      filename.toLowerCase().startsWith('readme')
    );
  }
}
