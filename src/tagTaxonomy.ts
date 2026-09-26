/**
 * Comprehensive Semantic Tag Taxonomy
 * 15+ tag categories with 150+ individual tags for rich project classification
 */

// ============================================================================
// TAG TYPE DEFINITIONS
// ============================================================================

export type PurposeTag =
  | 'portfolio' | 'productivity' | 'entertainment' | 'education' | 'utility'
  | 'automation' | 'communication' | 'analytics' | 'marketplace' | 'social'
  | 'creative-tools' | 'developer-tools' | 'data-visualization' | 'content-management'
  | 'gaming' | 'music' | 'video' | 'photography' | 'writing' | 'design'
  | 'finance-app' | 'health-app' | 'travel-app' | 'food-app' | 'fitness-app';

export type AudienceTag =
  | 'developers' | 'consumers' | 'enterprise' | 'internal-tools' | 'b2b' | 'b2c'
  | 'creators' | 'researchers' | 'students' | 'teams' | 'solo-users' | 'children'
  | 'professionals' | 'hobbyists' | 'musicians' | 'artists' | 'writers' | 'gamers';

export type ComplexityTag =
  | 'trivial' | 'simple' | 'moderate' | 'complex' | 'enterprise-grade';

export type StageTag =
  | 'concept' | 'prototype' | 'mvp' | 'alpha' | 'beta' | 'production'
  | 'maintained' | 'legacy' | 'archived' | 'experimental' | 'demo' | 'template';

export type DomainTag =
  | 'finance' | 'health' | 'social' | 'media' | 'gaming' | 'ecommerce'
  | 'education' | 'devtools' | 'infrastructure' | 'iot' | 'ai-ml' | 'security'
  | 'hr' | 'crm' | 'logistics' | 'real-estate' | 'travel' | 'food' | 'fitness'
  | 'music' | 'video' | 'photography' | 'art' | 'writing' | 'science'
  | 'legal' | 'marketing' | 'analytics' | 'automation' | 'communication';

export type FeatureTag =
  | 'authentication' | 'payments' | 'realtime' | 'file-upload' | 'notifications'
  | 'search' | 'caching' | 'analytics' | 'i18n' | 'a11y' | 'ai-powered'
  | 'blockchain' | 'geolocation' | 'social-login' | 'two-factor' | 'rate-limiting'
  | 'webhooks' | 'scheduling' | 'export' | 'import' | 'collaboration' | 'commenting'
  | 'versioning' | 'drag-drop' | 'keyboard-shortcuts' | 'dark-mode' | 'responsive'
  | 'offline-capable' | 'push-notifications' | 'audio' | 'video-playback'
  | 'image-processing' | 'pdf-generation' | 'email' | 'sms' | 'charts'
  | 'maps' | 'forms' | 'tables' | 'modals' | 'animations' | '3d-graphics'
  | 'webgl' | 'canvas' | 'svg' | 'midi' | 'websocket' | 'sse';

export type ArchitectureTag =
  | 'monolith' | 'microservices' | 'serverless' | 'jamstack' | 'spa' | 'mpa'
  | 'pwa' | 'hybrid' | 'event-driven' | 'cqrs' | 'graphql-based' | 'rest-based'
  | 'static-site' | 'ssr' | 'ssg' | 'isr' | 'islands' | 'micro-frontends'
  | 'modular' | 'layered' | 'hexagonal' | 'plugin-architecture';

export type UIParadigmTag =
  | 'dashboard' | 'landing-page' | 'admin-panel' | 'mobile-app' | 'cli'
  | 'api-only' | 'documentation' | 'blog' | 'portfolio-site' | 'saas'
  | 'marketplace-ui' | 'wizard' | 'multi-step-form' | 'kanban' | 'calendar-view'
  | 'map-based' | 'chat-interface' | 'video-player' | 'audio-player' | 'editor'
  | 'ide' | 'terminal' | 'gallery' | 'feed' | 'timeline' | 'tree-view'
  | 'grid-layout' | 'card-layout' | 'list-view' | 'split-pane' | 'tabs'
  | 'accordion' | 'carousel' | 'lightbox' | 'os-interface' | 'game-ui';

