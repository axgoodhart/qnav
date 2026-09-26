import { ProjectMetadata } from './metadataDetector';
import { EnrichedProjectMetadata } from './enrichedMetadata';

/**
 * Project theme types for semantic clustering
 */
export type ProjectTheme =
  | 'ecommerce'
  | 'cms'
  | 'analytics'
  | 'game'
  | 'api'
  | 'cli'
  | 'library'
  | 'unknown';

/**
 * Theme detection result with confidence score
 */
export interface ThemeDetection {
  theme: ProjectTheme;
  confidence: number; // 0-1 score
  matchedPatterns: string[];
}

/**
 * Theme detection rule configuration
 */
interface ThemeRule {
  namePatterns: RegExp[];
  techPatterns: string[];
  dirPatterns?: string[];
  weight?: number; // Higher weight = stronger signal
}

/**
 * Theme detection patterns for each project theme
 * Each theme has:
 * - namePatterns: regex patterns to match project names
 * - techPatterns: technology/dependency patterns (case-insensitive matching)
 * - dirPatterns: optional directory patterns (for future use)
 * - weight: confidence boost when matched (default 1)
 */
export const THEME_PATTERNS: Record<Exclude<ProjectTheme, 'unknown'>, ThemeRule> = {
  ecommerce: {
    namePatterns: [
      /shop/i,
      /store/i,
      /cart/i,
      /checkout/i,
      /commerce/i,
      /ecom/i,
      /market/i,
      /payment/i,
      /order/i,
      /product/i,
      /inventory/i
    ],
    techPatterns: [
      'stripe',
      'paypal',
      'shopify',
      'woocommerce',
      'magento',
      'snipcart',
      'medusa',
      'saleor',
      'commercejs',
      'bigcommerce',
      'square',
      'braintree',
      'razorpay'
    ],
    weight: 1.2
  },

  cms: {
    namePatterns: [
      /content/i,
      /blog/i,
      /admin/i,
      /portal/i,
      /publish/i,
      /editorial/i,
      /cms/i,
      /wiki/i,
      /knowledge/i,
      /docs/i
    ],
    techPatterns: [
      'markdown',
      'contentful',
      'sanity',
      'strapi',
      'ghost',
      'wordpress',
      'drupal',
      'keystonejs',
      'directus',
      'payload',
      'tinacms',
      'mdx',
      'remark',
      'gray-matter',
      'contentlayer'
    ],
    weight: 1.0
  },

  analytics: {
    namePatterns: [
      /metric/i,
      /stat/i,
      /dashboard/i,
      /analytics/i,
      /insight/i,
      /report/i,
      /monitor/i,
      /track/i,
      /visual/i,
      /chart/i
    ],
    techPatterns: [
      'chart.js',
      'chartjs',
      'd3',
      'd3.js',
      'recharts',
      'victory',
      'nivo',
      'echarts',
      'plotly',
      'highcharts',
      'apexcharts',
      'grafana',
      'metabase',
      'mixpanel',
      'amplitude',
      'posthog',
      'plausible'
    ],
    weight: 1.0
  },

  game: {
    namePatterns: [
      /game/i,
      /play/i,
      /arcade/i,
      /puzzle/i,
      /rpg/i,
      /quest/i,
      /battle/i,
      /adventure/i,
      /platformer/i,
      /shooter/i
    ],
    techPatterns: [
      'phaser',
      'unity',
      'three',
      'three.js',
      'babylon',
      'babylonjs',
      'pixi',
      'pixijs',
      'kaboom',
      'excalibur',
      'matter-js',
      'cannon',
      'ammo',
      'rapier',
      'godot',
      'unreal',
      'gamemaker',
      'love2d',
      'pygame'
    ],
    weight: 1.1
  },

  api: {
    namePatterns: [
      /api/i,
      /server/i,
      /service/i,
      /backend/i,
      /gateway/i,
      /microservice/i,
      /rest/i,
      /graphql/i,
      /endpoint/i
    ],
    techPatterns: [
      'express',
      'fastapi',
      'flask',
      'django',
      'nestjs',
      'koa',
      'hapi',
      'fastify',
      'gin',
      'echo',
      'fiber',
      'actix',
      'rocket',
      'axum',
      'gorilla',
      'chi',
      'swagger',
      'openapi'
    ],
    weight: 0.9 // Lower weight since many projects have API components
  },

  cli: {
    namePatterns: [
      /cli/i,
      /tool/i,
      /utility/i,
      /script/i,
      /command/i,
      /terminal/i,
      /shell/i,
      /console/i
    ],
    techPatterns: [
      'commander',
      'yargs',
      'inquirer',
      'chalk',
      'ora',
      'meow',
      'oclif',
      'vorpal',
      'caporal',
      'clap',
      'structopt',
      'argh',
      'click',
      'typer',
      'argparse',
      'cobra',
      'cli-table',
      'boxen'
    ],
    weight: 1.1
  },

  library: {
    namePatterns: [
      /lib/i,
      /sdk/i,
      /core/i,
      /util/i,
      /helper/i,
      /common/i,
      /shared/i,
      /package/i,
      /module/i,
      /plugin/i
    ],
    techPatterns: [
      // Libraries typically have minimal dependencies
      // Detection relies more on name patterns and low dep count
    ],
    dirPatterns: ['src/lib', 'lib', 'packages'],
    weight: 0.8 // Lower weight, use as fallback
  }
};

