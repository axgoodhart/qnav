# Cufolio Navigator Server

The dynamic backend server for CufolioNavigator.html - now properly isolated in its own subfolder!

## 📁 Why This Structure?

The server is contained in `cufolio-navigator-server/` to avoid polluting the root Cufolio directory with:
- `package.json` and `package-lock.json` (prevents subfolder project conflicts)
- `node_modules/` (keeps dependencies isolated)
- `dist/` build output
- TypeScript configuration

**Important:** Having `package.json` at the root level would cause npm resolution issues for all subfolder projects!

## 🚀 Quick Start

### Start the Server
```bash
cd cufolio-navigator-server
npm run dev
```

### Access the Dashboard
```
http://localhost:3030/CufolioNavigator.html
```

The server serves the **parent directory** (the main Cufolio folder) as static files, so CufolioNavigator.html remains in the root where it belongs.

## 🎞️ Live preview and captures

qnav can open every project as a running page (static files or a managed dev server), flip through the filtered catalog, and build a screenshot catalog. See [PREVIEW.md](PREVIEW.md) for startup, configuration, supported project types, and observed limitations.

## 📊 What It Does

1. **Scans** `/Users/alex/Documents/Cufolio` for all project subfolders
2. **Detects** tech stacks from package.json, requirements.txt, etc.
3. **Watches** for file changes with 2-second debouncing
4. **Streams** updates to the frontend via WebSocket
5. **Serves** CufolioNavigator.html and all static assets

## ⚙️ Configuration

Edit `cufolio.config.json`:

```json
{
  "scanPath": "/Users/alex/Documents/Cufolio",
  "port": 3030,
  "debounceMs": 2000,
  "customIgnorePatterns": [
    "cufolio-navigator-server/**"
  ]
}
```

The server folder is already excluded from project scanning by default.

## 🛠️ Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm run type-check` | Verify types |

## 📡 API Endpoints

- `GET /api/projects` - All detected projects
- `GET /api/health` - Server health check
- `GET /api/config` - Current configuration
- `POST /api/config` - Update configuration
- `POST /api/rescan` - Trigger manual scan

## 🔌 WebSocket

Connect to `ws://localhost:3030` for real-time project updates.

## 📝 Project Structure

```
cufolio-navigator-server/
├── src/
│   ├── server.ts           # Main Express + WebSocket server
│   ├── watcher.ts          # File system watcher
│   ├── scanner.ts          # Directory scanner
│   ├── metadataDetector.ts # Tech stack detection
│   ├── ignorePatterns.ts   # Pattern matching
│   └── config.ts           # Configuration manager
├── dist/                   # Compiled JavaScript
├── node_modules/           # Dependencies (isolated!)
├── package.json            # Server dependencies only
├── tsconfig.json           # TypeScript config
├── cufolio.config.json     # Runtime configuration
└── README.md               # This file
```

## 🎯 Key Design Decisions

### Why Subfolder?
Prevents `package.json` in the root from interfering with subfolder projects' dependency resolution.

### Why Serve Parent Directory?
Keeps CufolioNavigator.html at the root level for easy access while the server code stays isolated.

### Why Exclude Server from Scanning?
Avoids recursive watching and unnecessary project detection for the server itself (though it's harmless if included).

## 🔄 How Updates Work

1. File change detected in `/Users/alex/Documents/Cufolio`
2. Debounce timer (2s) prevents too many rapid scans
3. Scanner re-reads all project folders
4. Metadata detector extracts tech stacks
5. WebSocket broadcasts new data
6. Frontend updates instantly

## 🐛 Troubleshooting

### "EADDRINUSE" port 3030 in use
```bash
lsof -i :3030
kill -9 <PID>
```

### Dashboard shows OFFLINE
Ensure server is running (`npm run dev`)

### Projects not updating
Check server console for file watcher errors

### Wrong projects detected
Update `customIgnorePatterns` in `cufolio.config.json`

## 📚 Full Documentation

See `CUFOLIO_README.md` for complete technical documentation.

---

**Now your Cufolio directory stays clean while enjoying real-time project tracking! 🎉**
# Source-based project profiles

qnav automatically reads project source using the installed, signed-in Codex CLI. It discovers app manifests inside collection folders, builds a bounded evidence sample, and saves generated profiles in `data/meaning/profiles.json`. Unchanged samples reuse their saved profiles; source changes queue a new reading. The reader runs without shell, browser, connector, or editing tools.

The dashboard’s **What’s inside your projects** section compares purpose and capabilities. Expand a tag to see its source quotation and line number. Inferred tags are marked, and **Sources read** shows the sample’s limits. Opening an unread project moves it forward in the queue. **Pause analysis** stops additional model calls after the current reading finishes; **Resume analysis** continues saved work.

Related projects and graph edges use the same supported tags and project relationships. Featured selection requires supported purpose and capability evidence, avoids sibling variants, prefers different capabilities, and records recent appearances in the browser. **Featured candidates & reasoning** exposes eligibility and cooldown decisions. The default repeat cooldown is 14 days in `public/profiles.js`; a short eligible list falls back to its least recently shown projects.

The reader uses the existing Codex sign-in and consumes its usage allowance. Missing sign-in, usage limits, or invalid output stop the queue with a visible recovery message. `QNAV_CODEX_BIN` can point to the executable when `codex` is outside the server’s PATH. `npm run profiles -- <project name, id, or absolute path>` can generate saved readings against an already running catalog. After installing the server changes, restart qnav; saved readings remain visible through the static snapshot until then.

**Reader settings** (dashboard, under What’s inside your projects) chooses Auto or Manual mode, the reading frequency (max readings per hour, pause between readings), the per-project size caps, and ignored filetypes and paths. **Readings** lists every project with its state, the date it was read, and how much source each Codex call received, with an Analyze button per row; in Manual mode that button is the only trigger. Settings persist in `data/meaning/profiles.json`.