export type DataHandlingTag =
  | 'crud' | 'streaming' | 'batch-processing' | 'real-time-sync' | 'offline-first'
  | 'cache-heavy' | 'stateless' | 'event-sourced' | 'time-series' | 'graph-data'
  | 'document-store' | 'key-value' | 'relational' | 'file-based' | 'in-memory'
  | 'local-storage' | 'indexed-db' | 'session-storage';

export type DeploymentTargetTag =
  | 'web' | 'mobile' | 'desktop' | 'embedded' | 'cloud-native' | 'edge'
  | 'self-hosted' | 'browser-extension' | 'electron' | 'cli-tool' | 'npm-package'
  | 'docker' | 'kubernetes' | 'vercel' | 'netlify' | 'aws' | 'firebase-hosted'
  | 'github-pages' | 'static-hosting';

export type IntegrationTypeTag =
  | 'api-consumer' | 'api-provider' | 'webhook-based' | 'oauth-integrated'
  | 'third-party-heavy' | 'standalone' | 'plugin-based' | 'headless' | 'sdk'
  | 'embeddable' | 'iframe-based' | 'npm-module' | 'browser-api' | 'native-api';

export type ContentTypeTag =
  | 'text-heavy' | 'media-rich' | 'data-driven' | 'user-generated' | 'curated'
  | 'interactive' | 'static' | 'dynamic' | 'procedural' | 'ai-generated'
  | 'code-focused' | 'documentation' | 'tutorial' | 'reference';

export type InteractionModelTag =
  | 'read-only' | 'read-write' | 'collaborative' | 'single-user' | 'multi-tenant'
  | 'real-time-multiplayer' | 'turn-based' | 'async-collaboration' | 'live-editing'
  | 'commenting' | 'voting' | 'rating' | 'sharing';

export type ScaleTargetTag =
  | 'personal' | 'small-team' | 'startup' | 'enterprise' | 'global-scale'
  | 'local-only' | 'single-instance' | 'distributed';

export type MonetizationTag =
  | 'free' | 'freemium' | 'subscription' | 'one-time' | 'usage-based'
  | 'ad-supported' | 'open-source' | 'enterprise-license' | 'donation-based'
  | 'pay-what-you-want' | 'sponsorware';

export type TechStyleTag =
  | 'vanilla-js' | 'vanilla-css' | 'framework-heavy' | 'library-light'
  | 'typescript-strict' | 'functional' | 'oop' | 'reactive' | 'imperative'
  | 'declarative' | 'component-based' | 'hooks-based' | 'class-based';

// ============================================================================
// SEMANTIC TAGS INTERFACE
// ============================================================================

export interface SemanticTags {
  purpose?: PurposeTag[];
  audience?: AudienceTag[];
  complexity?: ComplexityTag;
  stage?: StageTag;
  domain?: DomainTag[];
  features?: FeatureTag[];
  architecture?: ArchitectureTag[];
  uiParadigm?: UIParadigmTag[];
  dataHandling?: DataHandlingTag[];
  deploymentTarget?: DeploymentTargetTag[];
  integrationType?: IntegrationTypeTag[];
  contentType?: ContentTypeTag[];
  interactionModel?: InteractionModelTag[];
  scaleTarget?: ScaleTargetTag;
  monetization?: MonetizationTag;
  techStyle?: TechStyleTag[];
}

// ============================================================================
// PATTERN MATCHING DEFINITIONS
// ============================================================================

export interface TagPattern {
  tag: string;
  namePatterns?: string[];
  techPatterns?: string[];
  filePatterns?: string[];
  readmePatterns?: string[];
  depPatterns?: string[];
}

