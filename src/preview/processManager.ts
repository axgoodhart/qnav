import { spawn, ChildProcess, execFile } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { AcquireOptions, PreviewPlan, PreviewSession, SessionError, SessionState } from './types';
import { applyPort } from './launchPlanner';
import { findFreePort, isPortFree, probeHttp, probeEmbedBlock } from './ports';
import { DataStore } from './dataStore';
import { PreviewConfig } from './previewConfig';

const execFileAsync = promisify(execFile);

interface Managed {
  pub: PreviewSession;
  plan: PreviewPlan;
  child?: ChildProcess;
  log: string[];
  consumers: Set<string>;
  exited: boolean;
  exitCode: number | null;
  startupAbort?: () => void;
  readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }>;
}

interface QueueEntry {
  managed: Managed;
  consumerId: string;
  noEvict: boolean;
  deadline: number | null;
  resolve: (s: Managed) => void;
  reject: (e: Error) => void;
}

interface PersistedSession {
  sessionId: string;
  planId: string;
  planRevision: string;
  projectName: string;
  pid: number;
  port: number;
  url: string;
  cwd: string;
  command: string;
  args: string[];
  startedAt: string;
  pinned: boolean;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
let sessionCounter = 0;

function nowIso() { return new Date().toISOString(); }

/**
 * The single owner of every child process qnav starts.
 * Route handlers never spawn; they call acquire/release/stop here.
 */
export class ProcessManager extends EventEmitter {
  private sessions = new Map<string, Managed>();
  private queue: QueueEntry[] = [];
  private sweepTimer: NodeJS.Timeout;
  private persistFile: string;

  constructor(private config: PreviewConfig, private store: DataStore) {
    super();
    this.persistFile = store.filePath('sessions.json');
    this.sweepTimer = setInterval(() => this.sweep(), 30 * 1000);
    this.sweepTimer.unref();
  }

  // ------------------------------------------------------------ public API

  list(): PreviewSession[] {
    return [...this.sessions.values()].map(m => this.snapshot(m));
  }

  get(sessionId: string): PreviewSession | undefined {
    const m = this.sessions.get(sessionId);
    return m ? this.snapshot(m) : undefined;
  }

  logs(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.log.slice() || [];
  }

  findByPlan(planId: string): PreviewSession | undefined {
    const m = this.findLive(planId);
    return m ? this.snapshot(m) : undefined;
  }

  /**
   * Returns as soon as a session exists for the plan (queued, starting or
   * ready). Callers subscribe for state changes or use waitReady().
   */
  async acquire(plan: PreviewPlan, consumerId: string, options: AcquireOptions = {}): Promise<PreviewSession> {
    if (!plan.launch) throw new Error('Plan has no launch settings');

    const live = this.findLive(plan.id);
    if (live && (live.pub.external || live.pub.planRevision === plan.revision)) {
      this.addConsumer(live, consumerId);
      return this.snapshot(live);
    }
    // A live session for an older revision: the owner changed launch settings, replace it.
    if (live) void this.stop(live.pub.id, 'plan changed');
    // Old failed/stopped attempts for this plan are superseded by the new one.
    for (const m of [...this.sessions.values()]) {
      if (m.pub.planId === plan.id && (m.pub.state === 'failed' || m.pub.state === 'stopped')) this.sessions.delete(m.pub.id);
    }

    const m = this.newManaged(plan, 'queued');
    m.consumers.add(consumerId);
    this.sessions.set(m.pub.id, m);
    this.emitSession(m);
    this.startWithCapacity(m, consumerId, options).catch(() => { /* outcome is recorded on the session */ });
    return this.snapshot(m);
  }