/**
 * Detect the primary theme of a project based on naming patterns and tech stack
 *
 * @param project - Project metadata to analyze
 * @returns ThemeDetection with theme, confidence, and matched patterns
 */
export function detectTheme(
  project: ProjectMetadata | EnrichedProjectMetadata
): ThemeDetection {
  const scores: Map<ProjectTheme, { score: number; matches: string[] }> = new Map();

  // Initialize scores for all themes
  for (const theme of Object.keys(THEME_PATTERNS) as ProjectTheme[]) {
    scores.set(theme, { score: 0, matches: [] });
  }

  const projectNameLower = project.name.toLowerCase();
  const techLower = project.tech.map(t => t.toLowerCase());

  // Score each theme based on pattern matches
  for (const [theme, rules] of Object.entries(THEME_PATTERNS) as [
    Exclude<ProjectTheme, 'unknown'>,
    ThemeRule
  ][]) {
    const themeScore = scores.get(theme)!;
    const weight = rules.weight || 1.0;

    // Check name patterns
    for (const pattern of rules.namePatterns) {
      if (pattern.test(project.name)) {
        themeScore.score += 2 * weight; // Name matches are strong signals
        themeScore.matches.push(`name:${pattern.source}`);
      }
    }

    // Check tech patterns
    for (const techPattern of rules.techPatterns) {
      const patternLower = techPattern.toLowerCase();
      for (const tech of techLower) {
        if (tech.includes(patternLower) || patternLower.includes(tech)) {
          themeScore.score += 3 * weight; // Tech matches are very strong signals
          themeScore.matches.push(`tech:${techPattern}`);
        }
      }
    }

    // Check description for keywords (weaker signal)
    if (project.desc) {
      const descLower = project.desc.toLowerCase();
      for (const pattern of rules.namePatterns) {
        if (pattern.test(project.desc)) {
          themeScore.score += 0.5 * weight;
          themeScore.matches.push(`desc:${pattern.source}`);
        }
      }
    }
  }

  // Special case: Library detection based on low dependencies
  // If project has few dependencies and matches library name patterns, boost library score
  if (project.tech.length <= 3) {
    const libraryScore = scores.get('library')!;
    if (libraryScore.matches.length > 0) {
      libraryScore.score += 1;
      libraryScore.matches.push('low-deps');
    }
  }

  // Find the highest scoring theme
  let bestTheme: ProjectTheme = 'unknown';
  let bestScore = 0;
  let bestMatches: string[] = [];

  for (const [theme, data] of scores) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestTheme = theme;
      bestMatches = data.matches;
    }
  }

  // Calculate confidence (normalize score to 0-1 range)
  // Max realistic score: ~10 (2-3 name matches + 2-3 tech matches with weights)
  const confidence = Math.min(bestScore / 10, 1);

  // Require minimum confidence threshold
  if (confidence < 0.1) {
    return {
      theme: 'unknown',
      confidence: 0,
      matchedPatterns: []
    };
  }

  return {
    theme: bestTheme,
    confidence,
    matchedPatterns: [...new Set(bestMatches)] // Dedupe matches
  };
}

/**
 * Grouped projects by theme
 */
export interface ThemeGroup {
  theme: ProjectTheme;
  projects: Array<{
    project: ProjectMetadata | EnrichedProjectMetadata;
    detection: ThemeDetection;
  }>;
  count: number;
}

/**
 * Group projects by their detected themes
 *
 * @param projects - Array of projects to cluster
 * @param minConfidence - Minimum confidence threshold (default 0.1)
 * @returns Array of theme groups with their projects
 */
export function groupByTheme(
  projects: (ProjectMetadata | EnrichedProjectMetadata)[],
  minConfidence: number = 0.1
): ThemeGroup[] {
  const groups: Map<ProjectTheme, ThemeGroup> = new Map();

  // Initialize all theme groups
  const allThemes: ProjectTheme[] = [
    'ecommerce',
    'cms',
    'analytics',
    'game',
    'api',
    'cli',
    'library',
    'unknown'
  ];

  for (const theme of allThemes) {
    groups.set(theme, {
      theme,
      projects: [],
      count: 0
    });
  }

  // Classify each project
  for (const project of projects) {
    const detection = detectTheme(project);

    // Use detected theme if confidence meets threshold, otherwise 'unknown'
    const effectiveTheme =
      detection.confidence >= minConfidence ? detection.theme : 'unknown';

    const group = groups.get(effectiveTheme)!;
    group.projects.push({ project, detection });
    group.count++;
  }

  // Convert to array and filter out empty groups
  const result = Array.from(groups.values())
    .filter(group => group.count > 0)
    .sort((a, b) => {
      // Sort by count descending, but keep 'unknown' at the end
      if (a.theme === 'unknown') return 1;
      if (b.theme === 'unknown') return -1;
      return b.count - a.count;
    });

  return result;
}