export const PURPOSE_PATTERNS: TagPattern[] = [
  { tag: 'portfolio', namePatterns: ['portfolio', 'folio', 'personal', 'resume', 'cv', 'about-me'], filePatterns: ['portfolio', 'about'] },
  { tag: 'productivity', namePatterns: ['todo', 'task', 'planner', 'organizer', 'tracker', 'keeper', 'manager'], readmePatterns: ['productivity', 'task management'] },
  { tag: 'entertainment', namePatterns: ['game', 'fun', 'play', 'arcade', 'puzzle'], readmePatterns: ['entertainment', 'fun', 'game'] },
  { tag: 'education', namePatterns: ['learn', 'teach', 'course', 'tutorial', 'lesson', 'study', 'quiz', 'flashcard'], readmePatterns: ['education', 'learning', 'teaching'] },
  { tag: 'utility', namePatterns: ['tool', 'util', 'helper', 'converter', 'generator', 'calculator'], readmePatterns: ['utility', 'tool'] },
  { tag: 'automation', namePatterns: ['auto', 'bot', 'script', 'workflow', 'pipeline'], depPatterns: ['puppeteer', 'playwright', 'selenium'] },
  { tag: 'communication', namePatterns: ['chat', 'message', 'messenger', 'mail', 'email', 'notify'], depPatterns: ['socket.io', 'pusher', 'twilio'] },
  { tag: 'analytics', namePatterns: ['analytics', 'stats', 'metrics', 'dashboard', 'report', 'chart'], depPatterns: ['chart.js', 'd3', 'recharts', 'plotly'] },
  { tag: 'marketplace', namePatterns: ['market', 'shop', 'store', 'commerce', 'cart', 'checkout'], depPatterns: ['stripe', 'shopify', 'commerce'] },
  { tag: 'social', namePatterns: ['social', 'community', 'network', 'feed', 'share', 'connect'], readmePatterns: ['social', 'community', 'sharing'] },
  { tag: 'creative-tools', namePatterns: ['editor', 'creator', 'maker', 'designer', 'studio', 'canvas'], filePatterns: ['editor', 'canvas'] },
  { tag: 'developer-tools', namePatterns: ['dev', 'code', 'debug', 'lint', 'test', 'build', 'cli'], depPatterns: ['commander', 'yargs', 'inquirer'] },
  { tag: 'data-visualization', namePatterns: ['viz', 'visual', 'chart', 'graph', 'plot', 'diagram'], depPatterns: ['d3', 'chart.js', 'recharts', 'plotly', 'echarts'] },
  { tag: 'content-management', namePatterns: ['cms', 'blog', 'content', 'publish', 'article'], depPatterns: ['contentful', 'sanity', 'strapi', 'ghost'] },
  { tag: 'gaming', namePatterns: ['game', 'arcade', 'rpg', 'puzzle', 'tetris', 'snake', 'pong', 'justris', 'maze'], depPatterns: ['phaser', 'pixi', 'babylon', 'playcanvas'] },
  { tag: 'music', namePatterns: ['music', 'audio', 'sound', 'synth', 'piano', 'drum', 'beat', 'melody', 'midi', 'zynth', 'metronome', 'tone'], depPatterns: ['tone', 'howler', 'pizzicato', 'audiobuffer'] },
  { tag: 'video', namePatterns: ['video', 'movie', 'film', 'stream', 'player', 'youtube', 'vimeo'], depPatterns: ['video.js', 'plyr', 'hls.js'] },
  { tag: 'photography', namePatterns: ['photo', 'image', 'gallery', 'camera', 'picture'], filePatterns: ['gallery', 'photos'] },
  { tag: 'writing', namePatterns: ['write', 'blog', 'journal', 'note', 'document', 'markdown', 'text'], depPatterns: ['quill', 'slate', 'prosemirror', 'tiptap'] },
  { tag: 'design', namePatterns: ['design', 'ui', 'ux', 'figma', 'sketch', 'prototype'], readmePatterns: ['design system', 'ui kit'] },
  { tag: 'finance-app', namePatterns: ['finance', 'money', 'budget', 'expense', 'invoice', 'payment', 'bank'], depPatterns: ['stripe', 'plaid'] },
  { tag: 'food-app', namePatterns: ['food', 'recipe', 'cook', 'meal', 'restaurant', 'menu', 'fridge', 'frig'], readmePatterns: ['food', 'recipe', 'cooking'] },
];