  /** Resolve when the session is ready; reject if it fails or times out. */
  waitReady(sessionId: string, timeoutMs: number): Promise<PreviewSession> {
    const m = this.sessions.get(sessionId);
    if (!m) return Promise.reject(new Error('Session not found'));
    if (m.pub.state === 'ready') return Promise.resolve(this.snapshot(m));
    if (m.pub.state === 'failed' || m.pub.state === 'stopped' || m.pub.state === 'stopping') {
      return Promise.reject(new Error(m.pub.error?.message || `Session is ${m.pub.state}`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        m.readyWaiters = m.readyWaiters.filter(w => w !== waiter);
        reject(new Error('Timed out waiting for session readiness'));
      }, timeoutMs);
      const waiter = {
        resolve: () => { clearTimeout(timer); resolve(this.snapshot(m)); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      };
      m.readyWaiters.push(waiter);
    });
  }

  release(sessionId: string, consumerId: string): void {
    const m = this.sessions.get(sessionId);
    if (!m) {
      // Consumer may be waiting in the capacity queue.
      const idx = this.queue.findIndex(q => q.managed.pub.id === sessionId && q.consumerId === consumerId);
      if (idx >= 0) {
        const [entry] = this.queue.splice(idx, 1);
        entry.reject(new Error('Canceled while queued'));
      }
      return;
    }
    m.consumers.delete(consumerId);
    m.pub.lastUsedAt = nowIso();
    if (m.pub.state === 'queued') {
      const idx = this.queue.findIndex(q => q.managed === m && q.consumerId === consumerId);
      if (idx >= 0) {
        const [entry] = this.queue.splice(idx, 1);
        this.sessions.delete(m.pub.id);
        entry.reject(new Error('Canceled while queued'));
        this.emitSession(m, 'stopped');
      }
      return;
    }
    this.emitSession(m);
  }

  releaseAll(consumerId: string): void {
    for (const m of [...this.sessions.values()]) {
      if (m.consumers.has(consumerId)) this.release(m.pub.id, consumerId);
    }
    for (const q of [...this.queue]) {
      if (q.consumerId === consumerId) this.release(q.managed.pub.id, consumerId);
    }
  }

  pin(sessionId: string, pinned: boolean): PreviewSession | undefined {
    const m = this.sessions.get(sessionId);
    if (!m) return undefined;
    m.pub.pinned = pinned;
    this.emitSession(m);
    this.persist();
    return this.snapshot(m);
  }

  async stop(sessionId: string, reason = 'stopped by owner'): Promise<PreviewSession | undefined> {
    const m = this.sessions.get(sessionId);
    if (!m) return undefined;
    if (m.pub.external) {
      // External servers are never signalled; detaching just forgets the record.
      this.sessions.delete(sessionId);
      m.pub.state = 'stopped';
      m.pub.note = 'Detached external server (left running).';
      this.emitSession(m);
      this.drainQueue();
      return this.snapshot(m);
    }
    if (m.pub.state === 'stopped' || m.pub.state === 'stopping') return this.snapshot(m);
    if (m.pub.state === 'queued') {
      this.queue = this.queue.filter(q => {
        if (q.managed === m) { q.reject(new Error(reason)); return false; }
        return true;
      });
      this.sessions.delete(sessionId);
      m.pub.state = 'stopped';
      this.emitSession(m);
      return this.snapshot(m);
    }
    m.pub.state = 'stopping';
    m.pub.note = reason;
    this.emitSession(m);
    m.startupAbort?.();
    await this.killGroup(m);
    m.pub.state = 'stopped';
    m.consumers.clear();
    this.rejectWaiters(m, new Error(reason));
    this.emitSession(m);
    this.persist();
    this.drainQueue();
    return this.snapshot(m);
  }

  /** Stop and start again with the same plan and consumers. */
  async restart(sessionId: string, plan: PreviewPlan): Promise<PreviewSession | undefined> {
    const m = this.sessions.get(sessionId);
    if (!m) return undefined;
    const consumers = [...m.consumers];
    const pinned = m.pub.pinned;
    await this.stop(sessionId, 'restarting');
    this.sessions.delete(sessionId);
    let result: PreviewSession | undefined;
    for (const c of consumers.length ? consumers : ['restart']) {
      result = await this.acquire(plan, c, {});
    }
    if (result && pinned) this.pin(result.id, true);
    if (result && !consumers.length) this.release(result.id, 'restart');
    return result;
  }

