import * as path from 'path';
import { EventEmitter } from 'events';
import { EnrichedProjectMetadata } from '../enrichedMetadata';
import { canonicalPath, shortHash } from './identity';
import { DataStore } from './dataStore';
import { PreviewConfig } from './previewConfig';
import { StaticListenerPool } from './staticAdapter';
import { ProcessManager } from './processManager';
import { findEntryCandidates, selectEntry } from './entryResolver';
import { planLaunch } from './launchPlanner';
import { AcquireOptions, PreviewOverrides, PreviewPlan, PreviewSession } from './types';

export class PreviewUnavailableError extends Error {
  constructor(public plan: PreviewPlan) {
    super(plan.reason || `Preview unavailable (${plan.mode})`);
  }
}

interface StaticSession {
  pub: PreviewSession;
  consumers: Set<string>;
  servingRoot: string;
}

export interface AcquireResult {
  plan: PreviewPlan;
  session: PreviewSession;
}

/**
 * The shared preview service: the one boundary that the flipper, thumbnails
 * and the capture worker all go through.
 *
 *   resolvePreview(projectId)              -> PreviewPlan
 *   acquirePreview(projectId, consumerId)  -> { plan, session }
 *   releasePreview(sessionId, consumerId)
 *   stopPreview(sessionId)
 *   subscribePreview(listener)             -> unsubscribe
 */
export class PreviewService extends EventEmitter {
  readonly statics = new Map<string, StaticSession>();
  readonly pool: StaticListenerPool;
  readonly manager: ProcessManager;
  private staticCounter = 0;

  constructor(
    readonly config: PreviewConfig,
    readonly store: DataStore,
    private getProject: (id: string) => EnrichedProjectMetadata | undefined,
    private getScanRoot: () => string,
  ) {
    super();
    this.pool = new StaticListenerPool({ maxListeners: config.maxStaticListeners, idleTimeoutMs: config.staticIdleTimeoutMs });
    this.manager = new ProcessManager(config, store);
    this.manager.on('session', (s: PreviewSession) => this.emit('session', s));
    this.manager.on('log', (payload) => this.emit('log', payload));
  }

  async init(): Promise<void> {
    const { adopted, discarded } = await this.manager.recover();
    if (adopted || discarded) console.log(`♻️  Preview sessions recovered: ${adopted} adopted, ${discarded} discarded`);
  }

  subscribePreview(listener: (session: PreviewSession) => void): () => void {
    this.on('session', listener);
    return () => this.off('session', listener);
  }

  // ------------------------------------------------------------ plans

