/**
 * Lifecycle checks that would otherwise be easy to get wrong silently.
 * Run with: npx tsx src/preview/__tests__/ownership.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import assert from 'assert';
import { DataStore } from '../dataStore';
import { ProcessManager } from '../processManager';
import { resolvePreviewConfig } from '../previewConfig';
import { PreviewPlan } from '../types';
import { splitCommandLine } from '../launchPlanner';
import { selectEntry, looksLikeBundlerTemplate } from '../entryResolver';

const managers: ProcessManager[] = [];

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qnav-test-'));
  const store = new DataStore(tmp);
  await store.init();
  const config = resolvePreviewConfig({ startupDeadlineMs: 8000, maxManagedSessions: 1, managedPortRangeStart: 4700, managedPortRangeEnd: 4720 });

  // 1. An unrelated live process recorded in sessions.json must not be adopted or signalled.
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(tmp, 'sessions.json'), JSON.stringify([{
    sessionId: 's_fake', planId: 'p_fake', planRevision: 'r', projectName: 'fake', pid: bystander.pid, port: 4711,
    url: 'http://127.0.0.1:4711/', cwd: tmp, command: 'npm', args: ['run', 'dev'], startedAt: new Date().toISOString(), pinned: false,
  }]));
  const pm = new ProcessManager(config, store);
  managers.push(pm);
  const rec = await pm.recover();
  assert.strictEqual(rec.adopted, 0, 'must not adopt an unrelated pid');
  assert.strictEqual(rec.discarded, 1);
  assert.strictEqual(bystander.exitCode, null, 'bystander must still be alive');
  assert.ok(bystander.kill(0) === true || bystander.exitCode === null, 'bystander was signalled');
  bystander.kill('SIGKILL');
  console.log('ok  unverified session record discarded without touching the process');

  // 2. Owned launch: ready, dedupe, stop kills the group.
  const plan = (id: string, revision: string, script: string): PreviewPlan => ({
    id, name: id, projectPath: tmp, kind: 'folder', mode: 'managed', revision, entryUrlPath: '/', candidates: [], explanation: [],
    launch: { cwd: tmp, command: process.execPath, args: ['-e', script], packageManager: 'none', framework: 'custom', portMode: 'env-PORT', entryUrlPath: '/', depsInstalled: true, evidence: [] },
  });
  const serverScript = `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)']);require('http').createServer((q,r)=>r.end('ok')).listen(process.env.PORT)`;
  const a = await pm.acquire(plan('p_a', 'r1', serverScript), 'c1');
  const a2 = await pm.acquire(plan('p_a', 'r1', serverScript), 'c2');
  assert.strictEqual(a.id, a2.id, 'same plan must reuse the session');
  const ready = await pm.waitReady(a.id, 8000);
  assert.strictEqual(ready.state, 'ready');
  assert.deepStrictEqual([...ready.consumers].sort(), ['c1', 'c2']);
  const pid = ready.pid!;
  await new Promise(r => setTimeout(r, 300));
  const groupBefore = require('child_process').execSync(`ps -o pid= -g ${pid} | wc -l`).toString().trim();
  assert.ok(parseInt(groupBefore, 10) >= 2, 'expected leader + child in the group');
  console.log('ok  managed launch ready, concurrent acquire deduped, group has descendants');

  // 3. Capacity: max 1, the first has consumers -> second is queued, not evicted; noEvict worker gives up.
  const b = await pm.acquire(plan('p_b', 'r1', serverScript), 'c3', { noEvict: true, queueTimeoutMs: 1500 });
  assert.strictEqual(b.state, 'queued');
  assert.ok(b.queueInfo && b.queueInfo.occupying[0].startsWith('p_a'));
  await new Promise(r => setTimeout(r, 2000));
  assert.strictEqual(pm.get(b.id)?.state ?? 'failed', 'failed', 'worker acquire should give up after the queue timeout');
  assert.strictEqual(pm.get(a.id)?.state, 'ready', 'in-use session must not be evicted');
  console.log('ok  capacity: in-use session protected, noEvict waiter timed out');

  // 4. Release both consumers -> eviction allowed for a normal acquire.
  pm.release(a.id, 'c1'); pm.release(a.id, 'c2');
  const c = await pm.acquire(plan('p_c', 'r1', serverScript), 'c4');
  const cReady = await pm.waitReady(c.id, 8000);
  assert.strictEqual(cReady.state, 'ready');
  await new Promise(r => setTimeout(r, 500));
  assert.strictEqual(pm.get(a.id)?.state, 'stopped', 'idle unpinned session should have been evicted');
  const groupAfter = require('child_process').execSync(`ps -o pid= -g ${pid} | wc -l`).toString().trim();
  assert.strictEqual(parseInt(groupAfter, 10), 0, 'evicted process group must be gone');
  console.log('ok  LRU eviction stopped the idle session and its descendants');

  // 5. Early exit is reported, not hung (release p_c first so the single slot can be evicted).
  pm.release(c.id, 'c4');
  const d = await pm.acquire(plan('p_d', 'r1', 'process.exit(3)'), 'c5');
  await pm.waitReady(d.id, 8000).catch(() => {});
  assert.strictEqual(pm.get(d.id)?.state, 'failed');
  assert.strictEqual(pm.get(d.id)?.error?.code, 'early-exit');
  console.log('ok  early exit -> failed with early-exit');

  // 6. Startup timeout kills the group.
  const pm2 = new ProcessManager(resolvePreviewConfig({ startupDeadlineMs: 1500, managedPortRangeStart: 4721, managedPortRangeEnd: 4730 }), store);
  managers.push(pm2);
  const e = await pm2.acquire(plan('p_e', 'r1', 'setInterval(()=>{},1000)'), 'c6');
  await pm2.waitReady(e.id, 8000).catch(() => {});
  assert.strictEqual(pm2.get(e.id)?.state, 'failed');
  assert.strictEqual(pm2.get(e.id)?.error?.code, 'startup-timeout');
  await new Promise(r => setTimeout(r, 300));
  const alive = (() => { try { process.kill(pm2.get(e.id)!.pid!, 0); return true; } catch { return false; } })();
  assert.strictEqual(alive, false, 'timed-out process must be killed');
  console.log('ok  startup timeout -> failed and process killed');

  // 7. Pure helpers.
  assert.deepStrictEqual(splitCommandLine(`node -e "console.log('hi there')" --port {PORT}`), ['node', '-e', "console.log('hi there')", '--port', '{PORT}']);
  assert.ok(looksLikeBundlerTemplate('<script type="module" src="/src/main.tsx"></script>'));
  assert.ok(!looksLikeBundlerTemplate('<script src="app.js"></script>'));
  const sel = selectEntry([
    { relPath: 'a.html', servingRoot: '/x', urlPath: '/a.html', kind: 'root-html', label: 'a', score: 60, isBuild: false },
    { relPath: 'b.html', servingRoot: '/x', urlPath: '/b.html', kind: 'root-html', label: 'b', score: 60, isBuild: false },
  ]);
  assert.strictEqual(sel.needsChoice, true);
  console.log('ok  helpers: command splitting, bundler detection, entry choice');

  await pm.shutdown();
  await pm2.shutdown();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('all ownership/lifecycle checks passed');
}

main().catch(async err => {
  console.error('FAIL', err);
  // Never leave owned test servers behind, even when an assertion fails.
  await Promise.all(managers.map(m => m.shutdown().catch(() => {})));
  process.exit(1);
});