  attachExternal(plan: PreviewPlan, url: string, consumerId: string): PreviewSession {
    const existing = this.findLive(plan.id);
    if (existing && existing.pub.external && existing.pub.url === url) {
      this.addConsumer(existing, consumerId);
      return this.snapshot(existing);
    }
    const m = this.newManaged(plan, 'ready');
    m.pub.external = true;
    m.pub.mode = 'external';
    m.pub.url = url;
    m.pub.readyAt = nowIso();
    m.pub.note = 'External server attached by the owner; qnav never stops it.';
    this.sessions.set(m.pub.id, m);
    this.addConsumer(m, consumerId);
    probeHttp(url, 3000).then(async status => { m.pub.httpStatus = status; m.pub.embedBlocked = (await probeEmbedBlock(url, 3000)) || undefined; this.emitSession(m); }).catch(err => {
      m.pub.error = { code: 'external-unreachable', message: `Could not reach ${url}: ${err?.message || err}` };
      this.emitSession(m);
    });
    return this.snapshot(m);
  }

  /** Remove failed/stopped sessions from the list. */
  forget(sessionId: string): void {
    const m = this.sessions.get(sessionId);
    if (m && (m.pub.state === 'failed' || m.pub.state === 'stopped')) {
      this.sessions.delete(sessionId);
      this.emitSession(m);
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.sweepTimer);
    for (const q of this.queue) q.reject(new Error('qnav shutting down'));
    this.queue = [];
    await Promise.all([...this.sessions.values()].filter(m => !m.pub.external).map(m => this.stop(m.pub.id, 'qnav shutting down')));
    await this.store.writeJson(this.persistFile, []);
  }

  /**
   * After a dashboard restart, previously recorded processes are unverified.
   * Only adopt a pid when its start time, process group and command line all
   * match the record; otherwise the record is discarded untouched.
   */
  async recover(): Promise<{ adopted: number; discarded: number }> {
    const records = (await this.store.readJson<PersistedSession[]>(this.persistFile)) || [];
    let adopted = 0, discarded = 0;
    for (const rec of records) {
      const ok = await this.verifyOwnership(rec);
      if (!ok) { discarded++; continue; }
      const stub: PreviewPlan = {
        id: rec.planId, name: rec.projectName, projectPath: rec.cwd, kind: 'folder', mode: 'managed',
        revision: rec.planRevision, entryUrlPath: '/', candidates: [], explanation: ['Recovered from a previous qnav run.'],
      };
      const m = this.newManaged(stub, 'starting');
      m.pub.id = rec.sessionId;
      m.pub.pid = rec.pid;
      m.pub.port = rec.port;
      m.pub.url = rec.url;
      m.pub.pinned = rec.pinned;
      m.pub.startedAt = rec.startedAt;
      m.pub.command = `${rec.command} ${rec.args.join(' ')}`;
      m.pub.note = 'Recovered: process verified as started by qnav.';
      this.sessions.set(m.pub.id, m);
      try {
        m.pub.httpStatus = await probeHttp(rec.url, 3000);
        m.pub.state = 'ready';
        m.pub.readyAt = nowIso();
        adopted++;
      } catch {
        // Owned but not answering: safe to terminate because ownership was verified.
        await this.killGroup(m);
        this.sessions.delete(m.pub.id);
        discarded++;
      }
    }
    await this.persist();
    return { adopted, discarded };
  }

  // ------------------------------------------------------------ internals

  private findLive(planId: string): Managed | undefined {
    for (const m of this.sessions.values()) {
      if (m.pub.planId === planId && (m.pub.state === 'queued' || m.pub.state === 'starting' || m.pub.state === 'ready')) return m;
    }
    return undefined;
  }

  private addConsumer(m: Managed, consumerId: string): void {
    m.consumers.add(consumerId);
    m.pub.lastUsedAt = nowIso();
    this.emitSession(m);
  }