  async resolvePreview(projectId: string): Promise<PreviewPlan> {
    const project = this.getProject(projectId);
    if (!project) {
      return this.plan(projectId, 'Unknown', '', 'folder', { mode: 'unsupported', reason: 'Project is no longer in the catalog.', entryUrlPath: '/', candidates: [], explanation: [] });
    }
    const overrides = this.store.getOverrides(projectId);
    const projectPath = canonicalPath(project.path);
    const name = project.name;

    if (overrides?.mode === 'external' && overrides.externalUrl) {
      return this.plan(projectId, name, projectPath, project.kind || 'folder', {
        mode: 'external', externalUrl: overrides.externalUrl, entryUrlPath: '/', candidates: [],
        explanation: [`Attached external server ${overrides.externalUrl} (saved by the owner). qnav never stops it.`], overrides,
      });
    }

    if (project.kind === 'file') {
      const base = path.basename(projectPath);
      if (!/\.html?$/i.test(base)) {
        return this.plan(projectId, name, projectPath, 'file', {
          mode: 'unsupported', reason: `Loose ${path.extname(base) || 'file'} is source, not a web page.`, entryUrlPath: '/', candidates: [],
          explanation: ['Only loose HTML files can be opened directly.'], overrides,
        });
      }
      const servingRoot = path.dirname(projectPath);
      const urlPath = '/' + encodeURIComponent(base);
      return this.plan(projectId, name, projectPath, 'file', {
        mode: 'static', servingRoot, entryRelPath: base, entryUrlPath: urlPath,
        candidates: [{ relPath: base, servingRoot, urlPath, kind: 'loose-file', label: base, score: 100, isBuild: false }],
        explanation: [`Loose HTML file; served from ${servingRoot} so sibling assets resolve.`], overrides,
      });
    }

    // ---- folder ----
    const launchResult = await planLaunch(projectPath, overrides);
    const candidates = await findEntryCandidates(projectPath, launchResult.hasBundler);
    const selection = selectEntry(candidates, overrides?.entryRelPath);
    const explanation: string[] = [];
    const common = {
      candidates, overrides,
      launchStatus: launchResult.status, launchReason: launchResult.reason, launchRequirements: launchResult.requirements,
      staticAvailable: Boolean(selection.chosen), managedAvailable: launchResult.status === 'ok',
      readinessSelector: overrides?.readinessSelector, settleMs: overrides?.settleMs,
    };

    const staticPlan = () => {
      const c = selection.chosen!;
      explanation.push(...selection.explanation);
      if (launchResult.status === 'ok') explanation.push('A managed dev server is also available (switch mode in details).');
      return this.plan(projectId, name, projectPath, 'folder', {
        ...common, mode: 'static', servingRoot: c.servingRoot, entryRelPath: c.relPath, entryUrlPath: c.urlPath,
        buildInfo: c.isBuild ? { path: c.relPath, mtime: c.mtime || '' } : undefined, explanation,
      });
    };
    const managedPlan = () => {
      explanation.push(...launchResult.evidence);
      if (selection.chosen) explanation.push(`A static entry (${selection.chosen.relPath}) is also available.`);
      return this.plan(projectId, name, projectPath, 'folder', {
        ...common, mode: 'managed', launch: launchResult.launch, entryUrlPath: launchResult.launch!.entryUrlPath, explanation,
      });
    };

    if (overrides?.mode === 'managed' || overrides?.commandLine) {
      if (launchResult.status === 'ok') return managedPlan();
      explanation.push('Managed mode was requested but the launch plan is not ready.');
    }
    if (overrides?.mode === 'static' && selection.chosen) return staticPlan();

    if (selection.chosen && !launchResult.hasBundler) return staticPlan();
    if (launchResult.status === 'ok') return managedPlan();
    if (selection.chosen) return staticPlan();
    if (selection.needsChoice) {
      explanation.push(...selection.explanation);
      return this.plan(projectId, name, projectPath, 'folder', { ...common, mode: 'choose-entry', entryUrlPath: '/', reason: 'Several plausible entry points; pick one.', explanation });
    }
    if (launchResult.status === 'setup-required' || launchResult.status === 'ambiguous') {
      explanation.push(...launchResult.evidence, ...selection.explanation);
      return this.plan(projectId, name, projectPath, 'folder', {
        ...common, mode: 'setup-required', entryUrlPath: '/', reason: launchResult.reason,
        requirements: launchResult.requirements, suggestedCommandLine: launchResult.suggestedCommandLine, launch: launchResult.launch, explanation,
      });
    }
    explanation.push(...launchResult.evidence, ...selection.explanation);
    return this.plan(projectId, name, projectPath, 'folder', { ...common, mode: 'unsupported', entryUrlPath: '/', reason: launchResult.reason || 'No HTML entry point or runnable dev server found.', explanation });
  }

  private plan(id: string, name: string, projectPath: string, kind: 'folder' | 'file', fields: Omit<PreviewPlan, 'id' | 'name' | 'projectPath' | 'kind' | 'revision'>): PreviewPlan {
    const launch = fields.launch;
    const revision = shortHash(JSON.stringify([
      fields.mode, fields.servingRoot, fields.entryRelPath, fields.externalUrl,
      launch && [launch.cwd, launch.command, launch.args, launch.portMode, launch.env],
      fields.overrides?.revision || 0,
    ]));
    return { id, name, projectPath, kind, revision, ...fields };
  }

  // ------------------------------------------------------------ sessions

