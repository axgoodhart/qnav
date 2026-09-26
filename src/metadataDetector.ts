import * as fs from 'fs/promises';
import * as path from 'path';
import { extractFirstMarkdownProse, parseFileContent, classifyExt } from './contentParser';
import { detectGenres, Genre } from './genres';

export type ProjectCategory =
  | 'Frontend'
  | 'Backend'
  | 'Fullstack'
  | 'Mobile'
  | 'ML'
  | 'DevOps'
  | 'Tooling'
  | 'Learning'
  | 'Unknown';

/**
 * Lightweight signal bag attached to every project. Both folder-projects
 * and loose-file-projects fill this in.
 */
export interface ProjectSignals {
  libraries?: string[];
  apis?: string[];
  polish?: number;
  isStub?: boolean;
  sizeBytes?: number;
  lineCount?: number;
  hasInlineCss?: boolean;
  hasInlineJs?: boolean;
}

export interface ProjectMetadata {
  /** Stable id derived from the canonical path (see preview/identity.ts). */
  id?: string;
  name: string;
  type: string;
  state: string;
  tech: string[];
  desc: string;
  path: string;
  category: ProjectCategory;

  // Extended fields (backward compatible — older consumers can ignore them)
  kind?: 'folder' | 'file';
  genres?: Genre[];
  family?: string | null;
  signals?: ProjectSignals;
}

// Tech stack patterns for category detection
const CATEGORY_TECH_PATTERNS: Record<Exclude<ProjectCategory, 'Fullstack' | 'Unknown'>, string[]> = {
  Frontend: [
    'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Gatsby',
    'Tailwind', 'CSS', 'SASS', 'SCSS', 'Webpack', 'Vite', 'Parcel',
    'HTML', 'Three.js', 'D3.js', 'jQuery', 'Bootstrap', 'Material UI'
  ],
  Backend: [
    'Express', 'FastAPI', 'Django', 'Rails', 'Flask', 'NestJS', 'Koa',
    'Spring', 'Laravel', 'ASP.NET', 'Phoenix', 'Gin', 'Echo', 'Fiber',
    'GraphQL', 'Prisma', 'Sequelize', 'TypeORM', 'Mongoose'
  ],
  Mobile: [
    'Flutter', 'Dart', 'React Native', 'Swift', 'Xcode', 'Kotlin',
    'Android', 'iOS', 'Expo', 'Capacitor', 'Ionic', 'NativeScript'
  ],
  ML: [
    'TensorFlow', 'PyTorch', 'scikit-learn', 'Keras', 'JAX', 'NumPy',
    'Pandas', 'OpenCV', 'Hugging Face', 'NLTK', 'spaCy', 'XGBoost',
    'MLflow', 'LangChain', 'OpenAI', 'transformers', 'jupyter'
  ],
  DevOps: [
    'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions',
    'AWS', 'Azure', 'GCP', 'Helm', 'ArgoCD', 'Pulumi', 'CloudFormation',
    'Nginx', 'Prometheus', 'Grafana', 'ELK'
  ],
  Tooling: [
    'CLI', 'Commander', 'Yargs', 'Inquirer', 'Chalk', 'Ora',
    'ESLint', 'Prettier', 'Babel', 'Rollup', 'esbuild', 'SWC',
    'npm', 'yarn', 'pnpm', 'Cargo', 'Make', 'Grunt', 'Gulp'
  ],
  Learning: [
    'tutorial', 'example', 'demo', 'sample', 'starter', 'template',
    'boilerplate', 'course', 'workshop', 'exercise', 'practice'
  ]
};

// Directory patterns for category detection (using array to support multi-category dirs)
const CATEGORY_DIR_PATTERNS: Array<[string, ProjectCategory]> = [
  ['src/components', 'Frontend'],
  ['src/pages', 'Frontend'],
  ['src/views', 'Frontend'],
  ['components', 'Frontend'],
  ['pages', 'Frontend'],
  ['public', 'Frontend'],
  ['styles', 'Frontend'],
  ['src/api', 'Backend'],
  ['src/routes', 'Backend'],
  ['src/controllers', 'Backend'],
  ['src/models', 'Backend'],
  ['src/services', 'Backend'],
  ['api', 'Backend'],
  ['routes', 'Backend'],
  ['controllers', 'Backend'],
  ['migrations', 'Backend'],
  ['android', 'Mobile'],
  ['ios', 'Mobile'],
  ['notebooks', 'ML'],
  ['training', 'ML'],
  ['infra', 'DevOps'],
  ['deploy', 'DevOps'],
  ['terraform', 'DevOps'],
  ['k8s', 'DevOps'],
  ['kubernetes', 'DevOps'],
  ['.github/workflows', 'DevOps'],
  ['bin', 'Tooling'],
  ['cli', 'Tooling']
];