  private newManaged(plan: PreviewPlan, state: SessionState): Managed {
    const id = `s_${Date.now().toString(36)}_${(++sessionCounter).toString(36)}`;
    return {
      pub: {
        id, planId: plan.id, planRevision: plan.revision, projectName: plan.name, mode: 'managed', state,
        consumers: [], pinned: false, external: false, startedAt: nowIso(), lastUsedAt: nowIso(),
      },
      plan, log: [], consumers: new Set(), exited: false, exitCode: null, readyWaiters: [],
    };
  }

  private snapshot(m: Managed): PreviewSession {
    return { ...m.pub, consumers: [...m.consumers] };
  }

  private emitSession(m: Managed, forcedState?: SessionState): void {
    const snap = this.snapshot(m);
    if (forcedState) snap.state = forcedState;
    this.emit('session', snap);
  }

  private emitLog(m: Managed, lines: string[]): void {
    this.emit('log', { sessionId: m.pub.id, lines });
  }

  private ownedRunning(): Managed[] {
    return [...this.sessions.values()].filter(m => !m.pub.external && (m.pub.state === 'starting' || m.pub.state === 'ready'));
  }

  private async startWithCapacity(m: Managed, consumerId: string, options: AcquireOptions): Promise<Managed> {
    const running = this.ownedRunning();
    if (running.length >= this.config.maxManagedSessions) {
      const evictable = running
        .filter(r => !r.pub.pinned && r.consumers.size === 0 && r.pub.state === 'ready')
        .sort((a, b) => Date.parse(a.pub.lastUsedAt) - Date.parse(b.pub.lastUsedAt));
      if (evictable.length && !options.noEvict) {
        await this.stop(evictable[0].pub.id, 'evicted (least recently used, no consumers)');
      } else {
        m.pub.queueInfo = { position: this.queue.length + 1, occupying: running.map(r => `${r.pub.projectName}${r.pub.pinned ? ' (pinned)' : ''}${r.consumers.size ? ' (in use)' : ''}`) };
        this.emitSession(m);
        return new Promise<Managed>((resolve, reject) => {
          const entry: QueueEntry = {
            managed: m, consumerId, noEvict: Boolean(options.noEvict),
            deadline: options.queueTimeoutMs ? Date.now() + options.queueTimeoutMs : null,
            resolve, reject,
          };
          this.queue.push(entry);
          if (entry.deadline) {
            setTimeout(() => {
              const idx = this.queue.indexOf(entry);
              if (idx >= 0) {
                this.queue.splice(idx, 1);
                m.pub.state = 'failed';
                m.pub.error = { code: 'capacity', message: `Gave up waiting for capacity: ${m.pub.queueInfo?.occupying.join(', ')}` };
                this.rejectWaiters(m, new Error(m.pub.error.message));
                this.emitSession(m);
                reject(new Error(m.pub.error.message));
              }
            }, options.queueTimeoutMs).unref();
          }
        });
      }
    }
    await this.launch(m);
    return m;
  }

  private drainQueue(): void {
    while (this.queue.length && this.ownedRunning().length < this.config.maxManagedSessions) {
      const entry = this.queue.shift()!;
      entry.managed.pub.queueInfo = undefined;
      this.launch(entry.managed).then(() => entry.resolve(entry.managed)).catch(entry.reject);
    }
    this.queue.forEach((q, i) => {
      q.managed.pub.queueInfo = { position: i + 1, occupying: this.ownedRunning().map(r => r.pub.projectName) };
      this.emitSession(q.managed);
    });
  }

  private reserved(): Set<number> {
    const set = new Set<number>();
    for (const m of this.sessions.values()) if (m.pub.port) set.add(m.pub.port);
    return set;
  }

