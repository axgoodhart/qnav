# 🚀 Cufolio Navigator - Quick Start Guide

Your CufolioNavigator.html has been upgraded to a dynamic, real-time application!

## ✅ What Was Built

1. **TypeScript Backend Server** - Express + WebSocket server
2. **Automatic Project Scanner** - Recursively scans directories and detects tech stacks
3. **File System Watcher** - Monitors for changes with intelligent debouncing
4. **Ignore Pattern System** - .gitignore-style pattern matching
5. **Live WebSocket Updates** - Real-time data streaming to frontend
6. **Updated Dashboard** - CufolioNavigator.html now consumes live data

## 📊 Current Status

The server is running from its own subfolder and detected **163 projects** in your Cufolio directory!

**Important:** The server is now isolated in `cufolio-navigator-server/` to prevent `package.json` conflicts with your subfolder projects.

## 🎯 How to Use

### 1. Start the Server (if not running)

```bash
cd cufolio-navigator-server
npm run dev
```

### 2. View the Dashboard

Open in your browser:
```
http://localhost:3030/CufolioNavigator.html
```

You'll see:
- ✅ **LIVE** indicator (green) - real-time connection active
- All your projects automatically detected
- Dynamic updates when files change

### 3. Test Live Updates

Try these to see real-time updates:

**Create a new project:**
```bash
mkdir /Users/alex/Documents/Cufolio/test-project
cd /Users/alex/Documents/Cufolio/test-project
echo '{"name": "test-project", "description": "Testing live updates"}' > package.json
```

Watch the dashboard update automatically within 2 seconds!

**Modify an existing project:**
```bash
cd /Users/alex/Documents/Cufolio/actiondeck
echo "# Updated" >> README.md
```

The dashboard will refresh with updated metadata.

### 4. Configuration

The system auto-created `cufolio-navigator-server/cufolio.config.json`:

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

**Customize it:**
- Change `scanPath` to scan different directories
- Adjust `debounceMs` to change update frequency
- Add custom ignore patterns (server folder already excluded)

### 5. Stop the Server

When you're done testing:
```bash
# Find the process
lsof -i :3030

# Or use Ctrl+C if running in foreground
```

### 6. Restart Anytime

```bash
cd /Users/alex/Documents/Cufolio/cufolio-navigator-server

# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

## 🎨 Features in Action

### Auto-Detection Examples

The system detected your projects perfectly:

**actiondeck:**
- Type: Next.js App
- Tech: React, Next.js, TypeScript, Tailwind, Firebase
- State: Active Dev

All from reading `package.json` automatically!

### Real-Time Features

- **File Watching**: Creates, updates, deletes trigger rescans
- **Smart Debouncing**: Waits 2 seconds to batch multiple changes
- **WebSocket Updates**: Dashboard refreshes without reload
- **Connection Status**: Live indicator shows connection state

### Ignore Patterns

Already ignoring:
- `node_modules/` folders
- `.git/` directories
- Build outputs (`dist/`, `build/`)
- Virtual environments (`.venv/`, `venv/`)
- IDE folders (`.vscode/`, `.idea/`)

## 🔧 Customization

### Add More Ignore Patterns

Edit `cufolio.config.json`:
```json
{
  "customIgnorePatterns": [
    ".claude/**",
    ".history/**",
    "temp/**",
    "*.backup"
  ]
}
```

Save and restart the server.

### Change Scan Directory

Point it anywhere:
```json
{
  "scanPath": "/Users/alex/Projects"
}
```

### Adjust Update Frequency

Make it faster or slower:
```json
{
  "debounceMs": 5000  // 5 seconds (slower)
}
```

## 📡 API Endpoints

The server provides REST APIs:

```bash
# Get all projects
curl http://localhost:3030/api/projects

# Check server health
curl http://localhost:3030/api/health

# Get configuration
curl http://localhost:3030/api/config

# Trigger manual rescan
curl -X POST http://localhost:3030/api/rescan
```

## 🐛 Troubleshooting

### Dashboard shows "OFFLINE"
Server isn't running. Start it with `npm run dev`

### Projects not updating
Check server console for errors. Ensure files are being saved properly.

### Port already in use
Another process is using port 3030:
```bash
lsof -i :3030
kill -9 <PID>
```

Or change port in `cufolio.config.json`

## 📚 Documentation

Full documentation in `CUFOLIO_README.md`

## 🎉 Next Steps

1. **Explore the Dashboard** - Open http://localhost:3030/CufolioNavigator.html
2. **Test Live Updates** - Create/modify projects and watch updates
3. **Customize Patterns** - Edit `cufolio.config.json` to your needs
4. **Add to Startup** - Make it run automatically on boot

---

**Your static dashboard is now a living, breathing project navigator! 🌟**

The dashboard automatically stays in sync with your file system - no manual updates needed!
