# qnav live preview, managed dev servers, and screenshot catalog

qnav now lets you flip through the Cufolio collection as running pages instead of
reading metadata about them. One catalog, one live flipper, two preview adapters
(static files and managed dev servers), and one screenshot worker, all going
through the same preview service.

## Starting

```bash
cd /Users/alex/Documents/Cufolio/qnav
npm install          # once; Playwright is a dependency but downloads no browser
npm run dev          # tsx, no rebuild needed
# or
npm run serve        # clean build to dist/ then node dist/server.js
```

Open http://localhost:3030/. Start it once and stay in the browser; every
preview is served or launched by this process.

`npm run test:preview` runs the lifecycle checks (ownership verification,
concurrent launch dedupe, capacity eviction, early exit, startup timeout).

## Using the flipper

- **Preview** appears as a play icon on each sidebar entry (hover) and as a
  button on the project detail page. The visual catalog (**Captures** in the
  header) opens the flipper from a thumbnail.
- The flipper walks a snapshot of the current filtered order. Prev/Next stop at
  the ends, the scrubber jumps, and the position reads `n / total`. A rescan
  never moves the selection; a removed entry shows an explanatory state and
  Next/Prev keep working.
- Arrow keys work when focus is on the flipper controls (click the scrubber or
  a button first). They are never intercepted from inside the embedded page.
  `Esc` closes, `R` reloads, `D` toggles details.
- Closing returns to the exact search, filters, and sidebar scroll you left.
- **Details** shows the plan (mode, entry, serving root, evidence), the entry
  selector, launch settings, capture settings, the session (state, URL, port,
  PID, consumers), Stop / Restart / Pin, and the live log.
- Every navigation replaces the iframe, so the previous page's audio, timers,
  animations, and sockets stop.

## How a project is previewed

`resolvePreview(projectId)` builds a **plan** without running anything:

| Situation | Plan |
| --- | --- |
| Loose `.html` at the Cufolio root | static, served from the Cufolio root so sibling assets resolve |
| Folder with a runnable root `index.html` (no bundler) | static, served from the project root |
| Folder with one root HTML file | static |
| Folder with several root HTML files and no index | choose-entry (remembered per project) |
| Vite / Next.js project with `node_modules` and a plain `dev` script | managed dev server |
| Vite / Next.js project without `node_modules` | setup-required (install yourself; qnav never installs) |
| Bundler project with an existing `dist/`, `build/` or `out/` | static, labelled as an existing build with its modification time |
| Other Node `dev`/`start` scripts, Python Flask/FastAPI/Django | setup-required with a suggested command you confirm and save |
| Electron, backend-only, loose `.py`/`.js`/`.css` files | unsupported (you can still attach a URL you run yourself) |

Only the project root, well-known build folders, and one level of nested
`index.html` are considered. Nothing deeper is picked silently.

### Static adapter

One HTTP listener per serving root, owned by the qnav process, on its own
loopback port. That gives each root its own origin, so root-relative asset
paths work and the page's storage stays separate from the dashboard. Paths are
validated against the real serving root after symlink resolution. Listeners are
reused while in use, keep their port, and are closed when idle.

### Managed adapter

A single process manager owns every child process:

- Sessions are keyed by project id and plan revision; concurrent requests for
  the same launch share one pending start, and revisiting reuses the session.
- Ports come from a configured range, checked free on loopback and wildcard
  hosts; Vite gets `--port --strictPort --host 127.0.0.1`, Next.js gets
  `-p -H 127.0.0.1`, CRA and custom commands get `PORT` (or a `{PORT}`
  placeholder). If a server announces a different port in its log, that port
  is adopted and noted.
- Readiness is an HTTP response at the entry URL within a bounded deadline,
  with early exit detected separately. `ready` means the transport answered,
  not that the page looks right.
- The last 300 lines of stdout/stderr stream into the details log.
- Processes are spawned detached so Stop/shutdown terminate the whole owned
  process group. After a qnav restart, recorded sessions are re-verified
  (start time, process group, command line) before being adopted; anything
  unverified is discarded without being signalled. Attached external servers
  are never stopped.
- Capacity: at most `maxManagedSessions`; the least-recently-used unpinned
  session with no consumers is evicted, otherwise the request queues and the
  UI names what is occupying capacity. Idle sessions stop after the idle
  timeout; pinned sessions and sessions with consumers are protected.
- Servers that send `X-Frame-Options` or a restrictive `frame-ancestors` get
  an explicit "open in new tab" state instead of a blank frame.

### Overrides

Saved per project in `data/overrides.json`: entry point, mode, command line
and working directory, external URL, capture readiness selector, settle time.
"Reset saved" in the details drawer clears them.

## Screenshot worker

- **Capture** on a project (detail page or flipper) or **Capture selection** in
  the visual catalog. A preflight dialog shows how many are static, managed,
  external, unavailable, or unchanged before anything starts.
- Chromium via Playwright, one capture at a time, a fresh context per capture,
  1440×1000 at scale 1. Waits for `load`, an optional saved selector, then a
  settling interval. Nothing is clicked; captures show initial page state.
- Sessions come from the same `acquirePreview` the flipper uses. The worker
  never evicts, restarts, or stops a live, pinned, or external session; it
  waits in the capacity queue up to `captureQueueTimeoutMs` and then marks the
  item failed. A dev server it started only for the capture is stopped again
  afterwards unless someone else picked it up.
