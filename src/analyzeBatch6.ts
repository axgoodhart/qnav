/**
 * Batch 6 Tag Analysis Script
 * Analyzes projects 321-384 from /Users/alex/Documents/Cufolio
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TagDetector, flattenTags, countTags } from './tagDetector';
import { SemanticTags } from './tagTaxonomy';

interface ProjectAnalysis {
  name: string;
  path: string;
  isDirectory: boolean;
  tags: SemanticTags;
  flatTags: string[];
  tagCount: number;
  techStack: string[];
  fileCount: number;
}

interface TagDistribution {
  [category: string]: {
    [tag: string]: number;
  };
}

interface BatchReport {
  batchInfo: {
    batchNumber: number;
    projectRange: string;
    totalProjects: number;
    analyzedAt: string;
    status: string;
  };
  projects: ProjectAnalysis[];
  tagDistribution: TagDistribution;
  summary: {
    totalProjectsAnalyzed: number;
    projectsWithTags: number;
    projectsWithoutTags: number;
    averageTagsPerProject: number;
    mostCommonTags: Array<{ tag: string; count: number }>;
    categoryDistribution: { [category: string]: number };
  };
}

async function getTechStack(projectPath: string): Promise<string[]> {
  const techStack: string[] = [];

  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const fileNames = entries.map(e => e.name.toLowerCase());

    // Detect by file extensions and config files
    if (fileNames.some(f => f.endsWith('.html'))) techStack.push('HTML');
    if (fileNames.some(f => f.endsWith('.css') || f.includes('tailwind') || f.includes('scss'))) techStack.push('CSS');
    if (fileNames.some(f => f.endsWith('.js') || f === 'package.json')) techStack.push('JavaScript');
    if (fileNames.some(f => f.endsWith('.ts') || f === 'tsconfig.json')) techStack.push('TypeScript');
    if (fileNames.some(f => f.endsWith('.py') || f === 'requirements.txt' || f === 'setup.py')) techStack.push('Python');
    if (fileNames.some(f => f.endsWith('.jsx') || f.endsWith('.tsx'))) techStack.push('React');
    if (fileNames.some(f => f.endsWith('.vue'))) techStack.push('Vue');
    if (fileNames.some(f => f.endsWith('.svelte'))) techStack.push('Svelte');
    if (fileNames.some(f => f === 'next.config.js' || f === 'next.config.mjs')) techStack.push('Next.js');
    if (fileNames.some(f => f === 'nuxt.config.js' || f === 'nuxt.config.ts')) techStack.push('Nuxt');
    if (fileNames.some(f => f.endsWith('.php'))) techStack.push('PHP');
    if (fileNames.some(f => f.endsWith('.rb') || f === 'gemfile')) techStack.push('Ruby');
    if (fileNames.some(f => f.endsWith('.java'))) techStack.push('Java');
    if (fileNames.some(f => f.endsWith('.go') || f === 'go.mod')) techStack.push('Go');
    if (fileNames.some(f => f.endsWith('.rs') || f === 'cargo.toml')) techStack.push('Rust');
    if (fileNames.some(f => f === 'dockerfile' || f === 'docker-compose.yml')) techStack.push('Docker');
  } catch {
    // Skip if can't read directory
  }

  return techStack;
}

async function countFiles(projectPath: string): Promise<number> {
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) return 1;

    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      count++;
    }

    return count;
  } catch {
    return 0;
  }
}

async function analyzeProject(
  detector: TagDetector,
  projectName: string,
  cufolioPath: string
): Promise<ProjectAnalysis> {
  const projectPath = path.join(cufolioPath, projectName);

  let isDirectory = false;
  try {
    const stat = await fs.stat(projectPath);
    isDirectory = stat.isDirectory();
  } catch {
    // File might not be accessible
  }

  const techStack = isDirectory ? await getTechStack(projectPath) : [];
  const fileCount = await countFiles(projectPath);

  const tags = await detector.detectTags(
    projectPath,
    projectName,
    techStack,
    fileCount
  );

  return {
    name: projectName,
    path: projectPath,
    isDirectory,
    tags,
    flatTags: flattenTags(tags),
    tagCount: countTags(tags),
    techStack,
    fileCount,
  };
}

function buildTagDistribution(projects: ProjectAnalysis[]): TagDistribution {
  const distribution: TagDistribution = {};

  for (const project of projects) {
    for (const flatTag of project.flatTags) {
      const [category, tag] = flatTag.split(':');
      if (!distribution[category]) {
        distribution[category] = {};
      }
      distribution[category][tag] = (distribution[category][tag] || 0) + 1;
    }
  }

  return distribution;
}

function buildSummary(projects: ProjectAnalysis[], distribution: TagDistribution) {
  const projectsWithTags = projects.filter(p => p.tagCount > 0).length;
  const totalTags = projects.reduce((sum, p) => sum + p.tagCount, 0);

  // Flatten all tags with counts
  const tagCounts: { tag: string; count: number }[] = [];
  for (const [category, tags] of Object.entries(distribution)) {
    for (const [tag, count] of Object.entries(tags)) {
      tagCounts.push({ tag: `${category}:${tag}`, count });
    }
  }
  tagCounts.sort((a, b) => b.count - a.count);

  // Category totals
  const categoryDistribution: { [category: string]: number } = {};
  for (const [category, tags] of Object.entries(distribution)) {
    categoryDistribution[category] = Object.values(tags).reduce((sum, count) => sum + count, 0);
  }

  return {
    totalProjectsAnalyzed: projects.length,
    projectsWithTags,
    projectsWithoutTags: projects.length - projectsWithTags,
    averageTagsPerProject: projects.length > 0 ? Number((totalTags / projects.length).toFixed(2)) : 0,
    mostCommonTags: tagCounts.slice(0, 20),
    categoryDistribution,
  };
}

async function main() {
  const cufolioPath = '/Users/alex/Documents/Cufolio';
  const reportPath = path.join(__dirname, 'reports', 'batch6-tags.json');

  console.log('Batch 6 Tag Analysis Starting...');
  console.log('Analyzing projects 321-384 from Cufolio\n');

  // Get project list - skip first 320, take next 64
  const allProjects = await fs.readdir(cufolioPath);
  const batch6Projects = allProjects.slice(320, 384);

  console.log(`Found ${batch6Projects.length} projects in batch 6:\n`);
  batch6Projects.forEach((p, i) => console.log(`  ${321 + i}. ${p}`));
  console.log('');

  const detector = new TagDetector();
  const analyses: ProjectAnalysis[] = [];

  for (let i = 0; i < batch6Projects.length; i++) {
    const projectName = batch6Projects[i];
    console.log(`Analyzing [${i + 1}/${batch6Projects.length}]: ${projectName}`);

    try {
      const analysis = await analyzeProject(detector, projectName, cufolioPath);
      analyses.push(analysis);

      if (analysis.tagCount > 0) {
        console.log(`  ✓ Found ${analysis.tagCount} tags: ${analysis.flatTags.slice(0, 5).join(', ')}${analysis.flatTags.length > 5 ? '...' : ''}`);
      } else {
        console.log(`  - No tags detected`);
      }
    } catch (err) {
      console.error(`  ✗ Error: ${err}`);
      analyses.push({
        name: projectName,
        path: path.join(cufolioPath, projectName),
        isDirectory: false,
        tags: {},
        flatTags: [],
        tagCount: 0,
        techStack: [],
        fileCount: 0,
      });
    }
  }

  const distribution = buildTagDistribution(analyses);
  const summary = buildSummary(analyses, distribution);

  const report: BatchReport = {
    batchInfo: {
      batchNumber: 6,
      projectRange: '321-384',
      totalProjects: batch6Projects.length,
      analyzedAt: new Date().toISOString(),
      status: 'completed',
    },
    projects: analyses,
    tagDistribution: distribution,
    summary,
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('BATCH 6 ANALYSIS COMPLETE');
  console.log('='.repeat(60));
  console.log(`\nTotal Projects Analyzed: ${summary.totalProjectsAnalyzed}`);
  console.log(`Projects with Tags: ${summary.projectsWithTags}`);
  console.log(`Projects without Tags: ${summary.projectsWithoutTags}`);
  console.log(`Average Tags per Project: ${summary.averageTagsPerProject}`);
  console.log(`\nTop 10 Most Common Tags:`);
  summary.mostCommonTags.slice(0, 10).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.tag} (${t.count})`);
  });
  console.log(`\nCategory Distribution:`);
  Object.entries(summary.categoryDistribution)
    .sort(([,a], [,b]) => b - a)
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch(console.error);