  private async launch(m: Managed): Promise<void> {
    const plan = m.plan;
    const launch = plan.launch!;
    m.pub.state = 'starting';
    m.pub.startedAt = nowIso();
    m.pub.error = undefined;
    this.emitSession(m);

    const port = await findFreePort(this.config.managedPortRangeStart, this.config.managedPortRangeEnd, this.reserved());
    if (!port) {
      return this.fail(m, { code: 'no-port', message: `No free port in ${this.config.managedPortRangeStart}-${this.config.managedPortRangeEnd}.` });
    }
    m.pub.port = port;
    const { command, args, env } = applyPort(launch, port);
    m.pub.command = `${command} ${args.join(' ')}`;
    m.pub.url = `http://127.0.0.1:${port}${launch.entryUrlPath || '/'}`;
    this.pushLog(m, [`$ ${m.pub.command}`, `  (cwd ${launch.cwd}, PORT=${port})`]);

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: launch.cwd,
        env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none', CI: process.env.CI || '' },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      return this.fail(m, { code: 'spawn-failed', message: `Could not start "${command}": ${err?.message || err}` });
    }
    m.child = child;
    m.pub.pid = child.pid;
    const onData = (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').replace(ANSI, '').split(/\r?\n/).filter(l => l.trim().length);
      if (lines.length) this.pushLog(m, lines);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const exitPromise = new Promise<number | null>(resolve => {
      child.once('error', (err) => { this.pushLog(m, [`spawn error: ${err.message}`]); m.exited = true; resolve(null); });
      child.once('exit', (code) => { m.exited = true; m.exitCode = code; resolve(code); });
    });
    exitPromise.then(code => {
      if (m.pub.state === 'ready') {
        m.pub.state = 'stopped';
        m.pub.error = { code: 'exited', message: `Process exited (${code ?? 'signal'}) while running.`, detail: m.log.slice(-15).join('\n') };
        this.emitSession(m);
        this.persist();
        this.drainQueue();
      }
    });

    // ---- readiness: bounded HTTP polling, watching for early exit ----
    const deadline = Date.now() + this.config.startupDeadlineMs;
    let aborted = false;
    m.startupAbort = () => { aborted = true; };
    let adoptedPort: number | null = null;
    while (!aborted) {
      if (m.exited) {
        const tail = m.log.slice(-20).join('\n');
        const conflict = /EADDRINUSE|address already in use|port .* is (already )?in use/i.test(tail);
        return this.fail(m, {
          code: conflict ? 'port-conflict' : 'early-exit',
          message: conflict ? `Port ${port} was taken before the server could bind.` : `Process exited with code ${m.exitCode ?? 'signal'} before answering HTTP.`,
          detail: tail,
        });
      }
      if (Date.now() > deadline) {
        await this.killGroup(m);
        return this.fail(m, { code: 'startup-timeout', message: `No HTTP response within ${Math.round(this.config.startupDeadlineMs / 1000)}s.`, detail: m.log.slice(-20).join('\n') });
      }
      try {
        m.pub.httpStatus = await probeHttp(m.pub.url!, 2500);
        break;
      } catch {
        // Frameworks that silently move to another port announce it in the log.
        const mentioned = this.portFromLog(m);
        if (mentioned && mentioned !== port && !adoptedPort) {
          try {
            const url = `http://127.0.0.1:${mentioned}${launch.entryUrlPath || '/'}`;
            m.pub.httpStatus = await probeHttp(url, 1500);
            adoptedPort = mentioned;
            m.pub.port = mentioned;
            m.pub.url = url;
            m.pub.note = `Server bound port ${mentioned} instead of the assigned ${port}; using what it announced.`;
            break;
          } catch { /* keep polling */ }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (aborted) return;
    m.startupAbort = undefined;
    m.pub.state = 'ready';
    m.pub.readyAt = nowIso();
    m.pub.lastUsedAt = nowIso();
    this.pushLog(m, [`ready: ${m.pub.url} (HTTP ${m.pub.httpStatus})`]);
    m.pub.embedBlocked = (await probeEmbedBlock(m.pub.url!, 3000)) || undefined;
    if (m.pub.embedBlocked) this.pushLog(m, [`note: page refuses embedding (${m.pub.embedBlocked}); use Open in new tab`]);
    for (const w of m.readyWaiters.splice(0)) w.resolve();
    this.emitSession(m);
    await this.persist();
  }

  private portFromLog(m: Managed): number | null {
    for (let i = m.log.length - 1; i >= Math.max(0, m.log.length - 40); i--) {
      const match = m.log[i].match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  private fail(m: Managed, error: SessionError): void {
    m.pub.state = 'failed';
    m.pub.error = error;
    m.startupAbort = undefined;
    this.pushLog(m, [`failed: ${error.message}`]);
    this.rejectWaiters(m, new Error(error.message));
    this.emitSession(m);
    this.persist();
    this.drainQueue();
  }

  private rejectWaiters(m: Managed, err: Error): void {
    for (const w of m.readyWaiters.splice(0)) w.reject(err);
  }

  private pushLog(m: Managed, lines: string[]): void {
    m.log.push(...lines);
    if (m.log.length > this.config.logLines) m.log.splice(0, m.log.length - this.config.logLines);
    this.emitLog(m, lines);
  }

  /** Terminate the owned process group (leader + descendants). */
  private async killGroup(m: Managed): Promise<void> {
    const pid = m.pub.pid;
    if (!pid) return;
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    if (!alive() && m.exited) return;
    const signal = (sig: NodeJS.Signals) => { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* gone */ } } };
    signal('SIGTERM');
    const waitExit = (ms: number) => new Promise<boolean>(resolve => {
      const start = Date.now();
      const tick = () => {
        if (!alive()) return resolve(true);
        if (Date.now() - start > ms) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
    if (!(await waitExit(4000))) {
      signal('SIGKILL');
      await waitExit(2000);
    }
    m.exited = true;
  }

  private async verifyOwnership(rec: PersistedSession): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'pgid=,lstart=,command=', '-p', String(rec.pid)]);
      const line = stdout.trim();
      if (!line) return false;
      const match = line.match(/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/);
      if (!match) return false;
      const [, pgid, lstart, command] = match;
      if (parseInt(pgid, 10) !== rec.pid) return false; // must be its own group leader (we spawned detached)
      const started = Date.parse(lstart);
      if (!Number.isFinite(started) || Math.abs(started - Date.parse(rec.startedAt)) > 15 * 1000) return false;
      const base = rec.command.split('/').pop() || rec.command;
      if (!command.includes(base) && !command.includes(String(rec.port))) return false;
      return true;
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    const records: PersistedSession[] = [];
    for (const m of this.sessions.values()) {
      if (m.pub.external || m.pub.state !== 'ready' || !m.pub.pid || !m.pub.port || !m.plan.launch) continue;
      const { command, args } = applyPort(m.plan.launch, m.pub.port);
      records.push({
        sessionId: m.pub.id, planId: m.pub.planId, planRevision: m.pub.planRevision, projectName: m.pub.projectName,
        pid: m.pub.pid, port: m.pub.port, url: m.pub.url!, cwd: m.plan.launch.cwd, command, args,
        startedAt: m.pub.startedAt, pinned: m.pub.pinned,
      });
    }
    await this.store.writeJson(this.persistFile, records);
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const m of [...this.sessions.values()]) {
      const idle = now - Date.parse(m.pub.lastUsedAt) > this.config.idleTimeoutMs;
      if (m.pub.external) continue;
      if (m.pub.state === 'ready' && !m.pub.pinned && m.consumers.size === 0 && idle) {
        await this.stop(m.pub.id, 'idle timeout');
      } else if ((m.pub.state === 'failed' || m.pub.state === 'stopped') && m.consumers.size === 0 && idle) {
        this.sessions.delete(m.pub.id);
      }
    }
    // Sanity: a port we think is ours should not be free while the session says ready.
    for (const m of this.sessions.values()) {
      if (m.pub.state === 'ready' && m.pub.port && m.exited) {
        if (await isPortFree(m.pub.port)) {
          m.pub.state = 'stopped';
          m.pub.error = { code: 'exited', message: 'Process is gone.' };
          this.emitSession(m);
        }
      }
    }
  }
}