/**
 * Detect project category based on tech stack patterns
 */
export function detectCategoryFromTech(tech: string[]): ProjectCategory | null {
  const categoryScores: Record<ProjectCategory, number> = {
    Frontend: 0,
    Backend: 0,
    Fullstack: 0,
    Mobile: 0,
    ML: 0,
    DevOps: 0,
    Tooling: 0,
    Learning: 0,
    Unknown: 0
  };

  for (const t of tech) {
    const techLower = t.toLowerCase();
    for (const [category, patterns] of Object.entries(CATEGORY_TECH_PATTERNS)) {
      for (const pattern of patterns) {
        if (techLower.includes(pattern.toLowerCase()) ||
            pattern.toLowerCase().includes(techLower)) {
          categoryScores[category as ProjectCategory] += 1;
        }
      }
    }
  }

  // Check if both frontend and backend are significant
  if (categoryScores.Frontend >= 2 && categoryScores.Backend >= 2) {
    return 'Fullstack';
  }

  // Find highest scoring category
  let maxScore = 0;
  let bestCategory: ProjectCategory | null = null;

  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > maxScore && category !== 'Fullstack' && category !== 'Unknown') {
      maxScore = score;
      bestCategory = category as ProjectCategory;
    }
  }

  return maxScore > 0 ? bestCategory : null;
}

/**
 * Detect project category based on directory structure
 */
export async function detectCategoryFromDirs(projectPath: string): Promise<ProjectCategory | null> {
  const categoryScores: Record<ProjectCategory, number> = {
    Frontend: 0,
    Backend: 0,
    Fullstack: 0,
    Mobile: 0,
    ML: 0,
    DevOps: 0,
    Tooling: 0,
    Learning: 0,
    Unknown: 0
  };

  try {
    for (const [dirPattern, category] of CATEGORY_DIR_PATTERNS) {
      const fullPath = path.join(projectPath, dirPattern);
      try {
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          categoryScores[category] += 1;
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }
  } catch {
    return null;
  }

  // Check if both frontend and backend directories exist
  if (categoryScores.Frontend >= 2 && categoryScores.Backend >= 2) {
    return 'Fullstack';
  }

  // Find highest scoring category
  let maxScore = 0;
  let bestCategory: ProjectCategory | null = null;

  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > maxScore && category !== 'Fullstack' && category !== 'Unknown') {
      maxScore = score;
      bestCategory = category as ProjectCategory;
    }
  }

  return maxScore > 0 ? bestCategory : null;
}

/**
 * Detect category from project name (for learning/demo projects)
 */
export function detectCategoryFromName(name: string): ProjectCategory | null {
  const nameLower = name.toLowerCase();
  const learningPatterns = CATEGORY_TECH_PATTERNS.Learning;

  for (const pattern of learningPatterns) {
    if (nameLower.includes(pattern)) {
      return 'Learning';
    }
  }

  return null;
}

/**
 * Combined category detection using all available signals
 */
export async function detectCategory(
  projectPath: string,
  tech: string[],
  name: string
): Promise<ProjectCategory> {
  // Priority 1: Check if it's a learning/demo project by name
  const nameCategory = detectCategoryFromName(name);
  if (nameCategory === 'Learning') {
    return 'Learning';
  }

  // Priority 2: Tech stack detection (most reliable)
  const techCategory = detectCategoryFromTech(tech);

  // Priority 3: Directory structure detection
  const dirCategory = await detectCategoryFromDirs(projectPath);

  // Combine results with tech taking priority, but dir can reinforce or provide fallback
  if (techCategory && dirCategory) {
    // If both agree, use that
    if (techCategory === dirCategory) {
      return techCategory;
    }
    // If tech says Fullstack, trust it
    if (techCategory === 'Fullstack') {
      return 'Fullstack';
    }
    // If dir says Fullstack, check if tech is one of Frontend/Backend
    if (dirCategory === 'Fullstack' &&
        (techCategory === 'Frontend' || techCategory === 'Backend')) {
      return 'Fullstack';
    }
    // Otherwise prefer tech
    return techCategory;
  }

  // Return whichever we have, or Unknown
  return techCategory || dirCategory || 'Unknown';
}

/**
 * Map of npm package name → friendly tech label.
 * Used when reading package.json dependencies.
 */
