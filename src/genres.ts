/**
 * Project genres
 *
 * The original `category` axis (Frontend/Backend/ML/DevOps/...) is too narrow
 * for a creative-coding sketchbook. Genres are richer, multi-label tags
 * that describe *what kind of thing this project is*, derived from:
 *
 *   - the libraries we found inside it
 *   - the API capabilities we matched (web-audio, midi, mesh, shader, ...)
 *   - the project / file name
 *   - the tech stack
 *
 * Genres are non-exclusive: a single project can be both `audio` and `ui-lab`.
 */

export type Genre =
  | 'creative-coding'
  | 'audio'
  | 'music'
  | 'midi'
  | '3d'
  | 'shader'
  | 'webgl'
  | 'visual'
  | 'generative'
  | 'animation'
  | 'data-viz'
  | 'ui-lab'
  | 'fake-os'
  | 'game'
  | 'reader'
  | 'editor'
  | 'tool'
  | 'ai-llm'
  | 'frontend'
  | 'fullstack'
  | 'backend'
  | 'mobile'
  | 'script'
  | 'writing'
  | 'archive'
  | 'sketch'
  | 'stub';

interface GenreInputs {
  name: string;
  tech: string[];
  libraries: string[];
  apis: string[];
  language?: string;
  isStub?: boolean;
  hasInlineCss?: boolean;
  hasInlineJs?: boolean;
  fileCount?: number;
}

/**
 * Friendly label for a genre — used by the dashboard.
 */
export function genreLabel(g: Genre): string {
  const labels: Record<Genre, string> = {
    'creative-coding': 'Creative coding',
    audio: 'Audio',
    music: 'Music',
    midi: 'MIDI',
    '3d': '3D',
    shader: 'Shader',
    webgl: 'WebGL',
    visual: 'Visual',
    generative: 'Generative',
    animation: 'Animation',
    'data-viz': 'Data viz',
    'ui-lab': 'UI lab',
    'fake-os': 'Fake OS',
    game: 'Game',
    reader: 'Reader',
    editor: 'Editor',
    tool: 'Tool',
    'ai-llm': 'AI / LLM',
    frontend: 'Frontend',
    fullstack: 'Fullstack',
    backend: 'Backend',
    mobile: 'Mobile',
    script: 'Script',
    writing: 'Writing',
    archive: 'Archive',
    sketch: 'Sketch',
    stub: 'Stub',
  };
  return labels[g];
}

/**
 * Multi-label genre detection. Order is intentional: more specific genres
 * are evaluated first so the broader ones serve as fallbacks.
 */