export const AUDIENCE_PATTERNS: TagPattern[] = [
  { tag: 'developers', namePatterns: ['dev', 'api', 'sdk', 'cli', 'tool'], depPatterns: ['commander', 'yargs'], readmePatterns: ['developer', 'api', 'sdk'] },
  { tag: 'consumers', readmePatterns: ['user-friendly', 'easy to use', 'consumer'], namePatterns: ['app', 'mobile'] },
  { tag: 'enterprise', namePatterns: ['enterprise', 'business', 'corporate', 'saas'], readmePatterns: ['enterprise', 'business', 'b2b'] },
  { tag: 'internal-tools', namePatterns: ['internal', 'admin', 'backoffice', 'ops'], filePatterns: ['admin', 'internal'] },
  { tag: 'creators', namePatterns: ['creator', 'artist', 'maker', 'studio'], readmePatterns: ['creator', 'artist'] },
  { tag: 'musicians', namePatterns: ['music', 'audio', 'synth', 'piano', 'midi'], readmePatterns: ['musician', 'composer'] },
  { tag: 'artists', namePatterns: ['art', 'draw', 'paint', 'canvas', 'sketch'], readmePatterns: ['artist', 'creative'] },
  { tag: 'gamers', namePatterns: ['game', 'gaming', 'player'], readmePatterns: ['gamer', 'gaming'] },
];

export const DOMAIN_PATTERNS: TagPattern[] = [
  { tag: 'finance', namePatterns: ['finance', 'money', 'bank', 'payment', 'crypto', 'trade'], depPatterns: ['stripe', 'plaid', 'web3'] },
  { tag: 'gaming', namePatterns: ['game', 'gaming', 'arcade', 'rpg', 'esport'], depPatterns: ['phaser', 'pixi', 'unity'] },
  { tag: 'education', namePatterns: ['edu', 'learn', 'course', 'school', 'university', 'quiz'], readmePatterns: ['education', 'e-learning'] },
  { tag: 'devtools', namePatterns: ['dev', 'tool', 'debug', 'lint', 'test', 'build'], filePatterns: ['.eslintrc', 'jest.config'] },
  { tag: 'ai-ml', namePatterns: ['ai', 'ml', 'neural', 'model', 'predict', 'gpt', 'llm', 'agent', 'whisper'], depPatterns: ['tensorflow', 'pytorch', 'openai', 'langchain', 'transformers'] },
  { tag: 'music', namePatterns: ['music', 'audio', 'sound', 'synth', 'midi', 'melody', 'harmony', 'zynth', 'piano'], depPatterns: ['tone', 'howler'] },
  { tag: 'video', namePatterns: ['video', 'stream', 'movie', 'film', 'player'], depPatterns: ['video.js', 'hls.js'] },
  { tag: 'art', namePatterns: ['art', 'creative', 'draw', 'paint', 'canvas', 'design', 'visual'], readmePatterns: ['art', 'creative', 'visual'] },
  { tag: 'automation', namePatterns: ['auto', 'bot', 'script', 'cron', 'workflow'], depPatterns: ['node-cron', 'bull', 'agenda'] },
  { tag: 'communication', namePatterns: ['chat', 'message', 'email', 'notify', 'sms'], depPatterns: ['socket.io', 'twilio', 'sendgrid'] },
];

export const FEATURE_PATTERNS: TagPattern[] = [
  { tag: 'authentication', depPatterns: ['passport', 'next-auth', 'auth0', 'firebase-auth', 'jsonwebtoken', 'bcrypt'], filePatterns: ['auth', 'login'] },
  { tag: 'payments', depPatterns: ['stripe', 'paypal', 'braintree', 'square'], namePatterns: ['pay', 'checkout', 'billing'] },
  { tag: 'realtime', depPatterns: ['socket.io', 'ws', 'pusher', 'ably', 'phoenix'], namePatterns: ['realtime', 'live', 'sync'] },
  { tag: 'search', depPatterns: ['elasticsearch', 'algolia', 'meilisearch', 'lunr'], namePatterns: ['search', 'find'] },
  { tag: 'ai-powered', depPatterns: ['openai', 'anthropic', 'langchain', 'huggingface', 'transformers', 'tensorflow', 'pytorch'], namePatterns: ['ai', 'gpt', 'llm', 'ml', 'agent'] },
  { tag: 'audio', depPatterns: ['tone', 'howler', 'pizzicato', 'web-audio'], namePatterns: ['audio', 'sound', 'music', 'synth'] },
  { tag: 'video-playback', depPatterns: ['video.js', 'plyr', 'hls.js', 'dash.js'], namePatterns: ['video', 'player', 'stream'] },
  { tag: '3d-graphics', depPatterns: ['three', 'babylon', 'aframe', 'react-three-fiber'], namePatterns: ['3d', 'three', 'webgl', 'sphere', 'cube', 'orb'] },
  { tag: 'webgl', depPatterns: ['three', 'pixi', 'regl', 'twgl'], filePatterns: ['shader', 'glsl'] },
  { tag: 'canvas', techPatterns: ['canvas'], namePatterns: ['canvas', 'draw', 'paint'], filePatterns: ['canvas'] },
  { tag: 'midi', depPatterns: ['webmidi', 'jzz', 'midi'], namePatterns: ['midi', 'piano', 'keyboard'] },
  { tag: 'websocket', depPatterns: ['ws', 'socket.io', 'sockjs'], readmePatterns: ['websocket', 'real-time'] },
  { tag: 'charts', depPatterns: ['chart.js', 'd3', 'recharts', 'victory', 'echarts', 'plotly'], namePatterns: ['chart', 'graph', 'plot'] },
  { tag: 'maps', depPatterns: ['leaflet', 'mapbox-gl', 'react-map-gl', 'google-maps'], namePatterns: ['map', 'geo', 'location'] },
  { tag: 'animations', depPatterns: ['framer-motion', 'gsap', 'anime', 'lottie', 'motion'], namePatterns: ['animate', 'motion'] },
  { tag: 'drag-drop', depPatterns: ['react-dnd', 'dnd-kit', 'sortablejs', 'dragula'], readmePatterns: ['drag and drop', 'drag-and-drop', 'sortable'] },
];

