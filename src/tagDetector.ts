/**
 * Tag Detector Module
 * Analyzes projects and detects applicable semantic tags
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SemanticTags,
  TAG_PATTERNS,
  TagPattern,
  PurposeTag,
  AudienceTag,
  DomainTag,
  FeatureTag,
  ArchitectureTag,
  UIParadigmTag,
  DataHandlingTag,
  DeploymentTargetTag,
  IntegrationTypeTag,
  ContentTypeTag,
  InteractionModelTag,
  ScaleTargetTag,
  MonetizationTag,
  TechStyleTag,
  ComplexityTag,
  StageTag,
} from './tagTaxonomy';

export class TagDetector {
  /**
   * Detect all semantic tags for a project
   */
  async detectTags(
    projectPath: string,
    projectName: string,
    techStack: string[],
    fileCount?: number,
    daysSinceActivity?: number
  ): Promise<SemanticTags> {
    const tags: SemanticTags = {};
    const nameLower = projectName.toLowerCase();
    
    // Read package.json dependencies if available
    const deps = await this.getDependencies(projectPath);
    
    // Read README content if available
    const readmeContent = await this.getReadmeContent(projectPath);
    
    // Get list of files/directories
    const files = await this.getFileList(projectPath);

    // Detect tags for each category
    tags.purpose = this.detectTagsFromPatterns<PurposeTag>(
      TAG_PATTERNS.purpose, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.audience = this.detectTagsFromPatterns<AudienceTag>(
      TAG_PATTERNS.audience, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.domain = this.detectTagsFromPatterns<DomainTag>(
      TAG_PATTERNS.domain, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.features = this.detectTagsFromPatterns<FeatureTag>(
      TAG_PATTERNS.features, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.architecture = this.detectTagsFromPatterns<ArchitectureTag>(
      TAG_PATTERNS.architecture, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.uiParadigm = this.detectTagsFromPatterns<UIParadigmTag>(
      TAG_PATTERNS.uiParadigm, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.dataHandling = this.detectTagsFromPatterns<DataHandlingTag>(
      TAG_PATTERNS.dataHandling, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.deploymentTarget = this.detectTagsFromPatterns<DeploymentTargetTag>(
      TAG_PATTERNS.deploymentTarget, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.integrationType = this.detectTagsFromPatterns<IntegrationTypeTag>(
      TAG_PATTERNS.integrationType, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.contentType = this.detectTagsFromPatterns<ContentTypeTag>(
      TAG_PATTERNS.contentType, nameLower, techStack, deps, readmeContent, files
    );
    
    tags.interactionModel = this.detectTagsFromPatterns<InteractionModelTag>(
      TAG_PATTERNS.interactionModel, nameLower, techStack, deps, readmeContent, files
    );

    // Single-value tags
    const scaleMatches = this.detectTagsFromPatterns<ScaleTargetTag>(
      TAG_PATTERNS.scaleTarget, nameLower, techStack, deps, readmeContent, files
    );
    if (scaleMatches.length > 0) {
      tags.scaleTarget = scaleMatches[0];
    }

    const monetizationMatches = this.detectTagsFromPatterns<MonetizationTag>(
      TAG_PATTERNS.monetization, nameLower, techStack, deps, readmeContent, files
    );
    if (monetizationMatches.length > 0) {
      tags.monetization = monetizationMatches[0];
    }

    tags.techStyle = this.detectTagsFromPatterns<TechStyleTag>(
      TAG_PATTERNS.techStyle, nameLower, techStack, deps, readmeContent, files
    );

    // Detect complexity based on file count and dependencies
    tags.complexity = this.detectComplexity(fileCount, deps.length, techStack.length);

    // Detect stage based on activity and patterns
    tags.stage = this.detectStage(nameLower, daysSinceActivity, readmeContent, files);

    // Clean up empty arrays
    return this.cleanTags(tags);
  }

  /**
   * Match patterns against project data and return matching tags
   */
  private detectTagsFromPatterns<T extends string>(
    patterns: TagPattern[],
    nameLower: string,
    techStack: string[],
    deps: string[],
    readmeContent: string,
    files: string[]
  ): T[] {
    const matches: T[] = [];
    const techLower = techStack.map(t => t.toLowerCase());
    const depsLower = deps.map(d => d.toLowerCase());
    const readmeLower = readmeContent.toLowerCase();
    const filesLower = files.map(f => f.toLowerCase());

    for (const pattern of patterns) {
      let matched = false;

      // Check name patterns
      if (pattern.namePatterns) {
        for (const p of pattern.namePatterns) {
          if (nameLower.includes(p.toLowerCase())) {
            matched = true;
            break;
          }
        }
      }

      // Check tech stack patterns
      if (!matched && pattern.techPatterns) {
        for (const p of pattern.techPatterns) {
          if (techLower.some(t => t.includes(p.toLowerCase()))) {
            matched = true;
            break;
          }
        }
      }

      // Check dependency patterns
      if (!matched && pattern.depPatterns) {
        for (const p of pattern.depPatterns) {
          if (depsLower.some(d => d.includes(p.toLowerCase()))) {
            matched = true;
            break;
          }
        }
      }

      // Check README patterns
      if (!matched && pattern.readmePatterns) {
        for (const p of pattern.readmePatterns) {
          if (readmeLower.includes(p.toLowerCase())) {
            matched = true;
            break;
          }
        }
      }

      // Check file patterns
      if (!matched && pattern.filePatterns) {
        for (const p of pattern.filePatterns) {
          const pLower = p.toLowerCase();
          if (filesLower.some(f => f.includes(pLower) || f.endsWith(pLower))) {
            matched = true;
            break;
          }
        }
      }

      if (matched && !matches.includes(pattern.tag as T)) {
        matches.push(pattern.tag as T);
      }
    }

    return matches;
  }

  /**
   * Detect project complexity based on metrics
   */
  private detectComplexity(
    fileCount?: number,
    depCount?: number,
    techCount?: number
  ): ComplexityTag {
    const files = fileCount || 0;
    const deps = depCount || 0;
    const techs = techCount || 0;

    // Calculate complexity score
    let score = 0;
    
    if (files < 5) score += 0;
    else if (files < 20) score += 1;
    else if (files < 50) score += 2;
    else if (files < 200) score += 3;
    else score += 4;

    if (deps < 5) score += 0;
    else if (deps < 15) score += 1;
    else if (deps < 30) score += 2;
    else if (deps < 50) score += 3;
    else score += 4;

    if (techs < 2) score += 0;
    else if (techs < 5) score += 1;
    else if (techs < 8) score += 2;
    else score += 3;

    // Map score to complexity
    if (score <= 1) return 'trivial';
    if (score <= 3) return 'simple';
    if (score <= 6) return 'moderate';
    if (score <= 9) return 'complex';
    return 'enterprise-grade';
  }

  /**
   * Detect project stage based on various signals
   */
  private detectStage(
    nameLower: string,
    daysSinceActivity?: number,
    readmeContent?: string,
    files?: string[]
  ): StageTag {
    const readmeLower = (readmeContent || '').toLowerCase();
    const filesLower = (files || []).map(f => f.toLowerCase());

    // Check for explicit stage indicators in name
    if (nameLower.includes('demo') || nameLower.includes('example')) return 'demo';
    if (nameLower.includes('template') || nameLower.includes('starter') || nameLower.includes('boilerplate')) return 'template';
    if (nameLower.includes('experiment') || nameLower.includes('test') || nameLower.includes('poc')) return 'experimental';
    if (nameLower.includes('old') || nameLower.includes('legacy') || nameLower.includes('deprecated')) return 'legacy';
    if (nameLower.includes('archive') || nameLower.includes('backup')) return 'archived';
    if (nameLower.includes('prototype') || nameLower.includes('proto')) return 'prototype';
    if (nameLower.includes('alpha')) return 'alpha';
    if (nameLower.includes('beta')) return 'beta';
    if (nameLower.includes('mvp')) return 'mvp';

    // Check README for stage indicators
    if (readmeLower.includes('work in progress') || readmeLower.includes('wip')) return 'prototype';
    if (readmeLower.includes('production ready') || readmeLower.includes('stable')) return 'production';
    if (readmeLower.includes('actively maintained')) return 'maintained';

    // Check for activity-based classification
    if (daysSinceActivity !== undefined) {
      if (daysSinceActivity > 365) return 'archived';
      if (daysSinceActivity > 180) return 'legacy';
    }

    // Check for production indicators
    const hasTests = filesLower.some(f => 
      f.includes('test') || f.includes('spec') || f.includes('__tests__')
    );
    const hasDocs = filesLower.some(f => 
      f.includes('readme') || f.includes('docs') || f.includes('documentation')
    );
    const hasCI = filesLower.some(f => 
      f.includes('.github/workflows') || f.includes('ci') || f.includes('travis') || f.includes('circleci')
    );

    if (hasTests && hasDocs && hasCI) return 'production';
    if (hasTests || hasDocs) return 'beta';

    // Default based on apparent maturity
    return 'prototype';
  }

  /**
   * Get dependencies from package.json
   */
  private async getDependencies(projectPath: string): Promise<string[]> {
    try {
      const packagePath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packagePath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      return Object.keys(deps);
    } catch {
      return [];
    }
  }

  /**
   * Get README content
   */
  private async getReadmeContent(projectPath: string): Promise<string> {
    const readmeNames = ['README.md', 'README.txt', 'README', 'readme.md', 'Readme.md'];
    
    for (const name of readmeNames) {
      try {
        const content = await fs.readFile(path.join(projectPath, name), 'utf-8');
        return content.slice(0, 5000); // Limit to first 5000 chars
      } catch {
        continue;
      }
    }
    return '';
  }

  /**
   * Get list of files and directories
   */
  private async getFileList(projectPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      const files: string[] = [];
      
      for (const entry of entries) {
        files.push(entry.name);
        
        // Check one level deep for important patterns
        if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          try {
            const subEntries = await fs.readdir(path.join(projectPath, entry.name));
            for (const subEntry of subEntries.slice(0, 20)) { // Limit to 20 per dir
              files.push(path.join(entry.name, subEntry));
            }
          } catch {
            // Skip unreadable directories
          }
        }
      }
      
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Remove empty arrays and undefined values from tags
   */
  private cleanTags(tags: SemanticTags): SemanticTags {
    const cleaned: SemanticTags = {};
    
    for (const [key, value] of Object.entries(tags)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      (cleaned as any)[key] = value;
    }
    
    return cleaned;
  }
}

/**
 * Get a flat list of all tags from SemanticTags object
 */
export function flattenTags(tags: SemanticTags): string[] {
  const flat: string[] = [];
  
  for (const [category, value] of Object.entries(tags)) {
    if (Array.isArray(value)) {
      for (const tag of value) {
        flat.push(`${category}:${tag}`);
      }
    } else if (value) {
      flat.push(`${category}:${value}`);
    }
  }
  
  return flat;
}

/**
 * Count total tags in SemanticTags object
 */
export function countTags(tags: SemanticTags): number {
  let count = 0;
  
  for (const value of Object.values(tags)) {
    if (Array.isArray(value)) {
      count += value.length;
    } else if (value) {
      count += 1;
    }
  }
  
  return count;
}
