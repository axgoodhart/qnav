/**
 * Batch 1 Tag Analysis Script
 * Analyzes projects 1-64 and generates tag distribution report
 */

const { TagDetector, flattenTags, countTags } = require('../../dist/tagDetector');
const fs = require('fs').promises;
const path = require('path');

async function analyzeProjects() {
  const cufolioPath = '/Users/alex/Documents/Cufolio';
  const detector = new TagDetector();

  // Get all items and filter to first 64 valid project entries
  const allItems = await fs.readdir(cufolioPath);
  const projects = allItems
    .filter(item => !item.startsWith('.') && !item.startsWith('__') && item !== 'cunav')
    .slice(0, 64);

  console.log('Analyzing', projects.length, 'projects...');

  const results = {
    totalProjects: 0,
    projectsAnalyzed: [],
    tagDistribution: {},
    categoryDistribution: {},
    projectsWithMostTags: [],
    projectsWithFewestTags: [],
    projectsWithZeroTags: [],
    topTags: [],
    batchInfo: {
      batch: 1,
      range: '1-64',
      generatedAt: new Date().toISOString()
    }
  };

  for (const projectName of projects) {
    const projectPath = path.join(cufolioPath, projectName);

    try {
      const stat = await fs.stat(projectPath);
      const isDir = stat.isDirectory();

      // Get file count for directories
      let fileCount = 1;
      let techStack = [];

      if (isDir) {
        const files = await fs.readdir(projectPath).catch(() => []);
        fileCount = files.length;

        // Detect tech stack from files
        if (files.some(f => f === 'package.json')) techStack.push('node');
        if (files.some(f => f.endsWith('.py') || f === 'requirements.txt')) techStack.push('python');
        if (files.some(f => f.endsWith('.ts') || f === 'tsconfig.json')) techStack.push('typescript');
        if (files.some(f => f.endsWith('.html'))) techStack.push('html');
        if (files.some(f => f.endsWith('.css'))) techStack.push('css');
        if (files.some(f => f.endsWith('.js'))) techStack.push('javascript');
      } else {
        // Single file project
        if (projectName.endsWith('.html')) techStack.push('html');
        if (projectName.endsWith('.py')) techStack.push('python');
        if (projectName.endsWith('.js')) techStack.push('javascript');
        if (projectName.endsWith('.txt')) techStack.push('text');
        if (projectName.endsWith('.rtf')) techStack.push('richtext');
        if (projectName.endsWith('.zip')) techStack.push('archive');
      }

      // Calculate days since activity
      const daysSinceActivity = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));

      const tags = await detector.detectTags(projectPath, projectName, techStack, fileCount, daysSinceActivity);
      const tagList = flattenTags(tags);
      const tagCount = countTags(tags);

      results.totalProjects++;

      const projectInfo = {
        name: projectName,
        isDirectory: isDir,
        tagCount,
        tags: tagList,
        techStack
      };

      results.projectsAnalyzed.push(projectInfo);

      // Track tag distribution
      for (const tag of tagList) {
        results.tagDistribution[tag] = (results.tagDistribution[tag] || 0) + 1;

        const category = tag.split(':')[0];
        results.categoryDistribution[category] = (results.categoryDistribution[category] || 0) + 1;
      }

      if (tagCount === 0) {
        results.projectsWithZeroTags.push(projectName);
      }

    } catch (err) {
      console.error('Error analyzing', projectName, err.message);
    }
  }

  // Sort projects by tag count
  const sorted = [...results.projectsAnalyzed].sort((a, b) => b.tagCount - a.tagCount);
  results.projectsWithMostTags = sorted.slice(0, 10).map(p => ({ name: p.name, tagCount: p.tagCount, tags: p.tags }));
  results.projectsWithFewestTags = sorted.slice(-10).reverse().map(p => ({ name: p.name, tagCount: p.tagCount, tags: p.tags }));

  // Top 10 most common tags
  const tagsSorted = Object.entries(results.tagDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  results.topTags = tagsSorted.map(([tag, count]) => ({ tag, count }));

  // Write report
  await fs.mkdir('./src/reports', { recursive: true });
  await fs.writeFile('./src/reports/batch1-tags.json', JSON.stringify(results, null, 2));

  console.log('\n=== Batch 1 Tag Analysis Report ===');
  console.log('Total projects analyzed:', results.totalProjects);
  console.log('\nTop 10 Tags:');
  results.topTags.forEach(t => console.log('  ', t.tag, '-', t.count));
  console.log('\nCategory Distribution:');
  Object.entries(results.categoryDistribution).sort((a,b) => b[1]-a[1]).forEach(([cat, count]) => console.log('  ', cat, '-', count));
  console.log('\nProjects with 0 tags:', results.projectsWithZeroTags.length);
  if (results.projectsWithZeroTags.length > 0) {
    console.log('  ', results.projectsWithZeroTags.slice(0, 5).join(', '), results.projectsWithZeroTags.length > 5 ? '...' : '');
  }
  console.log('\nReport saved to src/reports/batch1-tags.json');
}

analyzeProjects().catch(console.error);
