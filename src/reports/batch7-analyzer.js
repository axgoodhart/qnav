/**
 * Batch 7 Tag Analyzer
 * Analyzes projects 385-448 from Cufolio directory
 */

const fs = require('fs').promises;
const path = require('path');
const { TagDetector, flattenTags, countTags } = require('../../dist/tagDetector');

const CUFOLIO_PATH = '/Users/alex/Documents/Cufolio';
const BATCH_START = 385;
const BATCH_SIZE = 64;

async function getTechStack(projectPath) {
  const techStack = [];

  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const files = entries.map(e => e.name.toLowerCase());

    // Check file extensions and common files
    if (files.some(f => f.endsWith('.html'))) techStack.push('HTML');
    if (files.some(f => f.endsWith('.css'))) techStack.push('CSS');
    if (files.some(f => f.endsWith('.js'))) techStack.push('JavaScript');
    if (files.some(f => f.endsWith('.ts'))) techStack.push('TypeScript');
    if (files.some(f => f.endsWith('.jsx') || f.endsWith('.tsx'))) techStack.push('React');
    if (files.some(f => f.endsWith('.vue'))) techStack.push('Vue');
    if (files.some(f => f.endsWith('.svelte'))) techStack.push('Svelte');
    if (files.some(f => f.endsWith('.py'))) techStack.push('Python');
    if (files.includes('package.json')) techStack.push('Node.js');
    if (files.includes('cargo.toml')) techStack.push('Rust');
    if (files.includes('go.mod')) techStack.push('Go');

    // Check package.json for frameworks
    try {
      const pkgPath = path.join(projectPath, 'package.json');
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.react) techStack.push('React');
      if (deps.vue) techStack.push('Vue');
      if (deps.svelte) techStack.push('Svelte');
      if (deps.next) techStack.push('Next.js');
      if (deps.nuxt) techStack.push('Nuxt');
      if (deps.express) techStack.push('Express');
      if (deps['tone']) techStack.push('Tone.js');
      if (deps['three']) techStack.push('Three.js');
    } catch {}
  } catch {}

  return [...new Set(techStack)];
}

async function getFileCount(projectPath) {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true, recursive: false });
    return entries.length;
  } catch {
    return 0;
  }
}

async function analyzeBatch() {
  const detector = new TagDetector();
  const results = {
    batchId: 7,
    range: { start: BATCH_START, end: BATCH_START + BATCH_SIZE - 1 },
    analyzedAt: new Date().toISOString(),
    projectCount: 0,
    tagDistribution: {},
    categoryDistribution: {},
    projectsWithTags: 0,
    projectsWithoutTags: 0,
    projects: []
  };

  // Get all projects
  const allProjects = await fs.readdir(CUFOLIO_PATH);
  const batch = allProjects.slice(BATCH_START - 1, BATCH_START - 1 + BATCH_SIZE);

  console.log(`Analyzing ${batch.length} projects (${BATCH_START}-${BATCH_START + batch.length - 1})`);

  for (const projectName of batch) {
    const projectPath = path.join(CUFOLIO_PATH, projectName);

    try {
      const stats = await fs.stat(projectPath);

      // Skip non-directories and special files
      if (!stats.isDirectory() && !projectName.endsWith('.html')) {
        continue;
      }

      const techStack = await getTechStack(projectPath);
      const fileCount = await getFileCount(projectPath);

      let tags;
      if (stats.isDirectory()) {
        tags = await detector.detectTags(projectPath, projectName, techStack, fileCount);
      } else {
        // For HTML files, analyze based on filename
        tags = await detector.detectTags(path.dirname(projectPath), projectName, ['HTML'], 1);
      }

      const tagCount = countTags(tags);
      const flatTags = flattenTags(tags);

      results.projectCount++;

      if (tagCount > 0) {
        results.projectsWithTags++;
      } else {
        results.projectsWithoutTags++;
      }

      // Track tag distribution
      for (const tag of flatTags) {
        results.tagDistribution[tag] = (results.tagDistribution[tag] || 0) + 1;
      }

      // Track category distribution
      for (const [category, value] of Object.entries(tags)) {
        if (!results.categoryDistribution[category]) {
          results.categoryDistribution[category] = 0;
        }
        if (Array.isArray(value)) {
          results.categoryDistribution[category] += value.length;
        } else if (value) {
          results.categoryDistribution[category] += 1;
        }
      }

      results.projects.push({
        name: projectName,
        techStack,
        fileCount,
        tagCount,
        tags
      });

    } catch (error) {
      console.error(`Error analyzing ${projectName}:`, error.message);
    }
  }

  // Sort tag distribution by count
  results.tagDistribution = Object.fromEntries(
    Object.entries(results.tagDistribution).sort((a, b) => b[1] - a[1])
  );

  // Calculate coverage percentage
  results.coverageRate = results.projectCount > 0
    ? (results.projectsWithTags / results.projectCount * 100).toFixed(1) + '%'
    : '0%';

  // Save results
  const outputPath = path.join(__dirname, 'batch7-tags.json');
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

  console.log('\n=== Batch 7 Analysis Complete ===');
  console.log(`Projects analyzed: ${results.projectCount}`);
  console.log(`Projects with tags: ${results.projectsWithTags}`);
  console.log(`Projects without tags: ${results.projectsWithoutTags}`);
  console.log(`Coverage rate: ${results.coverageRate}`);
  console.log('\nTop 10 Tags:');
  Object.entries(results.tagDistribution).slice(0, 10).forEach(([tag, count]) => {
    console.log(`  ${tag}: ${count}`);
  });
  console.log(`\nResults saved to: ${outputPath}`);
}

analyzeBatch().catch(console.error);