export const ARCHITECTURE_PATTERNS: TagPattern[] = [
  { tag: 'spa', depPatterns: ['react', 'vue', 'angular', 'svelte'], readmePatterns: ['single page', 'spa'] },
  { tag: 'ssr', depPatterns: ['next', 'nuxt', 'sveltekit', 'remix'], readmePatterns: ['server-side rendering', 'ssr'] },
  { tag: 'ssg', depPatterns: ['gatsby', 'astro', 'eleventy', 'hugo'], readmePatterns: ['static site', 'ssg', 'static generation'] },
  { tag: 'pwa', depPatterns: ['workbox', '@vite-pwa'], filePatterns: ['manifest.json', 'sw.js', 'service-worker'], readmePatterns: ['pwa', 'progressive web app'] },
  { tag: 'serverless', depPatterns: ['serverless', 'aws-lambda', 'netlify-lambda', 'vercel'], filePatterns: ['netlify.toml', 'vercel.json'] },
  { tag: 'static-site', filePatterns: ['index.html'], techPatterns: ['html', 'css'] },
];

export const UI_PARADIGM_PATTERNS: TagPattern[] = [
  { tag: 'dashboard', namePatterns: ['dashboard', 'admin', 'panel', 'analytics', 'metrics', 'dashy'], filePatterns: ['dashboard'] },
  { tag: 'landing-page', namePatterns: ['landing', 'homepage', 'promo', 'marketing'], filePatterns: ['landing'] },
  { tag: 'admin-panel', namePatterns: ['admin', 'backoffice', 'cms', 'manage'], filePatterns: ['admin'] },
  { tag: 'cli', depPatterns: ['commander', 'yargs', 'inquirer', 'ora', 'chalk'], namePatterns: ['cli', 'terminal', 'command'] },
  { tag: 'documentation', depPatterns: ['docusaurus', 'vuepress', 'gitbook', 'mkdocs'], namePatterns: ['docs', 'documentation'] },
  { tag: 'blog', depPatterns: ['gatsby', 'next', 'ghost'], namePatterns: ['blog', 'journal', 'post'], filePatterns: ['posts/', 'blog/'] },
  { tag: 'portfolio-site', namePatterns: ['portfolio', 'personal', 'resume', 'cv', 'folio'], readmePatterns: ['portfolio', 'personal site'] },
  { tag: 'editor', namePatterns: ['editor', 'ide', 'code', 'text'], depPatterns: ['monaco-editor', 'codemirror', 'ace'] },
  { tag: 'terminal', namePatterns: ['terminal', 'console', 'shell'], depPatterns: ['xterm', 'blessed'] },
  { tag: 'gallery', namePatterns: ['gallery', 'photos', 'images', 'portfolio', 'coverflow'], filePatterns: ['gallery/'] },
  { tag: 'video-player', namePatterns: ['player', 'video', 'stream'], depPatterns: ['video.js', 'plyr'] },
  { tag: 'audio-player', namePatterns: ['player', 'audio', 'music', 'podcast'], depPatterns: ['howler', 'tone'] },
  { tag: 'game-ui', namePatterns: ['game', 'arcade', 'play', 'justris', 'maze', 'tetris'], depPatterns: ['phaser', 'pixi'] },
  { tag: 'os-interface', namePatterns: ['os', 'desktop', 'window', 'system', 'briizos', 'alexos', 'glos', 'orbos', 'myos'], readmePatterns: ['operating system', 'desktop environment'] },
  { tag: 'carousel', depPatterns: ['swiper', 'slick', 'embla-carousel'], namePatterns: ['carousel', 'slider', 'slideshow', 'coverflow', 'spiral'] },
  { tag: 'chat-interface', namePatterns: ['chat', 'messenger', 'message'], depPatterns: ['socket.io'] },
  { tag: 'calendar-view', namePatterns: ['calendar', 'schedule', 'planner', 'timer', 'countdown'], depPatterns: ['fullcalendar', 'react-big-calendar'] },
  { tag: 'kanban', namePatterns: ['kanban', 'board', 'trello', 'task'], depPatterns: ['react-beautiful-dnd', 'dnd-kit'] },
];

