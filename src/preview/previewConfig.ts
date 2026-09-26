/**
 * Preview / capture configuration.
 *
 * This is the single documented surface for tunables. Every value can be
 * overridden from cufolio.config.json under the "preview" key, e.g.
 *
 *   { "preview": { "maxManagedSessions": 2, "idleTimeoutMs": 300000 } }
 *
 * These are starting values, not performance claims.
 */
export interface PreviewConfig {
  /** Directory (relative to the qnav folder) holding overrides, captures and run state. */
  dataDir: string;
  /** Maximum simultaneously running dev servers that qnav owns. */
  maxManagedSessions: number;
  /** A session with no consumers and no pin is stopped after this long. */
  idleTimeoutMs: number;
  /** How long a dev server may take to answer HTTP before the launch fails. */
  startupDeadlineMs: number;
  /** Ports handed to managed dev servers are chosen from this inclusive range. */
  managedPortRangeStart: number;
  managedPortRangeEnd: number;
  /** Static listeners (one per serving root) beyond this are closed LRU-first. */
  maxStaticListeners: number;
  /** A static listener with no sessions is closed after this long. */
  staticIdleTimeoutMs: number;
  /** Lines of stdout/stderr kept per managed session. */
  logLines: number;
  /** Screenshot worker settings. */
  captureConcurrency: number;
  captureViewport: { width: number; height: number; deviceScaleFactor: number };
  captureNavigationTimeoutMs: number;
  captureSettleMs: number;
  /** How long the worker waits in the capacity queue before skipping an item. */
  captureQueueTimeoutMs: number;
  /** Files hashed for the source signature are capped at this count. */
  signatureMaxFiles: number;
}

export const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
  dataDir: 'data',
  maxManagedSessions: 3,
  idleTimeoutMs: 10 * 60 * 1000,
  startupDeadlineMs: 60 * 1000,
  managedPortRangeStart: 4400,
  managedPortRangeEnd: 4999,
  maxStaticListeners: 6,
  staticIdleTimeoutMs: 10 * 60 * 1000,
  logLines: 300,
  captureConcurrency: 1,
  captureViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  captureNavigationTimeoutMs: 30 * 1000,
  captureSettleMs: 2000,
  captureQueueTimeoutMs: 90 * 1000,
  signatureMaxFiles: 4000,
};

export function resolvePreviewConfig(partial?: Partial<PreviewConfig>): PreviewConfig {
  const merged: PreviewConfig = { ...DEFAULT_PREVIEW_CONFIG, ...(partial || {}) };
  merged.captureViewport = { ...DEFAULT_PREVIEW_CONFIG.captureViewport, ...(partial?.captureViewport || {}) };
  return merged;
}
