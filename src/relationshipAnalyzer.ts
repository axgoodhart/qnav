import { ProjectMetadata } from './metadataDetector';

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
  reasons: string[];
}

const meaning = require('../public/meaning.js');

function computeSimilarity(project1: ProjectMetadata, project2: ProjectMetadata) {
  const result = meaning.compare(project1, project2);
  return { ...result, categoryMatch: result.shared.some((tag: { category: string }) => ['purpose', 'domain'].includes(tag.category)), themeMatch: false };
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

    const { score, sharedTech, categoryMatch, themeMatch, reasons } = computeSimilarity(project, other);

    // Only include projects with some level of similarity
    if (score >= 0.22) {
      relationships.push({
        name: other.name,
        path: other.path,
        similarityScore: Math.round(score * 100) / 100, // Round to 2 decimal places
        sharedTech,
        categoryMatch,
        themeMatch,
        reasons
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
