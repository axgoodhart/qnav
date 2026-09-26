import * as net from 'net';

function tryBind(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

/** True when nothing is listening on the port for loopback or wildcard hosts. */
export async function isPortFree(port: number): Promise<boolean> {
  if (!(await tryBind(port, '127.0.0.1'))) return false;
  if (!(await tryBind(port, '0.0.0.0'))) return false;
  try {
    if (!(await tryBind(port, '::'))) return false;
  } catch {
    // IPv6 may be unavailable; loopback + wildcard checks are enough.
  }
  return true;
}

/** Find a free port in [start, end] skipping ports reserved by the caller. */
export async function findFreePort(start: number, end: number, reserved: Set<number>): Promise<number | null> {
  for (let port = start; port <= end; port++) {
    if (reserved.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  return null;
}

/** Fetch a URL and resolve with the status code, or reject on transport failure. */
export function probeHttp(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'qnav-preview-probe' } })
      .then(r => { clearTimeout(timer); r.body?.cancel().catch(() => {}); resolve(r.status); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Check whether a page can be embedded in an iframe from another origin.
 * Returns a reason string when X-Frame-Options or a CSP frame-ancestors
 * directive forbids it, otherwise null.
 */
export async function probeEmbedBlock(url: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'qnav-preview-probe' } });
    r.body?.cancel().catch(() => {});
    const xfo = (r.headers.get('x-frame-options') || '').toLowerCase();
    if (xfo.includes('deny') || xfo.includes('sameorigin')) return `X-Frame-Options: ${xfo}`;
    const csp = r.headers.get('content-security-policy') || '';
    const fa = csp.split(';').map(x => x.trim()).find(x => x.toLowerCase().startsWith('frame-ancestors'));
    if (fa && !/\*|http:\/\/127\.0\.0\.1|http:\/\/localhost/.test(fa)) return `Content-Security-Policy ${fa}`;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