export const DATA_HANDLING_PATTERNS: TagPattern[] = [
  { tag: 'crud', depPatterns: ['prisma', 'sequelize', 'typeorm', 'mongoose'], readmePatterns: ['crud', 'create read update delete'] },
  { tag: 'real-time-sync', depPatterns: ['socket.io', 'firebase', 'supabase', 'yjs'], readmePatterns: ['real-time sync', 'live sync'] },
  { tag: 'local-storage', readmePatterns: ['local storage', 'localStorage'], depPatterns: ['localforage'] },
  { tag: 'file-based', filePatterns: ['data/', '*.json', '*.yaml'], readmePatterns: ['file-based', 'json storage'] },
];

export const DEPLOYMENT_TARGET_PATTERNS: TagPattern[] = [
  { tag: 'web', techPatterns: ['html', 'css', 'javascript'], readmePatterns: ['web app', 'browser'] },
  { tag: 'desktop', depPatterns: ['electron', 'tauri', 'neutralino'], namePatterns: ['desktop', 'native'] },
  { tag: 'cli-tool', depPatterns: ['commander', 'yargs', 'meow'], namePatterns: ['cli', 'command'] },
  { tag: 'static-hosting', readmePatterns: ['static hosting', 'static site'] },
];

export const INTEGRATION_TYPE_PATTERNS: TagPattern[] = [
  { tag: 'api-consumer', depPatterns: ['axios', 'fetch', 'got', 'ky'], readmePatterns: ['api client', 'consumes api'] },
  { tag: 'api-provider', depPatterns: ['express', 'fastify', 'hapi'], filePatterns: ['routes/', 'api/'] },
  { tag: 'standalone', readmePatterns: ['standalone', 'self-contained', 'no dependencies'] },
  { tag: 'embeddable', readmePatterns: ['embeddable', 'embed', 'widget', 'iframe'] },
];

export const CONTENT_TYPE_PATTERNS: TagPattern[] = [
  { tag: 'text-heavy', namePatterns: ['blog', 'docs', 'wiki', 'article', 'book'], readmePatterns: ['text-heavy', 'content-focused'] },
  { tag: 'media-rich', namePatterns: ['gallery', 'video', 'audio', 'photo'], readmePatterns: ['media-rich', 'multimedia'] },
  { tag: 'interactive', depPatterns: ['three', 'pixi', 'phaser'], readmePatterns: ['interactive', 'dynamic'] },
  { tag: 'code-focused', namePatterns: ['code', 'snippet', 'playground', 'repl', 'codex'], depPatterns: ['monaco-editor', 'codemirror'] },
  { tag: 'tutorial', namePatterns: ['tutorial', 'learn', 'course', 'lesson', 'demo', 'example'], readmePatterns: ['tutorial', 'step-by-step'] },
];

