import * as fsp from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { Browser, BrowserContext } from 'playwright';
import { EnrichedProjectMetadata } from '../enrichedMetadata';
import { DataStore } from './dataStore';
import { PreviewConfig } from './previewConfig';
import { PreviewService, PreviewUnavailableError } from './previewService';
import { computeSourceSignature } from './signature';
import { PreviewSession } from './types';

export type ItemState = 'queued' | 'running' | 'captured' | 'failed' | 'skipped' | 'canceled';

export interface QueueItem {
  projectId: string;
  name: string;
  state: ItemState;
  reason?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
}

export interface QueueState {
  status: 'idle' | 'running' | 'paused' | 'canceled' | 'done';
  items: QueueItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CaptureDiagnostics {
  title?: string;
  mainStatus?: number;
  consoleErrors: number;
  pageErrors: number;
  textLength?: number;
  canvasCount?: number;
  mediaCount?: number;
  selectorTimedOut?: boolean;
  firstErrors: string[];
}

export interface CaptureRecord {
  projectId: string;
  name: string;
  status: 'captured' | 'failed';
  verified: boolean;
  imagePath?: string;
  capturedAt?: string;
  url?: string;
  mode?: string;
  viewport?: { width: number; height: number; deviceScaleFactor: number };
  sourceSignature?: string;
  signatureTruncated?: boolean;
  planRevision?: string;
  elapsedMs?: number;
  transportReady?: boolean;
  diagnostics?: CaptureDiagnostics;
  /** Latest failure, kept alongside the previous good capture. */
  lastError?: string;
  lastAttemptAt?: string;
  /** Computed at listing time. */
  stale?: boolean;
}

const CONSUMER = 'capture-worker';

/**
 * Screenshot worker. Uses the same preview service as the interactive
 * flipper: it never detects frameworks, allocates ports or spawns anything
 * itself. One capture at a time; resumable across restarts.
 */
export class CaptureWorker extends EventEmitter {
  private index: Record<string, CaptureRecord> = {};
  private queue: QueueState = { status: 'idle', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  private browser: Browser | null = null;
  private loopRunning = false;
  private cancelCurrent: (() => void) | null = null;
  private signatureMemo = new Map<string, { key: string; hash: string }>();
  private indexFile: string;
  private queueFile: string;

  constructor(
    private config: PreviewConfig,
    private store: DataStore,
    private preview: PreviewService,
    private getProject: (id: string) => EnrichedProjectMetadata | undefined,
  ) {
    super();
    this.indexFile = store.filePath('captures', 'index.json');
    this.queueFile = store.filePath('captures', 'queue.json');
  }

  async init(): Promise<void> {
    this.index = (await this.store.readJson<Record<string, CaptureRecord>>(this.indexFile)) || {};
    const q = await this.store.readJson<QueueState>(this.queueFile);
    if (q) {
      // Interrupted work goes back to the queue and waits for Resume; it is never marked complete.
      let interrupted = false;
      for (const item of q.items) {
        if (item.state === 'running') { item.state = 'queued'; item.startedAt = undefined; interrupted = true; }
      }
      if (q.status === 'running') { q.status = 'paused'; interrupted = true; }
      this.queue = q;
      if (interrupted) await this.saveQueue();
    }
  }

  // ------------------------------------------------------------ listing

  async list(): Promise<{ captures: Record<string, CaptureRecord>; queue: QueueState }> {
    const captures: Record<string, CaptureRecord> = {};
    for (const [id, rec] of Object.entries(this.index)) {
      const project = this.getProject(id);
      let stale: boolean | undefined;
      if (project && rec.sourceSignature) {
        const sig = await this.signatureFor(project);
        stale = sig !== rec.sourceSignature;
      }
      captures[id] = { ...rec, stale };
    }
    return { captures, queue: this.queue };
  }

  record(id: string): CaptureRecord | undefined { return this.index[id]; }

  imagePath(id: string): string | null {
    const rec = this.index[id];
    if (!rec || !rec.imagePath) return null;
    return this.store.filePath(rec.imagePath);
  }

  async preflight(projectIds: string[]) {
    const counts = { static: 0, managed: 0, external: 0, unavailable: 0, unchanged: 0 };
    for (const id of projectIds) {
      const project = this.getProject(id);
      if (!project) { counts.unavailable++; continue; }
      const plan = await this.preview.resolvePreview(id);
      if (plan.mode === 'static') counts.static++;
      else if (plan.mode === 'managed') counts.managed++;
      else if (plan.mode === 'external') counts.external++;
      else counts.unavailable++;
      const rec = this.index[id];
      if (rec && rec.status === 'captured' && rec.planRevision === plan.revision && rec.sourceSignature) {
        const sig = await this.signatureFor(project);
        if (sig === rec.sourceSignature) counts.unchanged++;
      }
    }
    return { counts, maxManagedSessions: this.config.maxManagedSessions };
  }

  // ------------------------------------------------------------ queue control

  async run(projectIds: string[], force = false): Promise<{ queue: QueueState; queued: number }> {
    const active = this.queue.status === 'running' || this.queue.status === 'paused';
    if (!active) {
      this.queue = { status: 'running', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    const pending = new Set(this.queue.items.filter(i => i.state === 'queued' || i.state === 'running').map(i => i.projectId));
    let queued = 0;
    for (const id of projectIds) {
      if (pending.has(id)) continue;
      const project = this.getProject(id);
      if (!project) continue;
      // Re-running a finished item replaces its old row.
      this.queue.items = this.queue.items.filter(i => i.projectId !== id || i.state === 'queued' || i.state === 'running');
      this.queue.items.push({ projectId: id, name: project.name, state: 'queued', reason: force ? 'force' : undefined });
      pending.add(id);
      queued++;
    }
    if (this.queue.status !== 'paused') this.queue.status = 'running';
    await this.saveQueue();
    this.emitUpdate('queue');
    if (this.queue.status === 'running') void this.loop();
    return { queue: this.queue, queued };
  }

  async pause(): Promise<QueueState> {
    if (this.queue.status === 'running') { this.queue.status = 'paused'; await this.saveQueue(); this.emitUpdate('queue'); }
    return this.queue;
  }

  async resume(): Promise<QueueState> {
    if (this.queue.status === 'paused' || this.queue.status === 'canceled' || this.queue.status === 'done') {
      if (this.queue.items.some(i => i.state === 'queued')) { this.queue.status = 'running'; await this.saveQueue(); this.emitUpdate('queue'); void this.loop(); }
    }
    return this.queue;
  }

  async cancel(): Promise<QueueState> {
    for (const item of this.queue.items) if (item.state === 'queued') item.state = 'canceled';
    this.queue.status = 'canceled';
    if (this.cancelCurrent) this.cancelCurrent();
    await this.saveQueue();
    this.emitUpdate('queue');
    return this.queue;
  }

  async retryFailed(): Promise<QueueState> {
    let any = false;
    for (const item of this.queue.items) {
      if (item.state === 'failed' || item.state === 'canceled') { item.state = 'queued'; item.error = undefined; item.reason = 'retry'; any = true; }
    }
    if (any) { this.queue.status = 'running'; await this.saveQueue(); this.emitUpdate('queue'); void this.loop(); }
    return this.queue;
  }

  async shutdown(): Promise<void> {
    if (this.queue.status === 'running') { this.queue.status = 'paused'; await this.saveQueue(); }
    if (this.cancelCurrent) this.cancelCurrent();
    await this.closeBrowser();
  }

  // ------------------------------------------------------------ worker loop

  private async loop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;
    try {
      while (this.queue.status === 'running') {
        const item = this.queue.items.find(i => i.state === 'queued');
        if (!item) { this.queue.status = 'done'; await this.saveQueue(); this.emitUpdate('queue'); break; }
        item.state = 'running';
        item.startedAt = new Date().toISOString();
        await this.saveQueue();
        this.emitUpdate('item', item);
        const started = Date.now();
        try {
          const outcome = await this.captureOne(item);
          item.state = outcome.state;
          item.reason = outcome.reason;
          item.error = outcome.error;
        } catch (err: any) {
          item.state = 'failed';
          item.error = err?.message || String(err);
        }
        item.finishedAt = new Date().toISOString();
        item.elapsedMs = Date.now() - started;
        if ((this.queue.status as string) === 'canceled' && (item.state as string) === 'running') item.state = 'canceled';
        await this.saveQueue();
        this.emitUpdate('item', item);
      }
    } finally {
      this.loopRunning = false;
      await this.closeBrowser();
    }
  }

  private async captureOne(item: QueueItem): Promise<{ state: ItemState; reason?: string; error?: string }> {
    const id = item.projectId;
    const project = this.getProject(id);
    if (!project) return { state: 'skipped', reason: 'No longer in the catalog' };

    let plan;
    try { plan = await this.preview.resolvePreview(id); } catch (err: any) { return { state: 'failed', error: `Plan resolution failed: ${err?.message || err}` }; }
    if (plan.mode !== 'static' && plan.mode !== 'managed' && plan.mode !== 'external') {
      return { state: 'skipped', reason: plan.reason || `No preview (${plan.mode})` };
    }

    const sig = await computeSourceSignature(plan.projectPath, this.config.signatureMaxFiles);
    const existing = this.index[id];
    if (item.reason !== 'force' && item.reason !== 'retry' && existing && existing.status === 'captured' && existing.sourceSignature === sig.hash && existing.planRevision === plan.revision && existing.imagePath) {
      existing.lastAttemptAt = new Date().toISOString();
      await this.saveIndex();
      this.emitUpdate('record', undefined, { [id]: existing });
      return { state: 'skipped', reason: 'Unchanged since last capture (reused)' };
    }

    // Acquire through the shared service. The worker never evicts a live preview.
    const preexisting = this.preview.manager.findByPlan(id);
    const wasReady = Boolean(preexisting && preexisting.state === 'ready');
    let session: PreviewSession;
    try {
      const result = await this.preview.acquirePreview(id, CONSUMER, { noEvict: true, queueTimeoutMs: this.config.captureQueueTimeoutMs });
      session = result.session;
    } catch (err: any) {
      if (err instanceof PreviewUnavailableError) return { state: 'skipped', reason: err.plan.reason || err.plan.mode };
      return { state: 'failed', error: `Could not acquire preview: ${err?.message || err}` };
    }

    let canceled = false;
    this.cancelCurrent = () => { canceled = true; };
    let context: BrowserContext | null = null;
    const attemptAt = new Date().toISOString();
    const started = Date.now();
    try {
      try {
        session = await this.preview.waitReady(session, this.config.startupDeadlineMs + this.config.captureQueueTimeoutMs);
      } catch (err: any) {
        return this.recordFailure(id, project.name, attemptAt, `Preview not ready: ${err?.message || err}`, false);
      }
      if (canceled) return { state: 'canceled' };
      if (!session.url) return this.recordFailure(id, project.name, attemptAt, 'Session has no URL', false);

      const browser = await this.getBrowser();
      const vp = this.config.captureViewport;
      context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const diag: CaptureDiagnostics = { consoleErrors: 0, pageErrors: 0, firstErrors: [] };
      page.on('console', msg => { if (msg.type() === 'error') { diag.consoleErrors++; if (diag.firstErrors.length < 5) diag.firstErrors.push(msg.text().slice(0, 200)); } });
      page.on('pageerror', err => { diag.pageErrors++; if (diag.firstErrors.length < 5) diag.firstErrors.push(String(err.message || err).slice(0, 200)); });

      let mainStatus: number | undefined;
      try {
        const resp = await page.goto(session.url, { waitUntil: 'load', timeout: this.config.captureNavigationTimeoutMs });
        mainStatus = resp ? resp.status() : undefined;
      } catch (err: any) {
        return this.recordFailure(id, project.name, attemptAt, `Navigation failed: ${err?.message || err}`, true);
      }
      diag.mainStatus = mainStatus;
      if (canceled) return { state: 'canceled' };

      const selector = plan.readinessSelector;
      if (selector) {
        try { await page.waitForSelector(selector, { timeout: this.config.captureNavigationTimeoutMs }); }
        catch { diag.selectorTimedOut = true; }
      }
      const settle = plan.settleMs != null ? plan.settleMs : this.config.captureSettleMs;
      await page.waitForTimeout(Math.max(0, settle));
      if (canceled) return { state: 'canceled' };

      try {
        // Evaluated inside the page; written as a string so the server build needs no DOM lib.
        const signals = await page.evaluate<{ title: string; textLength: number; canvasCount: number; mediaCount: number }>(
          `(() => ({
            title: document.title,
            textLength: ((document.body && document.body.innerText) || '').trim().length,
            canvasCount: document.querySelectorAll('canvas').length,
            mediaCount: document.querySelectorAll('img, video, svg, iframe, object, embed').length,
          }))()`);
        Object.assign(diag, signals);
      } catch { /* page may have navigated away; keep going */ }

      const png = await page.screenshot({ type: 'png', fullPage: false, timeout: 15000 });
      const stamp = attemptAt.replace(/[:.]/g, '-');
      const rel = path.join('captures', id, `${stamp}.png`);
      await fsp.mkdir(path.dirname(this.store.filePath(rel)), { recursive: true });
      await fsp.writeFile(this.store.filePath(rel), png);

      const badTitle = /^(cannot get|404|not found|error|internal server error|application error)/i.test(diag.title || '');
      const hasContent = (diag.textLength || 0) > 0 || (diag.canvasCount || 0) > 0 || (diag.mediaCount || 0) > 0;
      const verified = mainStatus !== undefined && mainStatus < 400 && hasContent && !badTitle && diag.pageErrors === 0;

      const prev = this.index[id];
      const rec: CaptureRecord = {
        projectId: id, name: project.name, status: 'captured', verified, imagePath: rel, capturedAt: attemptAt,
        url: session.url, mode: session.mode, viewport: { ...vp }, sourceSignature: sig.hash, signatureTruncated: sig.truncated,
        planRevision: plan.revision, elapsedMs: Date.now() - started, transportReady: true, diagnostics: diag,
        lastError: undefined, lastAttemptAt: attemptAt,
      };
      this.index[id] = rec;
      await this.saveIndex();
      // Drop older images for this project; keep only the one we reference.
      if (prev && prev.imagePath && prev.imagePath !== rel) fsp.unlink(this.store.filePath(prev.imagePath)).catch(() => {});
      this.emitUpdate('record', undefined, { [id]: rec });
      return { state: 'captured', reason: verified ? undefined : 'Captured but unverified (empty page, error status or page error)' };
    } finally {
      this.cancelCurrent = null;
      if (context) await context.close().catch(() => {});
      this.preview.releasePreview(session.id, CONSUMER);
      // A dev server started only for this capture is stopped again unless someone else picked it up.
      if (session.mode === 'managed' && !session.external && !wasReady) {
        const now = this.preview.getSession(session.id);
        if (now && now.consumers.length === 0 && !now.pinned) await this.preview.stopPreview(session.id).catch(() => {});
      }
    }
  }

  private async recordFailure(id: string, name: string, attemptAt: string, error: string, transportReady: boolean): Promise<{ state: ItemState; error: string }> {
    const prev = this.index[id];
    if (prev && prev.imagePath) {
      // Keep the previous useful capture; annotate the failed attempt.
      prev.lastError = error;
      prev.lastAttemptAt = attemptAt;
    } else {
      this.index[id] = { projectId: id, name, status: 'failed', verified: false, lastError: error, lastAttemptAt: attemptAt, transportReady };
    }
    await this.saveIndex();
    this.emitUpdate('record', undefined, { [id]: this.index[id] });
    return { state: 'failed', error };
  }

  // ------------------------------------------------------------ helpers

  private async signatureFor(project: EnrichedProjectMetadata): Promise<string> {
    const key = `${project.lastModified || ''}`;
    const memo = this.signatureMemo.get(project.id!);
    if (memo && memo.key === key && project.kind !== 'file') return memo.hash;
    const sig = await computeSourceSignature(project.path, this.config.signatureMaxFiles);
    this.signatureMemo.set(project.id!, { key, hash: sig.hash });
    return sig.hash;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }

  private async closeBrowser(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }

  private saveQueue(): Promise<void> {
    this.queue.updatedAt = new Date().toISOString();
    return this.store.writeJson(this.queueFile, this.queue);
  }

  private saveIndex(): Promise<void> {
    return this.store.writeJson(this.indexFile, this.index);
  }

  private emitUpdate(event: 'queue' | 'item' | 'record', item?: QueueItem, captures?: Record<string, CaptureRecord>): void {
    this.emit('update', { event, queue: this.queue, item, captures });
  }
}
