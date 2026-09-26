/**
 * Merge All Batch Reports into Full Tag Analysis
 * Combines all 8 batch reports into a comprehensive summary
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface FullTagAnalysis {
  generatedAt: string;
  totalProjects: number;
  batchesAnalyzed: number;
  overallTagDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  top20Tags: Array<{ tag: string; count: number; percentage: string }>;
  tagCategoryBreakdown: Record<string, {
    tagCount: number;
    topTags: Array<{ tag: string; count: number }>;
  }>;
  coverageStatistics: {
    projectsWithTags: number;
    projectsWithNoTags: number;
    averageTagsPerProject: number;
    medianTagsPerProject: number;
    minTags: number;
    maxTags: number;
    tagCoverage: string;
  };
  batchSummaries: Array<{
    batch: number;
    range: string;
    projectCount: number;
    totalTags: number;
    averageTagsPerProject: number;
  }>;
}

function extractTagDistribution(batchData: any): Record<string, number> {
  // Handle various batch report formats
  if (batchData.tagDistribution && typeof batchData.tagDistribution === 'object') {
    // Check if it's nested by category
    const firstKey = Object.keys(batchData.tagDistribution)[0];
    if (firstKey && typeof batchData.tagDistribution[firstKey] === 'object' && !Array.isArray(batchData.tagDistribution[firstKey])) {
      // Nested format like batch4: { architecture: { "static-site": 48 } }
      const flat: Record<string, number> = {};
      for (const [category, tags] of Object.entries(batchData.tagDistribution)) {
        for (const [tag, count] of Object.entries(tags as Record<string, number>)) {
          flat[`${category}:${tag}`] = count;
        }
      }
      return flat;
    }
    // Flat format: { "tag:value": count }
    return batchData.tagDistribution;
  }

  // Extract from projects array if available
  if (batchData.projects && Array.isArray(batchData.projects)) {
    const dist: Record<string, number> = {};
    for (const project of batchData.projects) {
      const tags = project.flatTags || project.tags || [];
      const tagList = Array.isArray(tags) ? tags : [];
      for (const tag of tagList) {
        if (typeof tag === 'string') {
          dist[tag] = (dist[tag] || 0) + 1;
        }
      }
    }
    return dist;
  }

  // Extract from projectsAnalyzed array (batch1 format)
  if (batchData.projectsAnalyzed && Array.isArray(batchData.projectsAnalyzed)) {
    const dist: Record<string, number> = {};
    for (const project of batchData.projectsAnalyzed) {
      const tags = project.tags || [];
      for (const tag of tags) {
        if (typeof tag === 'string') {
          dist[tag] = (dist[tag] || 0) + 1;
        }
      }
    }
    return dist;
  }

  return {};
}

function extractProjectCount(batchData: any): number {
  return batchData.projectCount ||
         batchData.totalProjects ||
         batchData.summary?.totalProjects ||
         batchData.projects?.length ||
         batchData.projectsAnalyzed?.length ||
         0;
}

function extractTagCounts(batchData: any): number[] {
  const counts: number[] = [];

  if (batchData.projects && Array.isArray(batchData.projects)) {
    for (const project of batchData.projects) {
      counts.push(project.tagCount || (project.flatTags?.length || 0));
    }
  } else if (batchData.projectsAnalyzed && Array.isArray(batchData.projectsAnalyzed)) {
    for (const project of batchData.projectsAnalyzed) {
      counts.push(project.tagCount || (project.tags?.length || 0));
    }
  }

  return counts;
}

function extractBatchRange(batchData: any, batchNum: number): string {
  return batchData.batchRange ||
         batchData.range?.toString() ||
         batchData.projectRange ||
         batchData.batchInfo?.projectRange ||
         `Batch ${batchNum}`;
}

async function main() {
  const reportsPath = '/Users/alex/Documents/Cufolio/cunav/src/reports';

  console.log('Loading all batch reports...');

  const overallTagDistribution: Record<string, number> = {};
  const allTagCounts: number[] = [];
  const batchSummaries: FullTagAnalysis['batchSummaries'] = [];
  let totalProjects = 0;

  for (let i = 1; i <= 8; i++) {
    const batchFile = path.join(reportsPath, `batch${i}-tags.json`);

    try {
      const content = await fs.readFile(batchFile, 'utf-8');
      const batchData = JSON.parse(content);

      const projectCount = extractProjectCount(batchData);
      const tagDist = extractTagDistribution(batchData);
      const tagCounts = extractTagCounts(batchData);

      totalProjects += projectCount;
      allTagCounts.push(...tagCounts);

      // Merge tag distribution
      for (const [tag, count] of Object.entries(tagDist)) {
        overallTagDistribution[tag] = (overallTagDistribution[tag] || 0) + count;
      }

      // Calculate batch total tags
      const batchTotalTags = Object.values(tagDist).reduce((a, b) => a + b, 0);

      batchSummaries.push({
        batch: i,
        range: extractBatchRange(batchData, i),
        projectCount,
        totalTags: batchTotalTags,
        averageTagsPerProject: projectCount > 0 ? batchTotalTags / projectCount : 0,
      });

      console.log(`  Batch ${i}: ${projectCount} projects, ${batchTotalTags} tags`);
    } catch (error) {
      console.error(`  Error loading batch ${i}:`, error);
    }
  }

  console.log(`\nTotal projects across all batches: ${totalProjects}`);

  // Calculate category distribution
  const categoryDistribution: Record<string, number> = {};
  for (const [tag, count] of Object.entries(overallTagDistribution)) {
    const category = tag.split(':')[0];
    categoryDistribution[category] = (categoryDistribution[category] || 0) + count;
  }

  // Sort tags by count
  const sortedTags = Object.entries(overallTagDistribution)
    .sort((a, b) => b[1] - a[1]);

  const totalTagInstances = Object.values(overallTagDistribution).reduce((a, b) => a + b, 0);

  // Top 20 tags with percentage
  const top20Tags = sortedTags.slice(0, 20).map(([tag, count]) => ({
    tag,
    count,
    percentage: ((count / totalProjects) * 100).toFixed(1) + '%',
  }));

  // Tag category breakdown
  const tagCategoryBreakdown: Record<string, { tagCount: number; topTags: Array<{ tag: string; count: number }> }> = {};

  for (const category of Object.keys(categoryDistribution)) {
    const categoryTags = sortedTags
      .filter(([tag]) => tag.startsWith(category + ':'))
      .slice(0, 10)
      .map(([tag, count]) => ({ tag: tag.replace(category + ':', ''), count }));

    tagCategoryBreakdown[category] = {
      tagCount: categoryDistribution[category],
      topTags: categoryTags,
    };
  }

  // Coverage statistics
  const sortedTagCounts = [...allTagCounts].sort((a, b) => a - b);
  const projectsWithNoTags = allTagCounts.filter(c => c === 0).length;
  const medianIndex = Math.floor(sortedTagCounts.length / 2);

  const coverageStatistics = {
    projectsWithTags: totalProjects - projectsWithNoTags,
    projectsWithNoTags,
    averageTagsPerProject: totalProjects > 0 ? totalTagInstances / totalProjects : 0,
    medianTagsPerProject: sortedTagCounts.length > 0 ? sortedTagCounts[medianIndex] : 0,
    minTags: Math.min(...allTagCounts, 0),
    maxTags: Math.max(...allTagCounts, 0),
    tagCoverage: totalProjects > 0
      ? ((totalProjects - projectsWithNoTags) / totalProjects * 100).toFixed(1) + '%'
      : '0%',
  };

  const fullAnalysis: FullTagAnalysis = {
    generatedAt: new Date().toISOString(),
    totalProjects,
    batchesAnalyzed: 8,
    overallTagDistribution,
    categoryDistribution,
    top20Tags,
    tagCategoryBreakdown,
    coverageStatistics,
    batchSummaries,
  };

  // Write the full analysis
  await fs.writeFile(
    path.join(reportsPath, 'full-tag-analysis.json'),
    JSON.stringify(fullAnalysis, null, 2)
  );

  console.log('\n=== FULL TAG ANALYSIS COMPLETE ===');
  console.log(`Total Projects: ${totalProjects}`);
  console.log(`Total Tag Instances: ${totalTagInstances}`);
  console.log(`Unique Tags: ${Object.keys(overallTagDistribution).length}`);
  console.log(`Average Tags per Project: ${coverageStatistics.averageTagsPerProject.toFixed(2)}`);
  console.log(`Tag Coverage: ${coverageStatistics.tagCoverage}`);
  console.log(`\nTop 20 Most Common Tags:`);
  top20Tags.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.tag}: ${t.count} (${t.percentage})`);
  });
  console.log(`\nCategory Breakdown:`);
  Object.entries(categoryDistribution)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count} instances`);
    });

  console.log(`\nFull analysis saved to: ${path.join(reportsPath, 'full-tag-analysis.json')}`);
}

main().catch(console.error);
