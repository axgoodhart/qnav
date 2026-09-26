# 🚀 Cufolio Navigator - Dynamic Project Dashboard

A beautiful, real-time project navigation system that automatically scans your local directories and keeps project metadata continually up-to-date with file watching.

## ✨ Features

- **🔍 Automatic Project Discovery**: Recursively scans directories to detect all projects
- **🔄 Real-Time Updates**: File system watcher with intelligent debouncing
- **🧠 Smart Tech Detection**: Auto-detects tech stacks from package.json, requirements.txt, Cargo.toml, etc.
- **🚫 Intelligent Ignoring**: .gitignore-style pattern matching for node_modules, .git, dist, etc.
- **⚡ Live Dashboard**: WebSocket-powered UI with instant updates
- **🎨 Beautiful Interface**: Modern, dark-themed UI with glassmorphism effects
- **📊 Visual Analytics**: Charts and statistics about your project portfolio
- **⚙️ Configurable**: Customize scan paths, ignore patterns, and debounce timing

## 🛠️ Technology Stack

### Backend
- **TypeScript** - Type-safe server code
- **Express** - HTTP server and REST API
- **WebSocket (ws)** - Real-time bidirectional communication
- **Chokidar** - Efficient file system watching
- **Minimatch** - Glob pattern matching

### Frontend
- **Vanilla JavaScript** - No framework overhead
- **Tailwind CSS** - Utility-first styling
- **Chart.js** - Data visualization
- **WebSocket API** - Real-time updates

## 📦 Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the project** (optional for production):
   ```bash
   npm run build
   ```

## 🚀 Quick Start

### Development Mode
```bash
npm run dev
```

This starts the server with hot-reload using `tsx watch`.

### Production Mode
```bash
npm run build
npm start
```

### Access the Dashboard
Once the server is running, open:
```
http://localhost:3030/CufolioNavigator.html
```

## ⚙️ Configuration

The system automatically creates a `cufolio.config.json` file with defaults:

```json
{
  "scanPath": "/Users/alex/Documents/Cufolio",
  "port": 3030,
  "debounceMs": 2000,
  "customIgnorePatterns": []
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scanPath` | string | `/Users/alex/Documents/Cufolio` | Root directory to scan for projects |
| `port` | number | `3030` | HTTP/WebSocket server port |
| `debounceMs` | number | `2000` | Milliseconds to wait before rescanning after changes |
| `customIgnorePatterns` | string[] | `[]` | Additional glob patterns to ignore |

### Environment Variables

You can also configure via environment variables:
```bash
export CUFOLIO_SCAN_PATH="/path/to/projects"
export PORT=3030
npm run dev
```

## 📡 API Endpoints

### GET `/api/projects`
Returns array of all detected projects:
```json
[
  {
    "name": "my-project",
    "type": "Next.js App",
    "state": "Active Dev",
    "tech": ["Next.js", "React", "TypeScript"],
    "desc": "My awesome project",
    "path": "/Users/alex/Documents/Cufolio/my-project"
  }
]
```

### GET `/api/config`
Returns current configuration.

### POST `/api/config`
Update configuration (requires JSON body with config fields).

### POST `/api/rescan`
Manually trigger a project rescan.

### GET `/api/health`
Health check endpoint:
```json
{
  "status": "ok",
  "projectCount": 42,
  "watching": true
}
```

## 🔌 WebSocket Protocol

Connect to `ws://localhost:3030` to receive real-time updates.

### Message Format
```json
{
  "type": "projects",
  "data": [/* array of ProjectMetadata */]
}
```

The server broadcasts this message whenever:
- Initial connection is made
- File system changes are detected (after debounce)
- Manual rescan is triggered

## 🚫 Ignore Patterns

Default ignore patterns (similar to .gitignore):
- `node_modules/**`
- `.git/**`
- `.DS_Store`
- `dist/**`, `build/**`
- `__pycache__/**`, `*.pyc`
- `.venv/**`, `venv/**`
- `.next/**`, `.nuxt/**`
- `target/**` (Rust)
- `vendor/**` (Go, PHP)
- `.idea/**`, `.vscode/**`

### Custom Ignore Patterns

Add custom patterns in `cufolio.config.json`:
```json
{
  "customIgnorePatterns": [
    "temp/**",
    "*.tmp",
    "!important-file.log"
  ]
}
```

Patterns support:
- Glob syntax: `**/*.test.js`
- Negation: `!keep-this`
- Dot files: `.hidden/**`

## 🧠 Project Detection Logic

The system auto-detects project types and tech stacks by scanning for:

| File(s) | Detected Tech | Project Type |
|---------|---------------|--------------|
| `package.json` | Node.js, React, Next.js, Vue, etc. | Web App / API Server |
| `requirements.txt` | Python, FastAPI, Django, Flask | Python App |
| `Cargo.toml` | Rust | Rust App |
| `go.mod` | Go | Go App |
| `pubspec.yaml` | Flutter, Dart | Flutter App |
| `*.xcodeproj` | Swift, Xcode | iOS App |
| `*.html` (standalone) | HTML, CSS, JS | Web Page |

The detector reads dependency files and README files to extract:
- Project name
- Description
- Tech stack
- Project type
- State (Active Dev, Demo, etc.)

## 🎨 UI Features

### Dashboard View
- Real-time project count
- Technology distribution chart
- Top technologies tags
- Featured projects grid
- Global search across projects and tech

### Project Detail View
- Full project metadata
- Tech stack badges
- Key files listing
- Purpose and description

### Live Indicators
- Connection status (LIVE/OFFLINE/RECONNECTING)
- Auto-reconnection on disconnect
- Real-time project count updates

## 🔧 Development

### Project Structure
```
Cufolio/
├── src/
│   ├── server.ts           # Main Express + WebSocket server
│   ├── watcher.ts          # File system watcher
│   ├── scanner.ts          # Directory scanner
│   ├── metadataDetector.ts # Project metadata extraction
│   ├── ignorePatterns.ts   # Pattern matching system
│   └── config.ts           # Configuration manager
├── CufolioNavigator.html   # Frontend dashboard
├── package.json
├── tsconfig.json
└── cufolio.config.json     # User configuration (auto-created)
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run production server |
| `npm run type-check` | Check TypeScript types |

## 🐛 Troubleshooting

### Server won't start
- Check if port 3030 is available: `lsof -i :3030`
- Verify Node.js version: `node --version` (requires Node.js 18+)

### Dashboard shows OFFLINE
- Ensure server is running on port 3030
- Check browser console for WebSocket errors
- Verify firewall isn't blocking localhost connections

### Projects not detected
- Check `scanPath` in config points to correct directory
- Verify directory permissions
- Check server logs for scanning errors

### Too many updates
- Increase `debounceMs` in config (e.g., 5000 for 5 seconds)
- Add more ignore patterns for noisy directories

## 📝 License

MIT

## 🤝 Contributing

This is a personal project navigation tool. Feel free to fork and adapt for your own use!

---

Built with ❤️ for developers who need a beautiful way to navigate their project portfolios.
