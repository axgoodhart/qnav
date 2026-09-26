import { ProjectMetadata, ProjectCategory, detectCategoryFromTech } from './metadataDetector';

/**
 * Represents a related project with similarity metrics
 */
export interface RelatedProject {
  name: string;
  path: string;
  similarityScore: number;
  sharedTech: string[];
  categoryMatch: boolean;
  themeMatch: boolean;
}

/**
 * Weight constants for similarity scoring
 */
const WEIGHTS = {
  TECH_OVERLAP: 0.40,    // 40% weight for tech stack similarity
  CATEGORY: 0.30,        // 30% weight for category match
  THEME: 0.30            // 30% weight for theme/naming patterns
};

/**
 * Common naming theme patterns for project classification
 */
const THEME_PATTERNS: Record<string, RegExp[]> = {
  api: [/api/i, /rest/i, /graphql/i, /server/i, /backend/i, /service/i],
  web: [/web/i, /site/i, /page/i, /portal/i, /dashboard/i, /app/i],
  cli: [/cli/i, /command/i, /tool/i, /util/i, /helper/i],
  lib: [/lib/i, /sdk/i, /package/i, /module/i, /plugin/i, /core/i],
  mobile: [/mobile/i, /ios/i, /android/i, /app/i, /native/i],
  data: [/data/i, /analytics/i, /ml/i, /ai/i, /model/i, /pipeline/i],
  infra: [/infra/i, /deploy/i, /devops/i, /config/i, /setup/i, /docker/i],
  game: [/game/i, /engine/i, /3d/i, /graphics/i, /render/i],
  test: [/test/i, /demo/i, /example/i, /sample/i, /practice/i, /learn/i]
};

/**
 * Compute Jaccard similarity coefficient for two arrays
 * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
 */
function computeJaccardSimilarity(arr1: string[], arr2: string[]): number {
  if (arr1.length === 0 && arr2.length === 0) return 0;

  const set1 = new Set(arr1.map(s => s.toLowerCase()));
  const set2 = new Set(arr2.map(s => s.toLowerCase()));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Get shared technologies between two tech arrays
 */
function getSharedTech(tech1: string[], tech2: string[]): string[] {
  const set1 = new Set(tech1.map(s => s.toLowerCase()));
  const shared: string[] = [];

  for (const t of tech2) {
    if (set1.has(t.toLowerCase())) {
      shared.push(t);
    }
  }

  return shared;
}

/**
 * Detect themes present in a project name
 */
function detectThemes(name: string): string[] {
  const themes: string[] = [];

  for (const [theme, patterns] of Object.entries(THEME_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(name)) {
        themes.push(theme);
        break; // Only count each theme once
      }
    }
  }

  return themes;
}

/**
 * Compute theme overlap score between two project names
 * Returns a value between 0 and 1
 */