- Each record stores image, URL, mode, time, viewport, source signature, plan
  revision, elapsed time, transport readiness, and diagnostics (HTTP status,
  console/page errors, text length, canvas/media counts). `verified` is false
  for empty pages, error statuses, or page errors, and the UI labels those.
- Progress is saved after every item. Pause / Resume / Cancel / Retry failed.
  After a crash the running item returns to `queued` and the queue reopens as
  `paused`, never as complete.
- A source signature (sorted paths, sizes, mtimes; dependencies and build
  output excluded, capped at 4000 files) plus the plan revision decide whether
  a capture is reused. Stale captures stay visible and are labelled.
- A failed attempt never removes a previous good image; it is annotated with
  `lastError`.
- Thumbnails appear on sidebar entries and in the detail page; existing
  screenshots found inside projects are unchanged and stay separate.

Data lives in `qnav/data/` (gitignored, excluded from scanning):
`overrides.json`, `sessions.json`, `captures/index.json`,
`captures/queue.json`, `captures/<projectId>/<timestamp>.png`.

## Configuration

Defaults are in `src/preview/previewConfig.ts`; override any of them in
`cufolio.config.json` under `preview`:

```json
{
  "scanPath": "/Users/alex/Documents/Cufolio",
  "port": 3030,
  "preview": {
    "maxManagedSessions": 3,
    "idleTimeoutMs": 600000,
    "startupDeadlineMs": 60000,
    "managedPortRangeStart": 4400,
    "managedPortRangeEnd": 4999,
    "maxStaticListeners": 6,
    "staticIdleTimeoutMs": 600000,
    "captureConcurrency": 1,
    "captureViewport": { "width": 1440, "height": 1000, "deviceScaleFactor": 1 },
    "captureNavigationTimeoutMs": 30000,
    "captureSettleMs": 2000,
    "captureQueueTimeoutMs": 90000,
    "signatureMaxFiles": 4000
  }
}
```

## API

| Route | Purpose |
| --- | --- |
| `GET /api/preview/plan/:id` | resolve a plan |
| `POST /api/preview/acquire` `{projectId, consumerId}` | acquire a session (returns immediately; state arrives over WebSocket) |
| `POST /api/preview/release` `{sessionId, consumerId}` | release |
| `POST /api/preview/stop` / `restart` / `pin` / `forget` | session control |
| `POST /api/preview/attach` `{projectId, url}` | attach an external server |
| `GET /api/preview/sessions`, `GET /api/preview/log/:sessionId` | inspection |
| `GET/PUT/DELETE /api/preview/overrides/:id` | saved choices |
| `GET /api/captures`, `POST /api/captures/preflight`, `POST /api/captures/run` | capture catalog and runs |
| `POST /api/captures/pause` / `resume` / `cancel` / `retry` | queue control |
| `GET /api/captures/:id/image` | latest image |

WebSocket messages: `preview-session`, `preview-log`, `capture-update`. A
browser tab registers its consumer id on connect so its sessions are released
if the tab vanishes.

## Observed limitations

- The dashboard sidebar itself is a fixed 320px column (pre-existing); the
  flipper adapts its own bar and details drawer below about 640px of width.
- Port separation isolates origin-scoped storage, not host-scoped cookies.
- Pages that need a backend, a proxy, or HMR through a different origin are
  not proxied; qnav uses direct loopback origins only.
- Managed launches cover plain Vite and Next.js `dev` scripts automatically.
  Compound scripts (`concurrently`, `turbo`, Electron, Remotion, wrangler) and
  Python projects need a saved command.
- Whether a captured page "looks right" is not judged; `verified` only says
  the transport answered and the DOM was not empty or erroring.
- Capture reuse compares file sizes and mtimes, not content hashes.

## Acceptance scenarios

Exercised on this machine (2026-09-05) against real Cufolio projects:

| Scenario | Result |
| --- | --- |
| Loose HTML with root-relative sibling assets (Swarm, AnotherOS) | static origin from the Cufolio root, rendered |
| Nested assets and root-relative routes (Brockware `/media/...`, Book) | 200 for page and assets, 404 for traversal, 206 for ranges |
| Filenames with spaces and punctuation (`AnotherOS copy.html`) | served and captured |
| Choose-entry (21st, Poetry, Background 3js) | selector shown; choice remembered |
| Bundler template detection (Gridforma, Arcadinator `index.html`) | not served statically; managed or setup-required |
| Vite launch (Gridforma) and Next.js launch (Habitrack, Vibecoder) | ready, embedded, log streamed |
| Duplicate concurrent launch requests | one session, both consumers attached |
| Occupied port | allocator skipped it; unrelated listener left alive |
| Early process exit / startup timeout | failed with `early-exit` / `startup-timeout`, group killed |
| Owned vs. unrelated processes on stop and after a qnav crash | owned group terminated; unrelated pid untouched; verified sessions re-adopted |
| Capacity with protected sessions | in-use session not evicted; LRU idle session evicted; request queued with occupants listed |
| Rapid A→B→C navigation | final frame matches C; late acquire released |
| Focus inside an interactive project | arrow keys not intercepted from the iframe |
| Departed preview cleanup | previous iframe removed on every navigation (audio not separately measured) |
| Mixed capture run with a failing project between successes | queue continued; failure recorded; unsupported item skipped |
| Queue interruption (SIGKILL mid-capture) and restart | reopened as paused with the item queued; resume finished it |
| Stale capture after a source change | labelled stale; unchanged items reused |

Source-inspection only, not executed here: Create React App launch, Python
launches via saved command, servers that refuse embedding (detection code
path is in place), external attach against a live server.