const NPM_TECH_MAP: Array<[RegExp, string]> = [
  // Frameworks
  [/^react$|^@types\/react$|^react-dom$/, 'React'],
  [/^next$/, 'Next.js'],
  [/^vue$|^@vue\//, 'Vue'],
  [/^nuxt$/, 'Nuxt'],
  [/^svelte$/, 'Svelte'],
  [/^@sveltejs\/kit$/, 'SvelteKit'],
  [/^astro$/, 'Astro'],
  [/^solid-js$/, 'Solid'],
  [/^@builder\.io\/qwik$/, 'Qwik'],
  [/^lit$|^lit-element$|^lit-html$/, 'Lit'],
  [/^preact$/, 'Preact'],
  [/^remix$|^@remix-run\//, 'Remix'],
  [/^gatsby$/, 'Gatsby'],
  // Build / runtime
  [/^vite$/, 'Vite'],
  [/^webpack$/, 'Webpack'],
  [/^parcel$/, 'Parcel'],
  [/^rollup$/, 'Rollup'],
  [/^esbuild$/, 'esbuild'],
  [/^typescript$|^@types\/node$/, 'TypeScript'],
  [/^electron$/, 'Electron'],
  [/^@tauri-apps\//, 'Tauri'],
  [/^remotion$/, 'Remotion'],
  // Styling
  [/^tailwindcss$/, 'Tailwind'],
  [/^sass$|^node-sass$/, 'Sass'],
  [/^bootstrap$/, 'Bootstrap'],
  [/^@mui\//, 'Material UI'],
  [/^@shoelace-style\//, 'Shoelace'],
  [/^daisyui$/, 'DaisyUI'],
  // Backend
  [/^express$/, 'Express'],
  [/^fastify$/, 'Fastify'],
  [/^@nestjs\//, 'NestJS'],
  [/^koa$/, 'Koa'],
  [/^hapi$/, 'Hapi'],
  [/^@hapi\//, 'Hapi'],
  [/^prisma$|^@prisma\//, 'Prisma'],
  [/^mongoose$/, 'Mongoose'],
  [/^sequelize$/, 'Sequelize'],
  [/^typeorm$/, 'TypeORM'],
  // Realtime
  [/^socket\.io$|^ws$/, 'WebSocket'],
  // 3D / audio / creative
  [/^three$/, 'Three.js'],
  [/^@react-three\//, 'react-three-fiber'],
  [/^babylonjs$|^@babylonjs\//, 'Babylon.js'],
  [/^pixi\.js$/, 'Pixi.js'],
  [/^p5$/, 'p5.js'],
  [/^tone$/, 'Tone.js'],
  [/^howler$/, 'Howler.js'],
  [/^d3$|^d3-/, 'D3'],
  [/^chart\.js$/, 'Chart.js'],
  [/^recharts$/, 'Recharts'],
  [/^plotly\.js$/, 'Plotly'],
  [/^gsap$/, 'GSAP'],
  [/^animejs$/, 'anime.js'],
  [/^lottie-web$|^lottie-react$/, 'Lottie'],
  [/^matter-js$/, 'Matter.js'],
  [/^cannon-es$|^cannon$/, 'Cannon.js'],
  [/^phaser$/, 'Phaser'],
  // Backend services
  [/^firebase$|^@firebase\//, 'Firebase'],
  [/^@supabase\//, 'Supabase'],
  // AI
  [/^openai$/, 'OpenAI SDK'],
  [/^@anthropic-ai\//, 'Anthropic SDK'],
  [/^langchain$|^@langchain\//, 'LangChain'],
  [/^@huggingface\//, 'Hugging Face'],
  [/^@xenova\/transformers$/, 'Transformers.js'],
  // Editors
  [/^codemirror$|^@codemirror\//, 'CodeMirror'],
  [/^monaco-editor$/, 'Monaco'],
  [/^prosemirror-/, 'ProseMirror'],
];

/**
 * Skim the keys of dependencies + devDependencies and turn them into
 * friendly tech labels.
 */
function detectTechFromDeps(deps: Record<string, any>): string[] {
  const out = new Set<string>();
  for (const dep of Object.keys(deps)) {
    for (const [re, label] of NPM_TECH_MAP) {
      if (re.test(dep)) out.add(label);
    }
  }
  return [...out];
}

/**
 * Decide a friendly project type from the detected tech stack.
 */
function inferType(tech: string[], hasPackageJson: boolean): string {
  const has = (t: string) => tech.includes(t);
  if (has('Next.js')) return 'Next.js App';
  if (has('Nuxt')) return 'Nuxt App';
  if (has('SvelteKit')) return 'SvelteKit App';
  if (has('Remix')) return 'Remix App';
  if (has('Astro')) return 'Astro Site';
  if (has('Gatsby')) return 'Gatsby Site';
  if (has('Remotion')) return 'Remotion Video';
  if (has('Tauri')) return 'Tauri App';
  if (has('Electron')) return 'Desktop App';
  if (has('react-three-fiber') || (has('React') && has('Three.js'))) return 'R3F App';
  if (has('Vue')) return 'Vue App';
  if (has('Svelte')) return 'Svelte App';
  if (has('React')) return 'React App';
  if (has('Express') || has('Fastify') || has('NestJS') || has('Koa')) return 'API Server';
  if (hasPackageJson) return 'Node project';
  return 'Unknown';
}

export class MetadataDetector {
  /**
   * Detect project metadata from a directory
   */
  async detectMetadata(projectPath: string): Promise<ProjectMetadata> {
    const name = path.basename(projectPath);
    const tech = new Set<string>();
    let type = 'Unknown';
    let desc = '';

    // Aggregated content signals from this project. Filled in below from
    // package.json + an index.html / main entry / README, etc.
    const libraries = new Set<string>();
    const apis = new Set<string>();
    let polish = 0;
    let isStub = false;
    let lineCount = 0;
    let sizeBytes = 0;
    let hasInlineCss = false;
    let hasInlineJs = false;

    try {
      const files = await fs.readdir(projectPath);

      // ---------- package.json ----------
      if (files.includes('package.json')) {
        const packageData = await this.readJSON(path.join(projectPath, 'package.json'));
        if (packageData) {
          if (packageData.description) desc = packageData.description;
          const deps = {
            ...(packageData.dependencies || {}),
            ...(packageData.devDependencies || {}),
            ...(packageData.peerDependencies || {}),
          };
          for (const t of detectTechFromDeps(deps)) tech.add(t);
          if (tech.size === 0) {
            tech.add('JavaScript');
            tech.add('Node.js');
          }
          type = inferType([...tech], true);
        }
      }

      // ---------- Python ----------
      if (files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml')) {
        tech.add('Python');
        if (type === 'Unknown') type = 'Python App';
        if (files.includes('requirements.txt')) {
          const requirements = await this.readFile(path.join(projectPath, 'requirements.txt'));
          if (requirements?.match(/\bfastapi\b/i)) tech.add('FastAPI');
          if (requirements?.match(/\bdjango\b/i)) tech.add('Django');
          if (requirements?.match(/\bflask\b/i)) tech.add('Flask');
          if (requirements?.match(/\btorch\b|\btensorflow\b|\bjax\b/i)) tech.add('ML');
          if (requirements?.match(/\bopenai\b/i)) { tech.add('OpenAI SDK'); apis.add('chat-completions'); }
          if (requirements?.match(/\banthropic\b/i)) tech.add('Anthropic SDK');
        }
      }

      // ---------- Rust / Go / Flutter / Swift ----------
      if (files.includes('Cargo.toml')) { tech.add('Rust'); if (type === 'Unknown') type = 'Rust App'; }
      if (files.includes('go.mod'))     { tech.add('Go');   if (type === 'Unknown') type = 'Go App'; }
      if (files.includes('pubspec.yaml')) { tech.add('Flutter'); tech.add('Dart'); if (type === 'Unknown') type = 'Flutter App'; }
      if (files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) {
        tech.add('Swift'); tech.add('Xcode');
        if (type === 'Unknown') type = 'iOS App';
      }

      // ---------- Plain HTML projects ----------
      const htmlFiles = files.filter(f => f.toLowerCase().endsWith('.html'));
      if (htmlFiles.length > 0 && !files.includes('package.json')) {
        tech.add('HTML');
        if (files.some(f => f.endsWith('.css'))) tech.add('CSS');
        if (files.some(f => f.endsWith('.js'))) tech.add('JavaScript');
        if (type === 'Unknown') type = 'Web Page';
      }

      // ---------- Sample one representative file for content signals ----------
      // Pick the most likely "entry" file in priority order. We only read one
      // — this isn't a deep crawl.
      const entryCandidate = pickEntryFile(files);
      if (entryCandidate) {
        const sig = await parseFileContent(path.join(projectPath, entryCandidate));
        for (const lib of sig.libraries) { libraries.add(lib); tech.add(lib); }
        for (const api of sig.apis) apis.add(api);
        polish = Math.max(polish, sig.polish);
        if (sig.isStub) isStub = true;
        lineCount += sig.lineCount;
        sizeBytes += sig.sizeBytes;
        if (sig.hasInlineCss) hasInlineCss = true;
        if (sig.hasInlineJs) hasInlineJs = true;
        if (!desc && sig.description) desc = sig.description;
        if (!desc && sig.title) desc = sig.title;
      }

      // ---------- README ----------
      const readme = files.find(f => f.toLowerCase().startsWith('readme'));
      if (readme && !desc) {
        const readmeContent = await this.readFile(path.join(projectPath, readme));
        if (readmeContent) {
          desc = extractFirstMarkdownProse(readmeContent);
        }
      }

    } catch {
      // Silent fail, return defaults
    }

    const techArr = [...tech];
    const language = classifyExt(path.extname(name)); // mostly 'unknown' for folders
    const genres = detectGenres({
      name,
      tech: techArr,
      libraries: [...libraries],
      apis: [...apis],
      language,
      isStub,
    });

    // Detect legacy category based on tech stack and directory structure
    const category = await detectCategory(projectPath, techArr, name);

    return {
      name,
      type: type === 'Unknown' && genres.length > 0 ? genreFallbackType(genres) : type,
      state: this.inferState(techArr, type, polish, isStub),
      tech: techArr.length > 0 ? techArr : ['Unknown'],
      desc: desc || synthDescription(type, techArr, [...libraries], [...apis]),
      path: projectPath,
      category,
      kind: 'folder',
      genres,
      family: null,
      signals: {
        libraries: [...libraries],
        apis: [...apis],
        polish,
        isStub,
        sizeBytes,
        lineCount,
        hasInlineCss,
        hasInlineJs,
      },
    };
  }

  private inferState(tech: string[], type: string, polish: number, isStub: boolean): string {
    if (isStub) return 'Stub';
    if (polish >= 0.45) return 'Polished';
    if (tech.includes('Next.js') || tech.includes('React')) return 'Active Dev';
    if (type.includes('Template') || type.includes('Demo')) return 'Demo';
    return 'Active';
  }

  private async readJSON(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}

/**
 * Pick the single most representative file inside a folder for content scanning.
 * Cheap-and-cheerful priority list.
 */
function pickEntryFile(files: string[]): string | undefined {
  const lower = files.map(f => f.toLowerCase());
  const want = [
    'index.html', 'index.htm', 'main.html',
    'index.tsx', 'index.ts', 'index.jsx', 'index.js',
    'app.tsx', 'app.ts', 'app.jsx', 'app.js',
    'main.tsx', 'main.ts', 'main.jsx', 'main.js',
    'main.py', 'app.py', '__main__.py',
  ];
  for (const candidate of want) {
    const idx = lower.indexOf(candidate);
    if (idx >= 0) return files[idx];
  }
  // fall back to any html / py / ts / js file in root
  const fallback = files.find(f => /\.(html?|tsx?|jsx?|py|swift)$/i.test(f));
  return fallback;
}

/**
 * If the user has no package.json / requirements / etc., synthesize a type
 * label from genres so we don't show "Unknown."
 */
function genreFallbackType(genres: Genre[]): string {
  if (genres.includes('audio')) return 'Audio sketch';
  if (genres.includes('3d')) return '3D sketch';
  if (genres.includes('shader')) return 'Shader sketch';
  if (genres.includes('creative-coding')) return 'Creative-coding sketch';
  if (genres.includes('ui-lab')) return 'UI lab';
  if (genres.includes('fake-os')) return 'Fake OS';
  if (genres.includes('game')) return 'Game';
  if (genres.includes('reader')) return 'Reader';
  if (genres.includes('editor')) return 'Editor';
  if (genres.includes('tool')) return 'Tool';
  if (genres.includes('ai-llm')) return 'AI / LLM project';
  if (genres.includes('writing')) return 'Writing';
  if (genres.includes('archive')) return 'Archive';
  return 'Unknown';
}

/**
 * Keyword-style fallback description (no sentence structure).
 */
function synthDescription(type: string, tech: string[], libs: string[], apis: string[]): string {
  const bits: string[] = [];
  if (libs.length) bits.push(libs.slice(0, 4).join(' + '));
  else if (tech.length && tech[0] !== 'Unknown') bits.push(tech.slice(0, 4).join(' + '));
  if (apis.length) bits.push(apis.slice(0, 4).join(', '));
  if (bits.length === 0) return type === 'Unknown' ? '' : `${type} project`;
  return `${type} — ${bits.join(' · ')}`;
}
