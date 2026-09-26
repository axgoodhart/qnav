/**
 * Shared preview contract types.
 *
 * A PreviewPlan says HOW a project can be shown (static files, a managed dev
 * server, an external URL, or not at all). A PreviewSession is a live
 * instance of a plan that consumers (the flipper, thumbnails, the capture
 * worker) acquire and release.
 */

export type PreviewMode =
  | 'static'          // qnav serves existing files from a serving root
  | 'managed'         // qnav starts the project's dev command
  | 'external'        // owner attached a URL served by something else
  | 'choose-entry'    // several plausible entry points; owner must pick
  | 'setup-required'  // launchable in principle, but something is missing (deps, saved command)
  | 'unsupported';    // no visual web entry point

export type EntryKind = 'loose-file' | 'root-index' | 'root-html' | 'built-output' | 'nested-index';

export interface EntryCandidate {
  /** Path relative to the project folder (or the file name for loose files). */
  relPath: string;
  /** Absolute serving root that must be used for this entry. */
  servingRoot: string;
  /** URL path under the serving root. */
  urlPath: string;
  kind: EntryKind;
  label: string;
  score: number;
  isBuild: boolean;
  mtime?: string;
  /** True when the HTML is a bundler template (Vite/Next/CRA) and cannot run statically. */
  requiresBundler?: boolean;
}

export type Framework =
  | 'vite' | 'next' | 'cra'
  | 'node'
  | 'python-flask' | 'python-fastapi' | 'python-django' | 'python-http'
  | 'custom';

export type PortMode = 'vite-flags' | 'next-flag' | 'env-PORT' | 'template' | 'fixed';

export interface LaunchSettings {
  cwd: string;
  command: string;
  args: string[];
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none';
  framework: Framework;
  portMode: PortMode;
  fixedPort?: number;
  env?: Record<string, string>;
  entryUrlPath: string;
  depsInstalled: boolean;
  evidence: string[];
}

export interface PreviewOverrides {
  entryRelPath?: string;
  mode?: 'static' | 'managed' | 'external';
  /** A saved command line (parsed without a shell). `{PORT}` is substituted. */
  commandLine?: string;
  commandCwd?: string;
  externalUrl?: string;
  readinessSelector?: string;
  settleMs?: number;
  /** Bumped every time the owner saves overrides. */
  revision: number;
  updatedAt?: string;
}

export interface PreviewPlan {
  id: string;
  name: string;
  projectPath: string;
  kind: 'folder' | 'file';
  mode: PreviewMode;
  revision: string;
  servingRoot?: string;
  entryRelPath?: string;
  entryUrlPath: string;
  launch?: LaunchSettings;
  externalUrl?: string;
  candidates: EntryCandidate[];
  explanation: string[];
  buildInfo?: { path: string; mtime: string };
  reason?: string;
  requirements?: string[];
  /** A suggested launch when the plan is setup-required because the command is ambiguous. */
  suggestedCommandLine?: string;
  overrides?: PreviewOverrides;
  readinessSelector?: string;
  settleMs?: number;
  /** What the launch planner concluded, even when the plan ended up static. */
  launchStatus?: 'ok' | 'ambiguous' | 'setup-required' | 'unsupported';
  launchReason?: string;
  launchRequirements?: string[];
  /** True when a runnable static entry exists even though another mode was chosen. */
  staticAvailable?: boolean;
  managedAvailable?: boolean;
}

export type SessionState = 'queued' | 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped';

export interface SessionError {
  code: string;
  message: string;
  detail?: string;
}

export interface PreviewSession {
  id: string;
  planId: string;
  planRevision: string;
  projectName: string;
  mode: 'static' | 'managed' | 'external';
  state: SessionState;
  url?: string;
  port?: number;
  pid?: number;
  consumers: string[];
  pinned: boolean;
  external: boolean;
  startedAt: string;
  readyAt?: string;
  lastUsedAt: string;
  error?: SessionError;
  httpStatus?: number;
  queueInfo?: { position: number; occupying: string[] };
  command?: string;
  note?: string;
  /** Set when the server forbids framing; the UI offers Open in new tab instead. */
  embedBlocked?: string;
}

export interface AcquireOptions {
  /** Never evict another session to make room (used by the capture worker). */
  noEvict?: boolean;
  /** Upper bound to wait in the capacity queue before giving up. */
  queueTimeoutMs?: number;
}