/**
 * Get all detected themes for a project (may have multiple themes)
 * Useful when a project spans multiple domains (e.g., ecommerce + analytics)
 *
 * @param project - Project to analyze
 * @param minConfidence - Minimum confidence threshold
 * @returns Array of theme detections sorted by confidence
 */
export function detectAllThemes(
  project: ProjectMetadata | EnrichedProjectMetadata,
  minConfidence: number = 0.2
): ThemeDetection[] {
  const results: ThemeDetection[] = [];

  const projectNameLower = project.name.toLowerCase();
  const techLower = project.tech.map(t => t.toLowerCase());

  // Score each theme independently
  for (const [theme, rules] of Object.entries(THEME_PATTERNS) as [
    Exclude<ProjectTheme, 'unknown'>,
    ThemeRule
  ][]) {
    let score = 0;
    const matches: string[] = [];
    const weight = rules.weight || 1.0;

    // Check name patterns
    for (const pattern of rules.namePatterns) {
      if (pattern.test(project.name)) {
        score += 2 * weight;
        matches.push(`name:${pattern.source}`);
      }
    }

    // Check tech patterns
    for (const techPattern of rules.techPatterns) {
      const patternLower = techPattern.toLowerCase();
      for (const tech of techLower) {
        if (tech.includes(patternLower) || patternLower.includes(tech)) {
          score += 3 * weight;
          matches.push(`tech:${techPattern}`);
        }
      }
    }

    const confidence = Math.min(score / 10, 1);

    if (confidence >= minConfidence) {
      results.push({
        theme,
        confidence,
        matchedPatterns: [...new Set(matches)]
      });
    }
  }

  // Sort by confidence descending
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get theme statistics for a collection of projects
 */
export interface ThemeStatistics {
  totalProjects: number;
  classifiedProjects: number;
  unclassifiedProjects: number;
  themeDistribution: Record<ProjectTheme, number>;
  averageConfidence: number;
}

/**
 * Calculate theme statistics for a collection of projects
 *
 * @param projects - Array of projects to analyze
 * @returns Theme statistics
 */
export function getThemeStatistics(
  projects: (ProjectMetadata | EnrichedProjectMetadata)[]
): ThemeStatistics {
  const distribution: Record<ProjectTheme, number> = {
    ecommerce: 0,
    cms: 0,
    analytics: 0,
    game: 0,
    api: 0,
    cli: 0,
    library: 0,
    unknown: 0
  };

  let totalConfidence = 0;
  let classifiedCount = 0;

  for (const project of projects) {
    const detection = detectTheme(project);
    distribution[detection.theme]++;

    if (detection.theme !== 'unknown') {
      totalConfidence += detection.confidence;
      classifiedCount++;
    }
  }

  return {
    totalProjects: projects.length,
    classifiedProjects: classifiedCount,
    unclassifiedProjects: distribution.unknown,
    themeDistribution: distribution,
    averageConfidence:
      classifiedCount > 0 ? totalConfidence / classifiedCount : 0
  };
}

/**
 * Get human-readable theme label
 */
export function getThemeLabel(theme: ProjectTheme): string {
  const labels: Record<ProjectTheme, string> = {
    ecommerce: 'E-Commerce',
    cms: 'Content Management',
    analytics: 'Analytics & Dashboards',
    game: 'Games',
    api: 'APIs & Services',
    cli: 'CLI Tools',
    library: 'Libraries & SDKs',
    unknown: 'Uncategorized'
  };
  return labels[theme];
}

/**
 * Get theme description
 */
export function getThemeDescription(theme: ProjectTheme): string {
  const descriptions: Record<ProjectTheme, string> = {
    ecommerce: 'Shopping carts, payment processing, and online stores',
    cms: 'Content management, blogs, and publishing platforms',
    analytics: 'Data visualization, metrics, and reporting dashboards',
    game: 'Games, interactive experiences, and game engines',
    api: 'REST/GraphQL APIs, backend services, and microservices',
    cli: 'Command-line tools and terminal utilities',
    library: 'Reusable libraries, SDKs, and utility packages',
    unknown: 'Projects that don\'t match a specific theme pattern'
  };
  return descriptions[theme];
}
