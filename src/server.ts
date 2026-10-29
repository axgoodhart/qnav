import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import cors from 'cors';
import * as path from 'path';
import { FileWatcher } from './watcher';
import { ConfigManager } from './config';
import { ProjectMetadata, ProjectCategory } from './metadataDetector';
import { EnrichedProjectMetadata, ProjectMaturity } from './enrichedMetadata';
import { computeRelationships, RelatedProject } from './relationshipAnalyzer';
import { flattenTags } from './tagDetector';
import { resolvePreviewConfig } from './preview/previewConfig';
import { DataStore } from './preview/dataStore';
import { PreviewService, PreviewUnavailableError } from './preview/previewService';
import { PreviewSession } from './preview/types';
import { CaptureWorker } from './preview/captureWorker';
import { ProfileService } from './profiles';

/**
 * Advanced query filter for project search
 */
export interface QueryFilter {
  textQuery?: string;              // Free text search across name, description, tech
  techStack?: string[];            // Any of these technologies
  categories?: ProjectCategory[];   // Any of these categories
  states?: string[];               // Any of these states
  maturity?: ProjectMaturity[];    // Any of these maturity levels
  mustHaveTech?: string[];         // All of these technologies (AND)
  excludeTech?: string[];          // None of these technologies
  minFiles?: number;               // Minimum file count
  maxFiles?: number;               // Maximum file count
  modifiedWithinDays?: number;     // Modified within N days
  activityLevel?: 'active' | 'moderate' | 'dormant';  // Activity-based filter
  sortBy?: 'name' | 'modified' | 'fileCount';
  order?: 'asc' | 'desc';
  // Semantic tag filters
  tags?: string[];                 // Any of these tags (format: "category:tag")
  mustHaveTags?: string[];         // All of these tags (AND)
  excludeTags?: string[];          // None of these tags
  tagCategories?: string[];        // Filter by tag categories (purpose, domain, etc.)
}

/**
 * Facet counts for filter dimensions
 */
export interface FacetCounts {
  techStack: Record<string, number>;
  categories: Record<string, number>;
  states: Record<string, number>;
  maturity: Record<string, number>;
  activityLevel: Record<string, number>;
  tags: Record<string, number>;           // Semantic tag counts
  tagCategories: Record<string, number>;  // Tag category counts
}

class CufolioServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private watcher: FileWatcher | null = null;
  private config: ConfigManager;
  private projects: EnrichedProjectMetadata[] = [];
  private preview!: PreviewService;
  private captures!: CaptureWorker;
  private dataStore!: DataStore;
  private profiles!: ProfileService;
  /** WebSocket connection -> consumer ids registered by that browser tab. */
  private wsConsumers = new Map<WebSocket, Set<string>>();

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.config = new ConfigManager();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupPreviewRoutes(): void {
    const app = this.app;
    const preview = this.preview;
    const sendError = (res: express.Response, err: any) => {
      if (err instanceof PreviewUnavailableError) {
        return res.status(409).json({ error: err.message, plan: err.plan });
      }
      res.status(500).json({ error: err?.message || String(err) });
    };

    app.get('/api/preview/config', (req, res) => res.json(preview.config));

    app.get('/api/preview/plan/:id', async (req, res) => {
      try { res.json(await preview.resolvePreview(req.params.id)); } catch (err) { sendError(res, err); }
    });

    app.post('/api/preview/acquire', async (req, res) => {
      const { projectId, consumerId, entryRelPath } = req.body || {};
      if (!projectId || !consumerId) return res.status(400).json({ error: 'projectId and consumerId are required' });
      try {
        const result = await preview.acquirePreview(projectId, consumerId, typeof entryRelPath === 'string' && entryRelPath ? { entryRelPath } : {});
        res.json(result);
      } catch (err) { sendError(res, err); }
    });

    app.get('/api/preview/files/:id', async (req, res) => {
      try {
        res.json(await preview.listHtmlFiles(req.params.id));
      } catch (err: any) {
        const status = err?.message === 'Project not found' ? 404 : 500;
        res.status(status).json({ error: err?.message || String(err) });
      }
    });

    app.post('/api/preview/release', (req, res) => {
      const { sessionId, consumerId } = req.body || {};
      if (sessionId && consumerId) preview.releasePreview(sessionId, consumerId);
      res.json({ ok: true });
    });

    app.post('/api/preview/stop', async (req, res) => {
      try { res.json({ session: await preview.stopPreview(req.body?.sessionId) }); } catch (err) { sendError(res, err); }
    });

    app.post('/api/preview/restart', async (req, res) => {
      try { res.json({ session: await preview.restartPreview(req.body?.sessionId) }); } catch (err) { sendError(res, err); }
    });

    app.post('/api/preview/pin', (req, res) => {
      res.json({ session: preview.manager.pin(req.body?.sessionId, Boolean(req.body?.pinned)) });
    });

    app.post('/api/preview/forget', (req, res) => {
      preview.manager.forget(req.body?.sessionId);
      res.json({ ok: true });
    });

    app.post('/api/preview/attach', async (req, res) => {
      const { projectId, url } = req.body || {};
      if (!projectId || !/^https?:\/\//.test(url || '')) return res.status(400).json({ error: 'projectId and an http(s) url are required' });
      try {
        await preview.saveOverrides(projectId, { mode: 'external', externalUrl: url });
        res.json({ plan: await preview.resolvePreview(projectId) });
      } catch (err) { sendError(res, err); }
    });

    app.get('/api/preview/sessions', (req, res) => res.json({ sessions: preview.listSessions(), listeners: preview.pool.list() }));

    app.get('/api/preview/log/:sessionId', (req, res) => res.json({ lines: preview.manager.logs(req.params.sessionId) }));

    app.get('/api/preview/overrides/:id', (req, res) => res.json(preview.store.getOverrides(req.params.id) || null));

    app.put('/api/preview/overrides/:id', async (req, res) => {
      try {
        const allowed = ['entryRelPath', 'mode', 'commandLine', 'commandCwd', 'externalUrl', 'readinessSelector', 'settleMs'];
        const patch: any = {};
        for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key];
        const saved = await preview.saveOverrides(req.params.id, patch);
        res.json({ overrides: saved, plan: await preview.resolvePreview(req.params.id) });
      } catch (err) { sendError(res, err); }
    });

    app.delete('/api/preview/overrides/:id', async (req, res) => {
      await preview.store.clearOverrides(req.params.id);
      res.json({ plan: await preview.resolvePreview(req.params.id) });
    });
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    // Serve frontend from public folder
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  private setupRoutes(): void {
    // Get all projects
    this.app.get('/api/projects', (req, res) => {
      res.json(this.projects);
    });

    this.app.get('/api/profiles', (req, res) => {
      res.json({ ...this.profiles.status(), profiles: Object.fromEntries(this.projects.filter(p => p.profile).map(p => [p.path, p.profile])) });
    });
    this.app.post('/api/profiles/control', async (req, res) => {
      if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
      try { await this.profiles.setEnabled(req.body.enabled); res.json(this.profiles.status()); }
      catch (err: any) { res.status(500).json({ error: err.message }); }
    });
    this.app.post('/api/profiles/prioritize', (req, res) => {
      if (typeof req.body?.id !== 'string' || !this.projects.some(p => p.id === req.body.id)) return res.status(404).json({ error: 'Project not found' });
      this.profiles.prioritize(req.body.id);
      res.json(this.profiles.status());
    });

    this.app.get('/api/profiles/readings', (req, res) => {
      res.json({ readings: this.profiles.readings() });
    });

    this.app.put('/api/profiles/settings', async (req, res) => {
      try {
        res.json({ settings: await this.profiles.updateSettings(req.body || {}) });
      } catch (err: any) { res.status(400).json({ error: err?.message || String(err) }); }
    });

    this.app.post('/api/profiles/analyze', async (req, res) => {
      if (typeof req.body?.id !== 'string' || !this.projects.some(p => p.id === req.body.id)) return res.status(404).json({ error: 'Project not found' });
      try {
        await this.profiles.analyzeNow(req.body.id);
        res.json(this.profiles.status());
      } catch (err: any) { res.status(500).json({ error: err?.message || String(err) }); }
    });

    // Get configuration
    this.app.get('/api/config', (req, res) => {
      res.json(this.config.get());
    });

    // Update configuration
    this.app.post('/api/config', async (req, res) => {
      try {
        this.config.update(req.body);
        await this.config.save();

        // Restart watcher with new config
        if (this.watcher) {
          await this.watcher.stop();
        }
        await this.startWatcher();

        res.json({ success: true, config: this.config.get() });
      } catch (error) {
        res.status(500).json({ error: 'Failed to update configuration' });
      }
    });

    // Trigger manual rescan
    this.app.post('/api/rescan', async (req, res) => {
      try {
        console.log('🔄 Manual rescan triggered');
        if (this.watcher) {
          await this.watcher.stop();
        }
        await this.startWatcher();
        res.json({ success: true, projectCount: this.projects.length });
      } catch (error) {
        res.status(500).json({ error: 'Failed to rescan' });
      }
    });

    // Serve media files (screenshots, images, videos)
    this.app.get('/api/media/:project/:file(*)', (req, res) => {
      const config = this.config.get();
      const filePath = path.join(config.scanPath, req.params.project, req.params.file);

      // Security: ensure the file is within the scan path
      const realPath = path.resolve(filePath);
      const basePath = path.resolve(config.scanPath);

      if (!realPath.startsWith(basePath)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.sendFile(realPath, (err) => {
        if (err) {
          res.status(404).json({ error: 'File not found' });
        }
      });
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        projectCount: this.projects.length,
        watching: this.watcher !== null
      });
    });

    // Advanced project search with filtering
    this.app.post('/api/projects/search', (req, res) => {
      try {
        const filter: QueryFilter = req.body;
        const results = this.searchProjects(filter);
        res.json({
          results,
          total: results.length,
          filter
        });
      } catch (error) {
        res.status(400).json({ error: 'Invalid search query' });
      }
    });

    // Get facet counts for filtering
    this.app.get('/api/facets', (req, res) => {
      const facets = this.computeFacets();
      res.json(facets);
    });

    // Get related projects for a specific project
    this.app.get('/api/projects/:id/related', (req, res) => {
      const id = decodeURIComponent(req.params.id);

      // Find project by name or path
      const project = this.projects.find(p =>
        p.name === id ||
        p.path === id ||
        p.name.toLowerCase() === id.toLowerCase()
      );

      if (!project) {
        return res.status(404).json({
          error: 'Project not found',
          id
        });
      }

      const related = computeRelationships(project, this.projects);

      res.json({
        project: project.name,
        related
      });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('🔌 WebSocket client connected');

      // Send current projects immediately
      ws.send(JSON.stringify({
        type: 'projects',
        data: this.projects
      }));

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg?.type === 'consumer' && typeof msg.id === 'string') {
            if (!this.wsConsumers.has(ws)) this.wsConsumers.set(ws, new Set());
            this.wsConsumers.get(ws)!.add(msg.id);
          }
        } catch { /* ignore malformed */ }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        // A tab that vanished can no longer release what it acquired.
        const ids = this.wsConsumers.get(ws);
        if (ids && this.preview) for (const id of ids) this.preview.releaseAll(id);
        this.wsConsumers.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  /**
   * Calculate activity level based on recent file changes
   * - active: changes within last 7 days
   * - moderate: changes within 7-30 days
   * - dormant: no changes in 30+ days
   */
  private getActivityLevel(project: EnrichedProjectMetadata): 'active' | 'moderate' | 'dormant' {
    if (!project.lastModified) return 'dormant';

    const now = Date.now();
    const lastModifiedMs = new Date(project.lastModified).getTime();
    const daysSinceModified = (now - lastModifiedMs) / (24 * 60 * 60 * 1000);

    if (daysSinceModified <= 7) return 'active';
    if (daysSinceModified <= 30) return 'moderate';
    return 'dormant';
  }

  /**
   * Search projects with advanced filtering
   */
  private searchProjects(filter: QueryFilter): EnrichedProjectMetadata[] {
    let results = [...this.projects];

    // Text search across name, description, tech
    if (filter.textQuery) {
      const query = filter.textQuery.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.desc.toLowerCase().includes(query) ||
        p.tech.some(t => t.toLowerCase().includes(query)) ||
        (p.profile?.tags.some(t => t.label.includes(query) || t.label.replace(/-/g, ' ').includes(query)) ?? false)
      );
    }

    // Tech stack filter (any of these - OR)
    if (filter.techStack && filter.techStack.length > 0) {
      const techLower = filter.techStack.map(t => t.toLowerCase());
      results = results.filter(p =>
        p.tech.some(t => techLower.includes(t.toLowerCase()))
      );
    }

    // Must have tech (all of these - AND)
    if (filter.mustHaveTech && filter.mustHaveTech.length > 0) {
      const mustHaveLower = filter.mustHaveTech.map(t => t.toLowerCase());
      results = results.filter(p => {
        const projectTechLower = p.tech.map(t => t.toLowerCase());
        return mustHaveLower.every(t => projectTechLower.includes(t));
      });
    }

    // Exclude tech (none of these)
    if (filter.excludeTech && filter.excludeTech.length > 0) {
      const excludeLower = filter.excludeTech.map(t => t.toLowerCase());
      results = results.filter(p =>
        !p.tech.some(t => excludeLower.includes(t.toLowerCase()))
      );
    }

    // Category filter
    if (filter.categories && filter.categories.length > 0) {
      results = results.filter(p => filter.categories!.includes(p.category));
    }

    // State filter
    if (filter.states && filter.states.length > 0) {
      results = results.filter(p => filter.states!.includes(p.state));
    }

    // Maturity filter
    if (filter.maturity && filter.maturity.length > 0) {
      results = results.filter(p =>
        p.maturity && filter.maturity!.includes(p.maturity.classification)
      );
    }

    // File count range filters
    if (filter.minFiles !== undefined) {
      results = results.filter(p => (p.fileCount || 0) >= filter.minFiles!);
    }
    if (filter.maxFiles !== undefined) {
      results = results.filter(p => (p.fileCount || 0) <= filter.maxFiles!);
    }

    // Modified within N days
    if (filter.modifiedWithinDays !== undefined) {
      const cutoff = Date.now() - (filter.modifiedWithinDays * 24 * 60 * 60 * 1000);
      results = results.filter(p => {
        if (!p.lastModified) return false;
        return new Date(p.lastModified).getTime() >= cutoff;
      });
    }

    // Activity level filter
    if (filter.activityLevel) {
      results = results.filter(p => this.getActivityLevel(p) === filter.activityLevel);
    }

    // Semantic tag filters
    if (filter.tags && filter.tags.length > 0) {
      const tagsLower = filter.tags.map(t => t.toLowerCase());
      results = results.filter(p => {
        if (!p.semanticTags) return false;
        const projectTags = flattenTags(p.semanticTags).map(t => t.toLowerCase());
        return tagsLower.some(t => projectTags.includes(t));
      });
    }

    if (filter.mustHaveTags && filter.mustHaveTags.length > 0) {
      const mustHaveLower = filter.mustHaveTags.map(t => t.toLowerCase());
      results = results.filter(p => {
        if (!p.semanticTags) return false;
        const projectTags = flattenTags(p.semanticTags).map(t => t.toLowerCase());
        return mustHaveLower.every(t => projectTags.includes(t));
      });
    }

    if (filter.excludeTags && filter.excludeTags.length > 0) {
      const excludeLower = filter.excludeTags.map(t => t.toLowerCase());
      results = results.filter(p => {
        if (!p.semanticTags) return true;
        const projectTags = flattenTags(p.semanticTags).map(t => t.toLowerCase());
        return !excludeLower.some(t => projectTags.includes(t));
      });
    }

    if (filter.tagCategories && filter.tagCategories.length > 0) {
      const categoriesLower = filter.tagCategories.map(c => c.toLowerCase());
      results = results.filter(p => {
        if (!p.semanticTags) return false;
        const projectTagCategories = Object.keys(p.semanticTags).map(c => c.toLowerCase());
        return categoriesLower.some(c => projectTagCategories.includes(c));
      });
    }

    // Sorting
    if (filter.sortBy) {
      const order = filter.order === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        switch (filter.sortBy) {
          case 'name':
            return order * a.name.localeCompare(b.name);
          case 'modified':
            const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
            const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
            return order * (aTime - bTime);
          case 'fileCount':
            return order * ((a.fileCount || 0) - (b.fileCount || 0));
          default:
            return 0;
        }
      });
    }

    return results;
  }

  /**
   * Compute facet counts for all filter dimensions
   */
  private computeFacets(): FacetCounts {
    const facets: FacetCounts = {
      techStack: {},
      categories: {},
      states: {},
      maturity: {},
      activityLevel: { active: 0, moderate: 0, dormant: 0 },
      tags: {},
      tagCategories: {}
    };

    for (const project of this.projects) {
      // Tech stack counts
      for (const tech of project.tech) {
        facets.techStack[tech] = (facets.techStack[tech] || 0) + 1;
      }

      // Category counts
      facets.categories[project.category] = (facets.categories[project.category] || 0) + 1;

      // State counts
      facets.states[project.state] = (facets.states[project.state] || 0) + 1;

      // Maturity counts
      if (project.maturity) {
        const classification = project.maturity.classification;
        facets.maturity[classification] = (facets.maturity[classification] || 0) + 1;
      }

      // Activity level counts
      const activityLevel = this.getActivityLevel(project);
      facets.activityLevel[activityLevel]++;

      // Semantic tag counts
      if (project.semanticTags) {
        const projectTags = flattenTags(project.semanticTags);
        for (const tag of projectTags) {
          facets.tags[tag] = (facets.tags[tag] || 0) + 1;
          // Extract category from tag (format: "category:value")
          const category = tag.split(':')[0];
          facets.tagCategories[category] = (facets.tagCategories[category] || 0) + 1;
        }
      }
    }

    return facets;
  }

  /**
   * Broadcast updates to all connected WebSocket clients
   */
  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Start the file watcher
   */
  private async startWatcher(): Promise<void> {
    const config = this.config.get();

    this.watcher = new FileWatcher(
      config.scanPath,
      (projects: ProjectMetadata[]) => {
        console.log(`📊 Detected ${projects.length} projects`);
        this.projects = projects;
        this.profiles.setProjects(this.projects);

        // Broadcast update to all connected clients
        this.broadcast({
          type: 'projects',
          data: projects
        });
      },
      config.customIgnorePatterns,
      config.debounceMs
    );

    await this.watcher.start(config.scanPath);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      // Load configuration
      await this.config.load();
      const config = this.config.get();

      this.profiles = new ProfileService(path.resolve(__dirname, '..', 'data', 'meaning'), () => {
        this.broadcast({ type: 'projects', data: this.projects });
        this.broadcast({ type: 'profile-status', data: this.profiles.status() });
      });
      await this.profiles.init();

      // Preview service (static listeners + managed dev servers) with its own data dir
      const previewConfig = resolvePreviewConfig(config.preview);
      this.dataStore = new DataStore(path.resolve(__dirname, '..', previewConfig.dataDir));
      await this.dataStore.init();
      this.preview = new PreviewService(
        previewConfig,
        this.dataStore,
        (id) => this.projects.find(p => p.id === id),
        () => this.config.get().scanPath,
      );
      this.preview.on('session', (session: PreviewSession) => this.broadcast({ type: 'preview-session', data: session }));
      this.preview.on('log', (payload: { sessionId: string; lines: string[] }) => this.broadcast({ type: 'preview-log', data: payload }));
      await this.preview.init();
      this.captures = new CaptureWorker(previewConfig, this.dataStore, this.preview, (id) => this.projects.find(p => p.id === id));
      this.captures.on('update', (payload) => this.broadcast({ type: 'capture-update', data: payload }));
      await this.captures.init();
      this.setupPreviewRoutes();
      this.setupCaptureRoutes();

      // Start file watcher
      await this.startWatcher();

      // Start HTTP server
      this.server.listen(config.port, () => {
        console.log('');
        console.log('╔══════════════════════════════════════╗');
        console.log('║   🚀 CUFOLIO NAVIGATOR SERVER       ║');
        console.log('╚══════════════════════════════════════╝');
        console.log('');
        console.log(`📡 Server:        http://localhost:${config.port}`);
        console.log(`🌐 Dashboard:     http://localhost:${config.port}/`);
        console.log(`🔌 WebSocket:     ws://localhost:${config.port}`);
        console.log(`📁 Scanning:      ${config.scanPath}`);
        console.log(`📊 Projects:      ${this.projects.length} detected`);
        console.log(`🖼️  Preview data:  ${this.dataStore.root}`);
        console.log('');
        console.log('Press Ctrl+C to stop');
        console.log('');
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async stop(): Promise<void> {
    console.log('\n🛑 Shutting down...');

    if (this.watcher) {
      await this.watcher.stop();
    }
    if (this.captures) {
      await this.captures.shutdown();
    }
    if (this.preview) {
      await this.preview.shutdown();
    }

    this.wss.close();
    this.server.close();
  }

  private setupCaptureRoutes(): void {
    const app = this.app;
    const captures = this.captures;
    const wrap = (fn: (req: express.Request, res: express.Response) => Promise<void>) => (req: express.Request, res: express.Response) => {
      fn(req, res).catch(err => res.status(500).json({ error: err?.message || String(err) }));
    };

    app.get('/api/captures', wrap(async (req, res) => { res.json(await captures.list()); }));

    app.post('/api/captures/preflight', wrap(async (req, res) => {
      const ids: string[] = Array.isArray(req.body?.projectIds) ? req.body.projectIds : [];
      res.json(await captures.preflight(ids));
    }));

    app.post('/api/captures/run', wrap(async (req, res) => {
      const ids: string[] = Array.isArray(req.body?.projectIds) ? req.body.projectIds : [];
      if (!ids.length) { res.status(400).json({ error: 'projectIds required' }); return; }
      res.json(await captures.run(ids, Boolean(req.body?.force)));
    }));

    app.post('/api/captures/pause', wrap(async (req, res) => { res.json({ queue: await captures.pause() }); }));
    app.post('/api/captures/resume', wrap(async (req, res) => { res.json({ queue: await captures.resume() }); }));
    app.post('/api/captures/cancel', wrap(async (req, res) => { res.json({ queue: await captures.cancel() }); }));
    app.post('/api/captures/retry', wrap(async (req, res) => { res.json({ queue: await captures.retryFailed() }); }));

    app.get('/api/captures/:id/image', (req, res) => {
      const file = captures.imagePath(req.params.id);
      if (!file) { res.status(404).json({ error: 'No capture' }); return; }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(file, err => { if (err && !res.headersSent) res.status(404).json({ error: 'Image missing' }); });
    });
  }
}

// Start server
const server = new CufolioServer();
server.start();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
