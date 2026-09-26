import * as http from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { canonicalPath } from './identity';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.mid': 'audio/midi', '.midi': 'audio/midi',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain', '.hdr': 'application/octet-stream',
  '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.ts': 'text/plain; charset=utf-8',
};

export interface StaticListener {
  root: string;
  port: number;
  origin: string;
  server: http.Server;
  refs: Set<string>;
  lastUsedAt: number;
}

export interface StaticPoolOptions {
  maxListeners: number;
  idleTimeoutMs: number;
}

/**
 * One HTTP listener per serving root, owned by the qnav process.
 * Each root gets its own origin (port) so root-relative URLs resolve and the
 * page's storage stays separate from the dashboard's. Ports are kept stable
 * for a root while it is in use and re-requested when it is reopened.
 */
export class StaticListenerPool {
  private listeners = new Map<string, StaticListener>();
  private preferredPorts = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private options: StaticPoolOptions) {
    this.sweepTimer = setInterval(() => this.sweep(), 30 * 1000);
    this.sweepTimer.unref();
  }

  list(): Array<{ root: string; port: number; refs: number; lastUsedAt: string }> {
    return [...this.listeners.values()].map(l => ({ root: l.root, port: l.port, refs: l.refs.size, lastUsedAt: new Date(l.lastUsedAt).toISOString() }));
  }

  async acquire(servingRoot: string, refId: string): Promise<StaticListener> {
    const root = canonicalPath(servingRoot);
    let listener = this.listeners.get(root);
    if (!listener) {
      await this.makeRoom();
      listener = await this.open(root);
      this.listeners.set(root, listener);
    }
    listener.refs.add(refId);
    listener.lastUsedAt = Date.now();
    return listener;
  }

  release(servingRoot: string, refId: string): void {
    const listener = this.listeners.get(canonicalPath(servingRoot));
    if (!listener) return;
    listener.refs.delete(refId);
    listener.lastUsedAt = Date.now();
  }

  async closeAll(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await Promise.all([...this.listeners.values()].map(l => this.close(l)));
  }

  private async makeRoom(): Promise<void> {
    while (this.listeners.size >= this.options.maxListeners) {
      const idle = [...this.listeners.values()].filter(l => l.refs.size === 0).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!idle) return; // every listener is in use; exceed the soft cap rather than break a live preview
      await this.close(idle);
    }
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - this.options.idleTimeoutMs;
    for (const l of [...this.listeners.values()]) {
      if (l.refs.size === 0 && l.lastUsedAt < cutoff) await this.close(l);
    }
  }

  private async close(listener: StaticListener): Promise<void> {
    this.listeners.delete(listener.root);
    await new Promise<void>(resolve => listener.server.close(() => resolve()));
    listener.server.closeAllConnections?.();
  }

  private open(root: string): Promise<StaticListener> {
    const server = http.createServer((req, res) => this.handle(root, req, res));
    server.keepAliveTimeout = 5000;
    const preferred = this.preferredPorts.get(root) || 0;
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (preferred && err.code === 'EADDRINUSE') {
          server.removeListener('error', onError);
          this.preferredPorts.delete(root);
          server.listen(0, '127.0.0.1');
          server.once('error', reject);
          return;
        }
        reject(err);
      };
      server.on('error', onError);
      server.on('listening', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        this.preferredPorts.set(root, port);
        resolve({ root, port, origin: `http://127.0.0.1:${port}`, server, refs: new Set(), lastUsedAt: Date.now() });
      });
      server.listen(preferred, '127.0.0.1');
    });
  }

  private async handle(root: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url || '/', 'http://x');
      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400).end('Bad path');
        return;
      }
      rel = rel.normalize('NFC');
      // Resolve against the root, then validate the *real* path is inside the real root.
      let target = path.resolve(root, '.' + path.posix.normalize('/' + rel));
      let st = await fsp.stat(target).catch(() => null);
      if (st?.isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          res.writeHead(302, { Location: url.pathname + '/' + url.search }).end();
          return;
        }
        target = path.join(target, 'index.html');
        st = await fsp.stat(target).catch(() => null);
      }
      if (!st) {
        // macOS stores some names in NFD; try the decomposed form once.
        const alt = path.resolve(root, '.' + path.posix.normalize('/' + rel.normalize('NFD')));
        const altSt = await fsp.stat(alt).catch(() => null);
        if (altSt?.isFile()) { target = alt; st = altSt; }
      }
      if (!st || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not found: ${rel}`);
        return;
      }
      const real = await fsp.realpath(target);
      if (real !== root && !real.startsWith(root + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Outside serving root');
        return;
      }
      const ext = path.extname(real).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const headers: Record<string, string | number> = {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
        'Last-Modified': st.mtime.toUTCString(),
      };
      const range = req.headers.range;
      const size = st.size;
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [s, e] = range.slice(6).split('-');
        let start = s ? parseInt(s, 10) : Math.max(0, size - parseInt(e || '0', 10));
        let end = s && e ? Math.min(parseInt(e, 10), size - 1) : size - 1;
        if (s && !e) end = size - 1;
        if (start > end || start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
          return;
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(real, { start, end }).on('error', () => res.destroy()).pipe(res);
        return;
      }
      headers['Content-Length'] = size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Preview server error');
    }
  }
}