export function detectGenres(input: GenreInputs): Genre[] {
  const out = new Set<Genre>();
  const name = input.name.toLowerCase();
  const techLower = input.tech.map(t => t.toLowerCase());
  const libsLower = input.libraries.map(l => l.toLowerCase());
  const apis = new Set(input.apis);

  const hasLib = (...needles: string[]) =>
    needles.some(n => libsLower.some(l => l.includes(n.toLowerCase())));
  const hasTech = (...needles: string[]) =>
    needles.some(n => techLower.some(t => t.includes(n.toLowerCase())));
  const nameMatches = (...patterns: RegExp[]) => patterns.some(p => p.test(name));

  /* ---- audio family ---- */
  if (apis.has('midi') || nameMatches(/midi/, /kybd/)) out.add('midi');
  if (
    apis.has('web-audio') ||
    hasLib('Tone.js', 'Howler', 'Wavesurfer', 'Peaks', 'soundfont') ||
    nameMatches(/audio/, /sound/, /synth/, /sampler/, /player/, /whisper/, /transcrib/)
  ) {
    out.add('audio');
  }
  if (
    hasLib('Tone.js', 'VexFlow', 'abcjs', 'soundfont') ||
    nameMatches(/music/, /piano/, /clarinet/, /opera/, /melody/, /sonata/, /chord/, /tetrachord/, /score/, /qtet/, /poetry/, /pendereck/, /sonata/, /mozart/, /zynth/, /penderecki/)
  ) {
    out.add('music');
  }
  // Cascade: anything MIDI is implicitly audio + music
  if (out.has('midi')) {
    out.add('audio');
    out.add('music');
  }
  // Cascade: anything music-related is also audio
  if (out.has('music')) out.add('audio');

  /* ---- 3D / WebGL / shaders ---- */
  if (apis.has('mesh') || hasLib('Three.js', 'Babylon.js')) {
    out.add('3d');
    out.add('webgl');
  }
  if (apis.has('shader')) out.add('shader');
  if (apis.has('webgl')) out.add('webgl');

  /* ---- generative / creative-coding ---- */
  if (
    hasLib('p5.js', 'Processing.js', 'Two.js', 'Paper.js', 'Pixi.js', 'regl') ||
    apis.has('canvas-2d') || apis.has('canvas') ||
    nameMatches(/sketch/, /generative/, /particles?/, /noise/, /flow/, /swarm/, /butterfl/, /spiral/, /orb/, /spheres?/, /cube/, /cubic/, /tornado/)
  ) {
    out.add('creative-coding');
    out.add('visual');
    if (!out.has('animation')) out.add('generative');
  }

  /* ---- animation ---- */
  if (hasLib('GSAP', 'anime.js', 'Lottie', 'Motion', 'Popmotion')) {
    out.add('animation');
  }
  if (apis.has('raf-loop') && !out.has('3d')) {
    out.add('animation');
  }

  /* ---- data-viz ---- */
  if (hasLib('D3', 'Chart.js', 'Recharts', 'ECharts', 'Plotly', 'visx')) {
    out.add('data-viz');
  }

  /* ---- game ---- */
  if (
    hasLib('Phaser', 'Kaboom.js', 'Excalibur', 'Matter.js', 'Cannon.js') ||
    nameMatches(/\bgame\b/, /arcade/, /maze/, /spyro/, /justris/, /tetra(?!chord)/, /quest/, /battle/)
  ) {
    out.add('game');
  }

  /* ---- ui-lab / fake-os ---- */
  if (
    nameMatches(
      /\bos\b/, /menu/, /panel/, /dock/, /widget/, /icon/, /knob/, /slider/,
      /modal/, /dropdown/, /toolbar/, /sidebar/, /grid/, /button/, /card/,
      /coverflow/, /lab/, /demo$/, /component/, /style/, /theme/, /palette/
    )
  ) {
    out.add('ui-lab');
  }
  if (nameMatches(/^orbos/, /^myos/, /^briizos/, /^alexos/, /\bos\b.*\.html$/i, /winmac/, /tigrisos/, /glos/, /fakeos/)) {
    out.add('fake-os');
    out.add('ui-lab');
  }

  /* ---- reader / editor / tool ---- */
  if (nameMatches(/pdf/, /reader/, /viewer/, /epub/, /book/)) out.add('reader');
  if (nameMatches(/editor/, /writer/, /notepad/, /textedit/, /scribbl/, /moonwrite/)) out.add('editor');
  if (
    nameMatches(
      /timer/, /pomodoro/, /metronome/, /attendance/, /habit/, /tracker/,
      /attendance/, /calendar/, /scheduler/, /counter/, /todo/, /tasking/,
      /finder/, /picker/, /converter/, /format/, /clean/, /splitter/, /merge/,
      /downloader/, /scraper/, /search/, /lookup/, /capture/
    )
  ) {
    out.add('tool');
  }

  /* ---- ai / llm ---- */
  if (
    hasLib('OpenAI SDK', 'Anthropic SDK', 'LangChain', 'Transformers.js') ||
    apis.has('chat-completions') ||
    nameMatches(/\bllm\b/, /\bgpt\b/, /chat/, /claude/, /cline/, /agent/, /completions/, /prompt/, /reasoning/)
  ) {
    out.add('ai-llm');
  }

  /* ---- web stack baselines ---- */
  if (hasTech('react', 'vue', 'svelte', 'next.js', 'nuxt', 'astro', 'solid', 'qwik')) {
    out.add('frontend');
  }
  if (hasTech('express', 'fastify', 'nestjs', 'koa', 'fastapi', 'django', 'flask', 'rails')) {
    out.add('backend');
  }
  if (hasTech('next.js', 'nuxt', 'remix', 'sveltekit')) {
    out.add('fullstack');
  }
  if (hasTech('flutter', 'react native', 'swift', 'xcode', 'kotlin')) {
    out.add('mobile');
  }

  /* ---- writing ---- */
  if (input.language === 'markdown' && (input.fileCount || 0) <= 3) {
    out.add('writing');
  }

  /* ---- archive ---- */
  if (nameMatches(/\bold\b/, /^pre[-_]/, /\bdeprecated\b/, /\barchive\b/, /\bbackup\b/, /\blegacy\b/, /^delete/i)) {
    out.add('archive');
  }

  /* ---- script (single-file Python or JS w/ no UI) ---- */
  if (
    (input.language === 'python' || input.language === 'javascript' || input.language === 'typescript') &&
    !out.has('frontend') && !out.has('ui-lab') && !out.has('audio') && !out.has('3d')
  ) {
    out.add('script');
  }

  /* ---- stub ---- */
  if (input.isStub) out.add('stub');

  // sketch = creative-coding-ish but small and not-quite-anything else
  if (out.size === 0 && (input.language === 'html' || input.language === 'javascript')) {
    out.add('sketch');
  }

  return [...out];
}