function computeThemeOverlap(name1: string, name2: string): boolean {
  const themes1 = detectThemes(name1);
  const themes2 = detectThemes(name2);

  if (themes1.length === 0 || themes2.length === 0) {
    // Fallback: check for common word patterns
    const words1 = name1.toLowerCase().split(/[-_\s]+/).filter(w => w.length > 2);
    const words2 = name2.toLowerCase().split(/[-_\s]+/).filter(w => w.length > 2);

    for (const w1 of words1) {
      for (const w2 of words2) {
        if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
          return true;
        }
      }
    }
    return false;
  }

  // Check if any themes overlap
  const set1 = new Set(themes1);
  for (const theme of themes2) {
    if (set1.has(theme)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if two categories are related (for partial matches)
 * Categories that are closely related get partial credit
 */
function areCategoriesRelated(cat1: ProjectCategory, cat2: ProjectCategory): number {
  if (cat1 === cat2) return 1.0;

  // Define related category pairs with partial scores
  const relatedPairs: Array<[ProjectCategory, ProjectCategory, number]> = [
    ['Frontend', 'Fullstack', 0.5],
    ['Backend', 'Fullstack', 0.5],
    ['Fullstack', 'Frontend', 0.5],
    ['Fullstack', 'Backend', 0.5],
    ['ML', 'Backend', 0.3],
    ['DevOps', 'Backend', 0.3],
    ['Tooling', 'DevOps', 0.3],
    ['Mobile', 'Frontend', 0.4],
  ];

  for (const [c1, c2, score] of relatedPairs) {
    if ((cat1 === c1 && cat2 === c2) || (cat1 === c2 && cat2 === c1)) {
      return score;
    }
  }

  return 0;
}

/**
 * Compute similarity between two projects
 */
function computeSimilarity(
  project1: ProjectMetadata,
  project2: ProjectMetadata
): { score: number; sharedTech: string[]; categoryMatch: boolean; themeMatch: boolean } {
  // 1. Tech stack similarity (Jaccard coefficient)
  const techSimilarity = computeJaccardSimilarity(project1.tech, project2.tech);
  const sharedTech = getSharedTech(project1.tech, project2.tech);

  // 2. Category match (with partial scoring for related categories)
  const categoryScore = areCategoriesRelated(project1.category, project2.category);
  const categoryMatch = categoryScore > 0;

  // 3. Theme/naming pattern overlap
  const themeMatch = computeThemeOverlap(project1.name, project2.name);
  const themeScore = themeMatch ? 1.0 : 0;

  // Weighted final score
  const score = (
    techSimilarity * WEIGHTS.TECH_OVERLAP +
    categoryScore * WEIGHTS.CATEGORY +
    themeScore * WEIGHTS.THEME
  );

  return {
    score,
    sharedTech,
    categoryMatch,
    themeMatch
  };
}

/**
 * Compute relationships for a single project against all other projects
 * Returns top 5 most related projects sorted by similarity score
 */
export function computeRelationships(
  project: ProjectMetadata,
  allProjects: ProjectMetadata[]
): RelatedProject[] {
  const relationships: RelatedProject[] = [];

  for (const other of allProjects) {
    // Skip comparing project to itself
    if (other.path === project.path) {
      continue;
    }

    const { score, sharedTech, categoryMatch, themeMatch } = computeSimilarity(project, other);

    // Only include projects with some level of similarity
    if (score > 0) {
      relationships.push({
        name: other.name,
        path: other.path,
        similarityScore: Math.round(score * 100) / 100, // Round to 2 decimal places
        sharedTech,
        categoryMatch,
        themeMatch
      });
    }
  }

  // Sort by similarity score descending and return top 5
  relationships.sort((a, b) => b.similarityScore - a.similarityScore);

  return relationships.slice(0, 5);
}

/**
 * Compute relationships for all projects
 * Returns a Map where keys are project paths and values are arrays of related projects
 */
export function computeAllRelationships(
  projects: ProjectMetadata[]
): Map<string, RelatedProject[]> {
  const relationshipMap = new Map<string, RelatedProject[]>();

  for (const project of projects) {
    const related = computeRelationships(project, projects);
    relationshipMap.set(project.path, related);
  }

  return relationshipMap;
}

/**
 * RelationshipAnalyzer class for computing project relationships
 */
export class RelationshipAnalyzer {
  private projects: ProjectMetadata[] = [];
  private relationshipCache: Map<string, RelatedProject[]> = new Map();

  /**
   * Update the projects list and recompute all relationships
   */
  updateProjects(projects: ProjectMetadata[]): void {
    this.projects = projects;
    this.relationshipCache = computeAllRelationships(projects);
  }

  /**
   * Get related projects for a specific project path
   */
  getRelatedProjects(projectPath: string): RelatedProject[] {
    return this.relationshipCache.get(projectPath) || [];
  }

  /**
   * Get all computed relationships
   */
  getAllRelationships(): Map<string, RelatedProject[]> {
    return this.relationshipCache;
  }

  /**
   * Find projects that are mutually related (both reference each other)
   */
  findMutualRelationships(): Array<{ project1: string; project2: string; avgScore: number }> {
    const mutual: Array<{ project1: string; project2: string; avgScore: number }> = [];
    const seen = new Set<string>();

    for (const [projectPath, related] of this.relationshipCache) {
      for (const rel of related) {
        const pairKey = [projectPath, rel.path].sort().join('|');
        if (seen.has(pairKey)) continue;

        // Check if the related project also references this one
        const reverseRelated = this.relationshipCache.get(rel.path) || [];
        const reverseMatch = reverseRelated.find(r => r.path === projectPath);

        if (reverseMatch) {
          mutual.push({
            project1: projectPath,
            project2: rel.path,
            avgScore: (rel.similarityScore + reverseMatch.similarityScore) / 2
          });
          seen.add(pairKey);
        }
      }
    }

    // Sort by average score descending
    mutual.sort((a, b) => b.avgScore - a.avgScore);

    return mutual;
  }

  /**
   * Get projects grouped by their strongest category connections
   */
  getProjectClusters(): Map<ProjectCategory, ProjectMetadata[]> {
    const clusters = new Map<ProjectCategory, ProjectMetadata[]>();

    for (const project of this.projects) {
      const existing = clusters.get(project.category) || [];
      existing.push(project);
      clusters.set(project.category, existing);
    }

    return clusters;
  }
}