export const INTERACTION_MODEL_PATTERNS: TagPattern[] = [
  { tag: 'read-only', readmePatterns: ['read-only', 'view only', 'display only'] },
  { tag: 'collaborative', depPatterns: ['yjs', 'automerge', 'sharedb'], readmePatterns: ['collaborative', 'real-time collaboration', 'multi-user'] },
  { tag: 'single-user', readmePatterns: ['single user', 'personal', 'individual'] },
  { tag: 'real-time-multiplayer', depPatterns: ['socket.io', 'colyseus'], readmePatterns: ['multiplayer', 'real-time multiplayer'] },
];

export const SCALE_TARGET_PATTERNS: TagPattern[] = [
  { tag: 'personal', namePatterns: ['personal', 'my', 'solo', 'alex'], readmePatterns: ['personal use', 'personal project'] },
  { tag: 'enterprise', namePatterns: ['enterprise', 'business'], readmePatterns: ['enterprise', 'large scale', 'enterprise-ready'] },
];

export const MONETIZATION_PATTERNS: TagPattern[] = [
  { tag: 'free', readmePatterns: ['free', 'no cost', 'gratis'] },
  { tag: 'open-source', filePatterns: ['LICENSE', 'CONTRIBUTING.md'], readmePatterns: ['open source', 'open-source', 'mit license', 'apache'] },
];

export const TECH_STYLE_PATTERNS: TagPattern[] = [
  { tag: 'vanilla-js', readmePatterns: ['vanilla javascript', 'no framework', 'pure javascript'] },
  { tag: 'vanilla-css', readmePatterns: ['vanilla css', 'no css framework', 'pure css'] },
  { tag: 'typescript-strict', filePatterns: ['tsconfig.json'], readmePatterns: ['typescript', 'type-safe'] },
  { tag: 'component-based', depPatterns: ['react', 'vue', 'svelte', 'angular'], readmePatterns: ['component-based', 'components'] },
];

// ============================================================================
// ALL PATTERNS EXPORT
// ============================================================================

export const TAG_PATTERNS = {
  purpose: PURPOSE_PATTERNS,
  audience: AUDIENCE_PATTERNS,
  domain: DOMAIN_PATTERNS,
  features: FEATURE_PATTERNS,
  architecture: ARCHITECTURE_PATTERNS,
  uiParadigm: UI_PARADIGM_PATTERNS,
  dataHandling: DATA_HANDLING_PATTERNS,
  deploymentTarget: DEPLOYMENT_TARGET_PATTERNS,
  integrationType: INTEGRATION_TYPE_PATTERNS,
  contentType: CONTENT_TYPE_PATTERNS,
  interactionModel: INTERACTION_MODEL_PATTERNS,
  scaleTarget: SCALE_TARGET_PATTERNS,
  monetization: MONETIZATION_PATTERNS,
  techStyle: TECH_STYLE_PATTERNS,
};

// ============================================================================
// TAG METADATA (for UI display)
// ============================================================================

export interface TagMetadata {
  label: string;
  description: string;
  color?: string;
}

export const TAG_CATEGORY_META: Record<keyof typeof TAG_PATTERNS, TagMetadata> = {
  purpose: { label: 'Purpose', description: 'What the project is designed to do', color: '#3B82F6' },
  audience: { label: 'Audience', description: 'Who the project is built for', color: '#8B5CF6' },
  domain: { label: 'Domain', description: 'Industry or field the project serves', color: '#EC4899' },
  features: { label: 'Features', description: 'Key capabilities and functionality', color: '#10B981' },
  architecture: { label: 'Architecture', description: 'Technical architecture patterns', color: '#F59E0B' },
  uiParadigm: { label: 'UI Paradigm', description: 'User interface style and layout', color: '#6366F1' },
  dataHandling: { label: 'Data Handling', description: 'How data is stored and processed', color: '#14B8A6' },
  deploymentTarget: { label: 'Deployment', description: 'Where the project runs', color: '#F97316' },
  integrationType: { label: 'Integration', description: 'How the project connects with others', color: '#84CC16' },
  contentType: { label: 'Content Type', description: 'Nature of the content', color: '#A855F7' },
  interactionModel: { label: 'Interaction', description: 'How users interact with the project', color: '#06B6D4' },
  scaleTarget: { label: 'Scale', description: 'Target scale of deployment', color: '#EF4444' },
  monetization: { label: 'Monetization', description: 'Business model', color: '#22C55E' },
  techStyle: { label: 'Tech Style', description: 'Coding and technology approach', color: '#64748B' },
};
