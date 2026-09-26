import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { LaunchSettings, PreviewOverrides } from './types';

export interface LaunchPlanResult {
  status: 'ok' | 'ambiguous' | 'setup-required' | 'unsupported';
  launch?: LaunchSettings;
  reason?: string;
  requirements?: string[];
  suggestedCommandLine?: string;
  evidence: string[];
  hasBundler: boolean;
}

async function readJson(p: string): Promise<any | null> {
  try { return JSON.parse(await fsp.readFile(p, 'utf-8')); } catch { return null; }
}
async function readText(p: string): Promise<string> {
  try { return await fsp.readFile(p, 'utf-8'); } catch { return ''; }
}
function exists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

/** Split a saved command line into words without invoking a shell. */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) { quote = null; }
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) { cur += line[++i]; }
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
    } else if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i]; has = true;
    } else {
      cur += ch; has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

function detectPackageManager(projectPath: string, pkg: any): LaunchSettings['packageManager'] {
  const pmField: string | undefined = pkg?.packageManager;
  if (pmField) {
    const name = pmField.split('@')[0];
    if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;
  }
  if (exists(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(projectPath, 'bun.lockb')) || exists(path.join(projectPath, 'bun.lock'))) return 'bun';
  return 'npm';
}

function runScriptArgs(pm: LaunchSettings['packageManager'], script: string, extra: string[]): string[] {
  // npm needs "--" to forward flags to the script; pnpm/yarn/bun forward them directly.
  if (pm === 'npm') return ['run', script, ...(extra.length ? ['--', ...extra] : [])];
  return ['run', script, ...extra];
}

function customLaunch(projectPath: string, overrides: PreviewOverrides, evidence: string[]): LaunchPlanResult {
  const words = splitCommandLine(overrides.commandLine || '');
  if (!words.length) {
    return { status: 'setup-required', reason: 'Saved command is empty.', evidence, hasBundler: false };
  }
  const usesTemplate = words.some(w => w.includes('{PORT}'));
  const cwd = overrides.commandCwd ? path.resolve(projectPath, overrides.commandCwd) : projectPath;
  const [command, ...args] = words;
  const launch: LaunchSettings = {
    cwd,
    command,
    args,
    packageManager: 'none',
    framework: 'custom',
    portMode: usesTemplate ? 'template' : 'env-PORT',
    entryUrlPath: '/',
    depsInstalled: true,
    evidence: [...evidence, `Saved command: ${overrides.commandLine}`, usesTemplate ? 'Port passed through {PORT} placeholder.' : 'Port passed through the PORT environment variable.'],
  };
  return { status: 'ok', launch, evidence: launch.evidence, hasBundler: false };
}

/**
 * Inspect manifests, scripts, lockfiles and environments to build a launch
 * plan. Nothing is executed here. Technology tags are never trusted on their
 * own; every decision cites the file it came from.
 */
export async function planLaunch(projectPath: string, overrides?: PreviewOverrides): Promise<LaunchPlanResult> {
  const evidence: string[] = [];
  const pkgPath = path.join(projectPath, 'package.json');
  const pkg = await readJson(pkgPath);
  const deps: Record<string, string> = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts: Record<string, string> = pkg?.scripts || {};
  const hasBundler = Boolean(deps.vite || deps.next || deps['react-scripts'] || deps.webpack || deps.parcel || deps['@angular/cli'] || deps.astro || deps['@sveltejs/kit'] || deps.nuxt);

  if (overrides?.commandLine) {
    const result = customLaunch(projectPath, overrides, evidence);
    result.hasBundler = hasBundler;
    return result;
  }

  if (pkg) {
    const pm = detectPackageManager(projectPath, pkg);
    const depsInstalled = exists(path.join(projectPath, 'node_modules'));
    evidence.push(`package.json present; package manager: ${pm}${pkg.packageManager ? ' (packageManager field)' : ' (lockfile)'}.`);
    evidence.push(depsInstalled ? 'node_modules present.' : 'node_modules missing.');
    const dev = scripts.dev || '';
    const start = scripts.start || '';
    const requirements = depsInstalled ? [] : [`Install dependencies first (run \`${pm} install\` in the project). qnav does not install packages on its own.`];

    const finish = (launch: LaunchSettings): LaunchPlanResult => {
      if (!depsInstalled) {
        return { status: 'setup-required', launch, reason: 'Dependencies are not installed.', requirements, evidence, hasBundler };
      }
      return { status: 'ok', launch, evidence, hasBundler };
    };

    const simpleDev = /^(vite|next dev|next)(\s|$)/.test(dev.trim()) || /^(vite|next)\b/.test(dev.trim());
    const isCompound = /concurrently|&&|\|\||\bturbo\b|electron|wrangler|remotion|tsup|webpack|nodemon/.test(dev);

    if (deps.next && /\bnext dev\b/.test(dev) && !isCompound) {
      evidence.push(`scripts.dev = "${dev}" uses next dev.`);
      const launch: LaunchSettings = {
        cwd: projectPath, command: pm, args: runScriptArgs(pm, 'dev', []),
        packageManager: pm, framework: 'next', portMode: 'next-flag', entryUrlPath: '/',
        depsInstalled, evidence: [...evidence, 'Port passed as `-p <port>` (Next.js CLI flag).'],
      };
      return finish(launch);
    }

    if (deps.vite && /^vite(\s|$)/.test(dev.trim()) && !isCompound) {
      evidence.push(`scripts.dev = "${dev}" runs vite.`);
      const launch: LaunchSettings = {
        cwd: projectPath, command: pm, args: runScriptArgs(pm, 'dev', []),
        packageManager: pm, framework: 'vite', portMode: 'vite-flags', entryUrlPath: '/',
        depsInstalled, evidence: [...evidence, 'Port passed as `--port <port> --strictPort` (Vite CLI flags).'],
      };
      return finish(launch);
    }

    if (deps['react-scripts'] && /react-scripts start/.test(start)) {
      evidence.push(`scripts.start = "${start}" uses react-scripts.`);
      const launch: LaunchSettings = {
        cwd: projectPath, command: pm, args: runScriptArgs(pm, 'start', []),
        packageManager: pm, framework: 'cra', portMode: 'env-PORT', entryUrlPath: '/',
        env: { BROWSER: 'none' },
        depsInstalled, evidence: [...evidence, 'Port passed through the PORT environment variable; BROWSER=none.'],
      };
      return finish(launch);
    }

    if (deps.electron || /electron/.test(dev) || /electron/.test(start)) {
      evidence.push('Electron detected: a desktop window, not a web page.');
      return { status: 'unsupported', reason: 'Electron app: it opens a native window and has no browser entry point.', evidence, hasBundler };
    }

    if (dev || start) {
      const script = dev ? 'dev' : 'start';
      const line = dev || start;
      evidence.push(`scripts.${script} = "${line}" is not a recognised single-framework command.`);
      const suggested = `${pm} run ${script}`;
      return {
        status: 'ambiguous',
        reason: `The ${script} script ("${line}") is not a plain Vite or Next.js command, so qnav will not guess how it binds a port. Save a command to enable a managed preview.`,
        suggestedCommandLine: suggested,
        requirements: depsInstalled ? [] : requirements,
        evidence,
        hasBundler,
      };
    }

    evidence.push('package.json has no dev or start script.');
    return { status: 'unsupported', reason: 'No dev or start script in package.json.', evidence, hasBundler, suggestedCommandLine: undefined };
  }

  // ---- Python ----
  const req = await readText(path.join(projectPath, 'requirements.txt'));
  const pyproject = await readText(path.join(projectPath, 'pyproject.toml'));
  const pyText = (req + '\n' + pyproject).toLowerCase();
  const hasPy = Boolean(req || pyproject) || exists(path.join(projectPath, 'app.py')) || exists(path.join(projectPath, 'main.py')) || exists(path.join(projectPath, 'manage.py'));
  if (hasPy) {
    const venvs = ['.venv', 'venv', 'env'].map(v => path.join(projectPath, v, 'bin', 'python')).filter(exists);
    const python = venvs[0];
    evidence.push(python ? `Virtual environment found: ${path.relative(projectPath, python)}.` : 'No virtual environment (.venv/venv/env) found.');
    let suggested: string | undefined;
    if (exists(path.join(projectPath, 'manage.py')) || /\bdjango\b/.test(pyText)) {
      evidence.push('Django detected (manage.py / requirements).');
      suggested = `${python || 'python3'} manage.py runserver 127.0.0.1:{PORT}`;
    } else if (/\bfastapi\b|\buvicorn\b/.test(pyText)) {
      const entry = exists(path.join(projectPath, 'main.py')) ? 'main:app' : 'app:app';
      evidence.push('FastAPI/uvicorn detected in requirements.');
      suggested = `${python || 'python3'} -m uvicorn ${entry} --port {PORT}`;
    } else if (/\bflask\b/.test(pyText)) {
      const entry = exists(path.join(projectPath, 'app.py')) ? 'app.py' : (exists(path.join(projectPath, 'main.py')) ? 'main.py' : 'app.py');
      evidence.push('Flask detected in requirements.');
      suggested = `${python || 'python3'} -m flask --app ${entry} run --port {PORT}`;
    } else if (/\bstreamlit\b/.test(pyText)) {
      suggested = `${python || 'python3'} -m streamlit run app.py --server.port {PORT} --server.headless true`;
    }
    if (suggested) {
      return {
        status: 'ambiguous',
        reason: 'Python web project: confirm the interpreter and entry point before qnav runs it.',
        suggestedCommandLine: suggested,
        requirements: python ? [] : ['Create and populate a virtual environment (.venv) before launching.'],
        evidence,
        hasBundler: false,
      };
    }
    return { status: 'unsupported', reason: 'Python project without a recognised web framework; no visual preview.', evidence, hasBundler: false };
  }

  return { status: 'unsupported', reason: 'No package.json or Python web project detected.', evidence, hasBundler: false };
}

/** Materialise the argv/env for a specific port. */
export function applyPort(launch: LaunchSettings, port: number): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { ...(launch.env || {}), PORT: String(port) };
  let args = [...launch.args];
  switch (launch.portMode) {
    case 'next-flag': {
      // npm needs the "--" separator before flags.
      if (launch.packageManager === 'npm' && !args.includes('--')) args.push('--');
      args.push('-p', String(port), '-H', '127.0.0.1');
      break;
    }
    case 'vite-flags': {
      if (launch.packageManager === 'npm' && !args.includes('--')) args.push('--');
      args.push('--port', String(port), '--strictPort', '--host', '127.0.0.1');
      break;
    }
    case 'template':
      args = args.map(a => a.replace(/\{PORT\}/g, String(port)));
      break;
    case 'env-PORT':
    case 'fixed':
    default:
      break;
  }
  return { command: launch.command, args, env };
}