  async acquirePreview(projectId: string, consumerId: string, options: AcquireOptions = {}): Promise<AcquireResult> {
    const plan = await this.resolvePreview(projectId);
    switch (plan.mode) {
      case 'static':
        return { plan, session: await this.acquireStatic(plan, consumerId) };
      case 'managed':
        return { plan, session: await this.manager.acquire(plan, consumerId, options) };
      case 'external':
        return { plan, session: this.manager.attachExternal(plan, plan.externalUrl!, consumerId) };
      default:
        throw new PreviewUnavailableError(plan);
    }
  }

  /** Wait for a managed session; static and external sessions are ready immediately. */
  async waitReady(session: PreviewSession, timeoutMs: number): Promise<PreviewSession> {
    if (session.mode === 'managed' && !session.external) return this.manager.waitReady(session.id, timeoutMs);
    return session;
  }

  releasePreview(sessionId: string, consumerId: string): void {
    const st = this.statics.get(sessionId);
    if (st) {
      st.consumers.delete(consumerId);
      st.pub.lastUsedAt = new Date().toISOString();
      if (st.consumers.size === 0) {
        this.statics.delete(sessionId);
        this.pool.release(st.servingRoot, sessionId);
        st.pub.state = 'stopped';
      }
      this.emit('session', { ...st.pub, consumers: [...st.consumers] });
      return;
    }
    this.manager.release(sessionId, consumerId);
  }

  releaseAll(consumerId: string): void {
    for (const st of [...this.statics.values()]) {
      if (st.consumers.has(consumerId)) this.releasePreview(st.pub.id, consumerId);
    }
    this.manager.releaseAll(consumerId);
  }

  async stopPreview(sessionId: string): Promise<PreviewSession | undefined> {
    const st = this.statics.get(sessionId);
    if (st) {
      this.statics.delete(sessionId);
      this.pool.release(st.servingRoot, sessionId);
      st.pub.state = 'stopped';
      st.pub.consumers = [];
      this.emit('session', st.pub);
      return st.pub;
    }
    return this.manager.stop(sessionId);
  }

  async restartPreview(sessionId: string): Promise<PreviewSession | undefined> {
    const managed = this.manager.get(sessionId);
    if (!managed) return undefined;
    const plan = await this.resolvePreview(managed.planId);
    if (plan.mode !== 'managed') throw new PreviewUnavailableError(plan);
    return this.manager.restart(sessionId, plan);
  }

  listSessions(): PreviewSession[] {
    return [...[...this.statics.values()].map(s => ({ ...s.pub, consumers: [...s.consumers] })), ...this.manager.list()];
  }

  getSession(sessionId: string): PreviewSession | undefined {
    const st = this.statics.get(sessionId);
    if (st) return { ...st.pub, consumers: [...st.consumers] };
    return this.manager.get(sessionId);
  }

  async saveOverrides(projectId: string, patch: Partial<PreviewOverrides>): Promise<PreviewOverrides> {
    return this.store.setOverrides(projectId, patch);
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdown();
    await this.pool.closeAll();
  }

  private async acquireStatic(plan: PreviewPlan, consumerId: string): Promise<PreviewSession> {
    for (const st of this.statics.values()) {
      if (st.pub.planId === plan.id && st.pub.planRevision === plan.revision) {
        st.consumers.add(consumerId);
        st.pub.lastUsedAt = new Date().toISOString();
        return { ...st.pub, consumers: [...st.consumers] };
      }
    }
    const id = `st_${Date.now().toString(36)}_${(++this.staticCounter).toString(36)}`;
    const listener = await this.pool.acquire(plan.servingRoot!, id);
    const pub: PreviewSession = {
      id, planId: plan.id, planRevision: plan.revision, projectName: plan.name, mode: 'static', state: 'ready',
      url: `${listener.origin}${plan.entryUrlPath}`, port: listener.port, consumers: [], pinned: false, external: false,
      startedAt: new Date().toISOString(), readyAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(),
      note: plan.buildInfo ? `Existing build output (${plan.buildInfo.path}, modified ${plan.buildInfo.mtime}); may not reflect current source.` : undefined,
    };
    const st: StaticSession = { pub, consumers: new Set([consumerId]), servingRoot: plan.servingRoot! };
    this.statics.set(id, st);
    this.emit('session', { ...pub, consumers: [consumerId] });
    return { ...pub, consumers: [consumerId] };
  }
}
