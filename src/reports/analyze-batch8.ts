/**
 * Batch 8 Tag Analysis Script
 * Analyzes projects 449-511 and generates tag distribution report
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TagDetector, flattenTags, countTags } from '../tagDetector';
import { SemanticTags } from '../tagTaxonomy';

interface ProjectTagData {
  projectName: string;
  projectPath: string;
  tags: SemanticTags;
  flatTags: string[];
  tagCount: number;
  techStack: string[];
  fileCount: number;
}

interface BatchReport {
  batchNumber: number;
  batchRange: string;
  generatedAt: string;
  projectCount: number;
  projects: ProjectTagData[];
  tagDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
  averageTagsPerProject: number;
  projectsWithNoTags: number;
}

async function detectTechStack(projectPath: string): Promise<string[]> {
  const techStack: string[] = [];
  const files = await fs.readdir(projectPath).catch(() => []);

  // Check for common tech indicators
  const techIndicators: Record<string, string[]> = {
    'TypeScript': ['tsconfig.json', '.ts', '.tsx'],
    'JavaScript': ['.js', '.jsx', '.mjs'],
    'React': ['react', 'jsx', 'tsx'],
    'Vue': ['.vue', 'vue.config'],
    'HTML': ['.html', '.htm'],
    'CSS': ['.css', '.scss', '.sass', '.less'],
    'Python': ['.py', 'requirements.txt', 'setup.py'],
    'Node.js': ['package.json'],
    'Rust': ['Cargo.toml', '.rs'],
    'Go': ['go.mod', '.go'],
    'Swift': ['.swift', 'Package.swift'],
    'Ruby': ['.rb', 'Gemfile'],
    'PHP': ['.php'],
    'Java': ['.java', 'pom.xml'],
    'Kotlin': ['.kt', '.kts'],
    'Shell': ['.sh', '.bash'],
    'MIDI': ['.mid', '.midi'],
    'JSON': ['.json'],
    'YAML': ['.yaml', '.yml'],
    'Markdown': ['.md', '.markdown'],
    'WebGL': ['shader', 'glsl', '.frag', '.vert'],
    'Three.js': ['three'],
    'Canvas': ['canvas'],
  };

  for (const [tech, patterns] of Object.entries(techIndicators)) {
    for (const file of files) {
      const fileLower = file.toLowerCase();
      if (patterns.some(p => fileLower.includes(p.toLowerCase()))) {
        if (!techStack.includes(tech)) {
          techStack.push(tech);
        }
        break;
      }
    }
  }

  // Check package.json for more details
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.react) techStack.push('React');
    if (allDeps.vue) techStack.push('Vue');
    if (allDeps.angular) techStack.push('Angular');
    if (allDeps.svelte) techStack.push('Svelte');
    if (allDeps.three) techStack.push('Three.js');
    if (allDeps['tone'] || allDeps['tonejs']) techStack.push('Tone.js');
    if (allDeps.express) techStack.push('Express');
    if (allDeps.next) techStack.push('Next.js');
    if (allDeps['socket.io']) techStack.push('Socket.io');
    if (allDeps.electron) techStack.push('Electron');
  } catch {
    // No package.json
  }

  return [...new Set(techStack)];
}

async function countFiles(projectPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        try {
          const subEntries = await fs.readdir(path.join(projectPath, entry.name));
          count += subEntries.length;
        } catch {
          // Skip unreadable dirs
        }
      }
    }

    return count;
  } catch {
    return 0;
  }
}

async function analyzeProject(projectPath: string, projectName: string): Promise<ProjectTagData | null> {
  try {
    const stat = await fs.stat(projectPath);

    // Skip if not a directory or is a file
    if (!stat.isDirectory()) {
      // For single files, create minimal tag data
      const techStack: string[] = [];
      const ext = path.extname(projectName).toLowerCase();

      if (['.html', '.htm'].includes(ext)) techStack.push('HTML');
      if (['.js', '.jsx', '.mjs'].includes(ext)) techStack.push('JavaScript');
      if (['.ts', '.tsx'].includes(ext)) techStack.push('TypeScript');
      if (['.py'].includes(ext)) techStack.push('Python');
      if (['.css', '.scss'].includes(ext)) techStack.push('CSS');
      if (['.md'].includes(ext)) techStack.push('Markdown');
      if (['.mid', '.midi'].includes(ext)) techStack.push('MIDI');
      if (['.swift'].includes(ext)) techStack.push('Swift');
      if (['.json'].includes(ext)) techStack.push('JSON');
      if (['.sh'].includes(ext)) techStack.push('Shell');
      if (['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) techStack.push('Image');
      if (['.zip'].includes(ext)) techStack.push('Archive');
      if (['.txt'].includes(ext)) techStack.push('Text');

      const detector = new TagDetector();
      const tags = await detector.detectTags(
        path.dirname(projectPath),
        projectName,
        techStack,
        1,
        undefined
      );

      return {
        projectName,
        projectPath,
        tags,
        flatTags: flattenTags(tags),
        tagCount: countTags(tags),
        techStack,
        fileCount: 1,
      };
    }

    const techStack = await detectTechStack(projectPath);
    const fileCount = await countFiles(projectPath);

    const detector = new TagDetector();
    const tags = await detector.detectTags(
      projectPath,
      projectName,
      techStack,
      fileCount,
      undefined
    );

    return {
      projectName,
      projectPath,
      tags,
      flatTags: flattenTags(tags),
      tagCount: countTags(tags),
      techStack,
      fileCount,
    };
  } catch (error) {
    console.error(`Error analyzing ${projectName}:`, error);
    return null;
  }
}

async function main() {
  const cufolioPath = '/Users/alex/Documents/Cufolio';
  const reportsPath = '/Users/alex/Documents/Cufolio/cunav/src/reports';

  // Get all projects
  const allProjects = await fs.readdir(cufolioPath);

  // Batch 8: projects 449-511 (index 448 to end, 0-based)
  const batch8Projects = allProjects.slice(448); // from index 448 onwards

  console.log(`Analyzing ${batch8Projects.length} projects (batch 8: 449-${448 + batch8Projects.length})...`);

  const projects: ProjectTagData[] = [];
  const tagDistribution: Record<string, number> = {};
  const categoryDistribution: Record<string, number> = {};

  for (let i = 0; i < batch8Projects.length; i++) {
    const projectName = batch8Projects[i];
    const projectPath = path.join(cufolioPath, projectName);

    console.log(`[${i + 1}/${batch8Projects.length}] Analyzing: ${projectName}`);

    const projectData = await analyzeProject(projectPath, projectName);

    if (projectData) {
      projects.push(projectData);

      // Count tag distribution
      for (const tag of projectData.flatTags) {
        tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;

        // Extract category
        const category = tag.split(':')[0];
        categoryDistribution[category] = (categoryDistribution[category] || 0) + 1;
      }
    }
  }

  // Sort tags by count
  const sortedTags = Object.entries(tagDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));

  const totalTags = projects.reduce((sum, p) => sum + p.tagCount, 0);
  const projectsWithNoTags = projects.filter(p => p.tagCount === 0).length;

  const report: BatchReport = {
    batchNumber: 8,
    batchRange: `449-${448 + batch8Projects.length}`,
    generatedAt: new Date().toISOString(),
    projectCount: projects.length,
    projects,
    tagDistribution,
    categoryDistribution,
    topTags: sortedTags.slice(0, 30),
    averageTagsPerProject: totalTags / projects.length,
    projectsWithNoTags,
  };

  // Write batch report
  await fs.writeFile(
    path.join(reportsPath, 'batch8-tags.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`\nBatch 8 Report Generated:`);
  console.log(`- Projects analyzed: ${projects.length}`);
  console.log(`- Total tags found: ${totalTags}`);
  console.log(`- Average tags per project: ${report.averageTagsPerProject.toFixed(2)}`);
  console.log(`- Projects with no tags: ${projectsWithNoTags}`);
  console.log(`\nTop 10 tags:`);
  sortedTags.slice(0, 10).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.tag}: ${t.count}`);
  });

  console.log(`\nReport saved to: ${path.join(reportsPath, 'batch8-tags.json')}`);
}

main().catch(console.error);
