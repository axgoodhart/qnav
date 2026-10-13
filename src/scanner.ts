import * as fs from 'fs/promises';
import * as path from 'path';
import { IgnorePatternMatcher } from './ignorePatterns';
import { MetadataDetector, ProjectMetadata } from './metadataDetector';
import { MetadataEnricher, EnrichedProjectMetadata } from './enrichedMetadata';
import { LooseFileScanner } from './looseFileScanner';
import { groupVariants } from './variantGrouper';
import { projectIdFor } from './preview/identity';

export class ProjectScanner {
  private ignoreMatcher: IgnorePatternMatcher;
  private metadataDetector: MetadataDetector;
  private enricher: MetadataEnricher;
  private looseScanner: LooseFileScanner;
  private scanPath: string;
  private enableEnrichment: boolean;

  constructor(scanPath: string, customIgnorePatterns: string[] = [], enableEnrichment: boolean = true) {
    this.scanPath = scanPath;
    this.ignoreMatcher = new IgnorePatternMatcher(customIgnorePatterns);
    this.metadataDetector = new MetadataDetector();
    this.enricher = new MetadataEnricher();
    this.looseScanner = new LooseFileScanner(scanPath, this.ignoreMatcher);
    this.enableEnrichment = enableEnrichment;
  }

  /**
   * Scan for all projects in the configured directory.
   *
   * Top-level directories AND top-level loose files are both treated as
   * candidate projects. Once everything is collected, sibling iterations
   * are grouped into families via variantGrouper.
   */
  async scanProjects(): Promise<EnrichedProjectMetadata[]> {
    const projects: EnrichedProjectMetadata[] = [];

    try {
      const entries = await fs.readdir(this.scanPath, { withFileTypes: true });

      // ---------- Folder projects ----------
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectPath = path.join(this.scanPath, entry.name);

        if (this.ignoreMatcher.shouldIgnore(projectPath, this.scanPath)) {
          continue;
        }

        const metadata = await this.metadataDetector.detectMetadata(projectPath);
        const enriched = this.enableEnrichment
          ? await this.enricher.enrichMetadata(metadata)
          : metadata;

        enriched.id = projectIdFor(projectPath, this.scanPath);
        projects.push(enriched);

        const rootFiles = await fs.readdir(projectPath);
        const manifests = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pubspec.yaml'];
        if (!rootFiles.some(file => manifests.includes(file))) {
          const children = await fs.readdir(projectPath, { withFileTypes: true });
          for (const child of children) {
            if (!child.isDirectory() || child.name.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor', 'data'].includes(child.name)) continue;
            const childPath = path.join(projectPath, child.name);
            if (this.ignoreMatcher.shouldIgnore(childPath, this.scanPath)) continue;
            const childFiles = await fs.readdir(childPath).catch(() => [] as string[]);
            if (!childFiles.some(file => manifests.includes(file))) continue;
            const childMetadata = await this.metadataDetector.detectMetadata(childPath);
            const childProject = this.enableEnrichment ? await this.enricher.enrichMetadata(childMetadata) : childMetadata;
            childProject.id = projectIdFor(childPath, this.scanPath);
            projects.push(childProject);
          }
        }
      }

      // ---------- Loose-file projects ----------
      const looseFiles = await this.looseScanner.scanLooseFiles();
      for (const lf of looseFiles) {
        // loose files don't go through the heavy enricher (no .history, no
        // file-activity timeline, no media subfolder) — they ARE the file.
        lf.id = projectIdFor(lf.path, this.scanPath);
        projects.push(lf as EnrichedProjectMetadata);
      }

      // ---------- Variant family grouping ----------
      groupVariants(projects);
    } catch (error) {
      console.error('Error scanning projects:', error);
    }

    return projects;
  }

  /**
   * Scan a single project and return its metadata
   */
  async scanSingleProject(projectName: string): Promise<ProjectMetadata | null> {
    const projectPath = path.join(this.scanPath, projectName);

    try {
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) return null;

      if (this.ignoreMatcher.shouldIgnore(projectPath, this.scanPath)) {
        return null;
      }

      return await this.metadataDetector.detectMetadata(projectPath);
    } catch (error) {
      return null;
    }
  }
}
