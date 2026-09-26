/**
 * Batch 5 Tag Analysis Script
 * Analyzes projects 257-320 (Maize through Omneon) for semantic tags
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TagDetector, flattenTags, countTags } from './tagDetector';
import { MetadataDetector } from './metadataDetector';

const CUFOLIO_PATH = '/Users/alex/Documents/Cufolio';
const START_INDEX = 256; // 0-indexed, so 257th item
const BATCH_SIZE = 64;

interface ProjectTagResult {
  name: string;
  path: string;
  isDirectory: boolean;
  techStack: string[];
  tags: Record<string, string | string[]>;
  tagCount: number;
  flatTags: string[];
}

interface BatchReport {
  batchNumber: 5;
  range: string;
  analyzedAt: string;
  totalProjects: number;
  directoriesAnalyzed: number;
  filesSkipped: number;
  tagDistribution: Record<string, number>;
  categoryDistribution: Record<string, Record<string, number>>;
  projectsWithNoTags: string[];
  projectsWithMostTags: { name: string; count: number }[];
  results: ProjectTagResult[];
}

async function getFileCount(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let count = entries.filter(e => e.isFile()).length;

    for (const entry of entries) {
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
        try {
          const subEntries = await fs.readdir(path.join(dirPath, entry.name));
          count += subEntries.length;
        } catch {
          // Skip unreadable
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function main() {
  console.log('Starting Batch 5 Tag Analysis (projects 257-320)...\n');

  const tagDetector = new TagDetector();
  const metadataDetector = new MetadataDetector();

  // Get all entries in Cufolio
  const allEntries = await fs.readdir(CUFOLIO_PATH, { withFileTypes: true });
  allEntries.sort((a, b) => a.name.localeCompare(b.name));

  // Get batch 5 entries (257-320)
  const batchEntries = allEntries.slice(START_INDEX, START_INDEX + BATCH_SIZE);

  console.log(`Found ${batchEntries.length} entries in batch 5\n`);
  console.log('Projects in this batch:');
  batchEntries.forEach((e, i) => console.log(`  ${START_INDEX + i + 1}. ${e.name} (${e.isDirectory() ? 'dir' : 'file'})`));
  console.log('');

  const results: ProjectTagResult[] = [];
  const tagDistribution: Record<string, number> = {};
  const categoryDistribution: Record<string, Record<string, number>> = {};
  let directoriesAnalyzed = 0;
  let filesSkipped = 0;

  for (const entry of batchEntries) {
    const entryPath = path.join(CUFOLIO_PATH, entry.name);

    if (!entry.isDirectory()) {
      filesSkipped++;
      results.push({
        name: entry.name,
        path: entryPath,
        isDirectory: false,
        techStack: [],
        tags: {},
        tagCount: 0,
        flatTags: []
      });
      continue;
    }

    directoriesAnalyzed++;
    console.log(`Analyzing: ${entry.name}...`);

    // Get metadata for tech stack
    const metadata = await metadataDetector.detectMetadata(entryPath);
    const fileCount = await getFileCount(entryPath);

    // Detect tags
    const tags = await tagDetector.detectTags(
      entryPath,
      entry.name,
      metadata.tech,
      fileCount
    );

    const flat = flattenTags(tags);
    const count = countTags(tags);

    // Update distribution
    for (const tag of flat) {
      tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;

      // Category distribution
      const [category, value] = tag.split(':');
      if (!categoryDistribution[category]) {
        categoryDistribution[category] = {};
      }
      categoryDistribution[category][value] = (categoryDistribution[category][value] || 0) + 1;
    }

    results.push({
      name: entry.name,
      path: entryPath,
      isDirectory: true,
      techStack: metadata.tech,
      tags: tags as Record<string, string | string[]>,
      tagCount: count,
      flatTags: flat
    });
  }

  // Find projects with most tags
  const sortedByTags = results
    .filter(r => r.isDirectory)
    .sort((a, b) => b.tagCount - a.tagCount)
    .slice(0, 10)
    .map(r => ({ name: r.name, count: r.tagCount }));

  // Find projects with no tags
  const noTags = results
    .filter(r => r.isDirectory && r.tagCount === 0)
    .map(r => r.name);

  const report: BatchReport = {
    batchNumber: 5,
    range: 'Projects 257-320 (Maize through Omneon)',
    analyzedAt: new Date().toISOString(),
    totalProjects: batchEntries.length,
    directoriesAnalyzed,
    filesSkipped,
    tagDistribution,
    categoryDistribution,
    projectsWithNoTags: noTags,
    projectsWithMostTags: sortedByTags,
    results
  };

  // Write report
  const reportPath = path.join(__dirname, 'reports', 'batch5-tags.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('\n========================================');
  console.log('BATCH 5 TAG ANALYSIS COMPLETE');
  console.log('========================================');
  console.log(`Total entries: ${batchEntries.length}`);
  console.log(`Directories analyzed: ${directoriesAnalyzed}`);
  console.log(`Files skipped: ${filesSkipped}`);
  console.log(`Unique tags found: ${Object.keys(tagDistribution).length}`);
  console.log(`Projects with no tags: ${noTags.length}`);
  console.log(`\nTop 10 projects by tag count:`);
  sortedByTags.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}: ${p.count} tags`));
  console.log(`\nReport written to: ${reportPath}`);
}

main().catch(console.error);
