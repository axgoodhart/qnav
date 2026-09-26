#!/usr/bin/env node
/**
 * Batch 2 Tag Analysis Script
 * Analyzes projects 65-128 for semantic tag coverage
 */

const path = require('path');
const fs = require('fs/promises');
const { TagDetector, flattenTags, countTags } = require('../../dist/tagDetector');

const CUFOLIO_PATH = '/Users/alex/Documents/Cufolio';
const BATCH_START = 65;
const BATCH_SIZE = 64;

async function getProjectStats(projectPath) {
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) {
      return null;
    }

    // Count files
    let fileCount = 0;
    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true, recursive: false });
      for (const entry of entries) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          fileCount++;
        }
      }
    } catch {
      fileCount = 0;
    }

    // Get days since activity
    const daysSinceActivity = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));

    return { fileCount, daysSinceActivity };
  } catch {
    return null;
  }
}

async function detectTechStack(projectPath) {
  const techStack = [];

  try {
    const files = await fs.readdir(projectPath);

    // Check for common indicators
    if (files.includes('package.json')) {
      techStack.push('Node.js');
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.react) techStack.push('React');
        if (allDeps.vue) techStack.push('Vue');
        if (allDeps.angular) techStack.push('Angular');
        if (allDeps.typescript) techStack.push('TypeScript');
        if (allDeps.express) techStack.push('Express');
        if (allDeps.next) techStack.push('Next.js');
      } catch {}
    }

    if (files.some(f => f.endsWith('.html'))) techStack.push('HTML');
    if (files.some(f => f.endsWith('.css'))) techStack.push('CSS');
    if (files.some(f => f.endsWith('.js') && !f.includes('.config.'))) techStack.push('JavaScript');
    if (files.some(f => f.endsWith('.ts'))) techStack.push('TypeScript');
    if (files.some(f => f.endsWith('.py'))) techStack.push('Python');
    if (files.includes('Cargo.toml')) techStack.push('Rust');
    if (files.includes('go.mod')) techStack.push('Go');

  } catch {}

  return [...new Set(techStack)];
}

async function main() {
  console.log('Batch 2 Tag Analysis: Projects 65-128');
  console.log('=' .repeat(50));

  // Get all projects
  const allProjects = await fs.readdir(CUFOLIO_PATH);
  const batch = allProjects.slice(BATCH_START - 1, BATCH_START - 1 + BATCH_SIZE);

  console.log(`Analyzing ${batch.length} projects...\n`);

  const detector = new TagDetector();
  const results = [];
  const tagDistribution = {};
  const projectsWithZeroTags = [];

  for (const projectName of batch) {
    const projectPath = path.join(CUFOLIO_PATH, projectName);
    const stats = await getProjectStats(projectPath);

    if (!stats) {
      // Not a directory
      results.push({
        name: projectName,
        isDirectory: false,
        tags: {},
        tagCount: 0
      });
      continue;
    }

    const techStack = await detectTechStack(projectPath);

    try {
      const tags = await detector.detectTags(
        projectPath,
        projectName,
        techStack,
        stats.fileCount,
        stats.daysSinceActivity
      );

      const tagCount = countTags(tags);
      const flatTags = flattenTags(tags);

      // Count tag distribution
      for (const tag of flatTags) {
        tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
      }

      results.push({
        name: projectName,
        isDirectory: true,
        techStack,
        tags,
        tagCount,
        flatTags
      });

      if (tagCount === 0) {
        projectsWithZeroTags.push(projectName);
      }

    } catch (err) {
      results.push({
        name: projectName,
        isDirectory: true,
        error: err.message,
        tags: {},
        tagCount: 0
      });
    }
  }

  // Sort projects by tag count
  const sortedByTags = [...results]
    .filter(r => r.isDirectory)
    .sort((a, b) => b.tagCount - a.tagCount);

  // Sort tag distribution
  const sortedTags = Object.entries(tagDistribution)
    .sort((a, b) => b[1] - a[1]);

  // Build report
  const report = {
    batch: 2,
    batchRange: '65-128',
    generatedAt: new Date().toISOString(),
    summary: {
      totalProjects: batch.length,
      analyzedDirectories: results.filter(r => r.isDirectory).length,
      nonDirectoryItems: results.filter(r => !r.isDirectory).length,
      projectsWithZeroTags: projectsWithZeroTags.length,
      totalUniqueTagTypes: Object.keys(tagDistribution).length,
      totalTagInstances: Object.values(tagDistribution).reduce((a, b) => a + b, 0),
      averageTagsPerProject: (
        results.filter(r => r.isDirectory).reduce((sum, r) => sum + r.tagCount, 0) /
        results.filter(r => r.isDirectory).length
      ).toFixed(2)
    },
    tagDistribution: Object.fromEntries(sortedTags),
    topTags: sortedTags.slice(0, 20).map(([tag, count]) => ({ tag, count })),
    projectsWithMostTags: sortedByTags.slice(0, 10).map(p => ({
      name: p.name,
      tagCount: p.tagCount,
      tags: p.flatTags
    })),
    projectsWithFewestTags: sortedByTags.slice(-10).reverse().map(p => ({
      name: p.name,
      tagCount: p.tagCount,
      tags: p.flatTags || []
    })),
    projectsWithZeroTags,
    projectDetails: results.map(r => ({
      name: r.name,
      isDirectory: r.isDirectory,
      tagCount: r.tagCount,
      techStack: r.techStack,
      tags: r.tags,
      error: r.error
    }))
  };

  // Write report
  const reportPath = path.join(__dirname, '../reports/batch2-tags.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('Summary:');
  console.log(`  Total projects: ${report.summary.totalProjects}`);
  console.log(`  Analyzed directories: ${report.summary.analyzedDirectories}`);
  console.log(`  Non-directory items: ${report.summary.nonDirectoryItems}`);
  console.log(`  Projects with 0 tags: ${report.summary.projectsWithZeroTags}`);
  console.log(`  Unique tag types: ${report.summary.totalUniqueTagTypes}`);
  console.log(`  Average tags/project: ${report.summary.averageTagsPerProject}`);
  console.log('\nTop 10 tags:');
  sortedTags.slice(0, 10).forEach(([tag, count]) => {
    console.log(`  ${tag}: ${count}`);
  });
  console.log('\nProjects with most tags:');
  sortedByTags.slice(0, 5).forEach(p => {
    console.log(`  ${p.name}: ${p.tagCount} tags`);
  });
  console.log('\nProjects with 0 tags:');
  projectsWithZeroTags.forEach(p => {
    console.log(`  ${p}`);
  });

  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch(console.error);
