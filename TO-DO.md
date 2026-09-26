

Tag explosion. A typical Three.js sketch picks up [3d, webgl, creative-coding, visual, generative] plus often audio. Six tags per tile is too noisy for a dashboard. The trio creative-coding + visual + generative almost always fires together — it's three names for one thing.
No tag confidence. A <canvas> substring and an instantiated WebGLRenderer produce identical-weight tags. Strong instantiations and weak substring hits should not carry the same vote.
Genre coverage gaps. Aida's actual collection has whole categories the genres miss: typography (FontFinder, Fontematog, Cursive), journal/diary (Briiziary), timer/countdown (ClassTimer, COUNTD0WN), camera/video, dev-agent (CLINE, Claudable, Claude, Codex), file-browser (Browzer, BrowserBase), wallpaper-generator (4kw / PixelWalls), chrome-extension (no manifest.json detection), desktop-app (Tauri/Electron exists as a library, not a genre), card-game/puzzle/rpg subgenres.
Library catalog blind spots. No detection for: WebMIDI library, dat.gui / lil-gui, stats.js, Three.js addons (OrbitControls, GLTFLoader), MediaPipe, TensorFlow.js, ml5.js, PoseNet, face-api.js, Tesseract.js (OCR), Leaflet / Mapbox, Ammo.js / Rapier, magenta.js, SvelteKit (only Svelte), SwiftUI / SFML / SpriteKit, Vapor.
API blind spots. No detection for: WebGPU (navigator.gpu), WebXR / VR / AR, File System Access API, Web Bluetooth, Clipboard, Geolocation, Notifications, Web Share, Pointer Lock, Fullscreen, Picture-in-Picture, Web Workers, Web Crypto, Vibration. AnalyserNode (the audio-visualization workhorse) doesn't show up despite being on dozens of files.
Single-file content sampling. For folders, the parser reads one entry file. So a folder where index.html is a stub but the real meat lives in synth.js will look empty. Should sample 2–3 files and merge signals.
Cross-language gaps. A Python file with import openai only gets ai-llm if its filename matches a pattern — not via libs. Library detection should run the same regex catalog over Python imports.
Some regexes are dangerously bare. /\bd3\b/, /\bthree\b/, /\bvue\b/, /\bnext\b/ will false-fire on prose, comments, and unrelated words. <title>Three Best Practices</title> would tag a doc as Three.js.
archive genre misses suffix forms. \bold\b doesn't fire on ABiconsOLD (no word boundary). Same for …OLD/…BAK suffixes.
frontend and fullstack don't read content. They only fire on tech.includes('React')-type strings derived from package.json. A pure-HTML SPA with handwritten routing gets nothing.
No "weak signal → strong signal" promotion. A folder with both <canvas> and requestAnimationFrame is almost certainly visual/animated — but each on its own is too generic to fire creative-coding. Promote on cooccurrence.


Proposed expansions
New genres to add:
typography, journal, timer, video, vision (camera/pose/face), dev-agent, file-browser, wallpaper, chrome-extension, desktop-app, daw, sequencer, drum-machine, instrument, vfx, puzzle, card-game, rpg, platformer, physics-toy, math-toy, calculator, form, chatbot, image-gen, transcription, fluid-sim, particle-system, voice-tts.
New library patterns:
WebMIDI / webmidi.js, jzz, magenta.js, dat.gui, lil-gui, stats.js, OrbitControls / GLTFLoader / DRACOLoader, MediaPipe (@mediapipe/), TensorFlow.js (@tensorflow/), ml5.js, face-api.js, PoseNet, Tesseract.js, Leaflet, Mapbox / mapbox-gl, OpenLayers, Ammo.js, Rapier, PlayCanvas, YUKA, Magenta, ONNX Runtime Web, WebGPU framework libs (TSL, three-tsl), SvelteKit, SolidStart, Vapor, SwiftUI markers, SpriteKit, GameKit.
New API/capability patterns:
webgpu, webxr, webvr, file-system-access, web-bluetooth, clipboard, geolocation, notifications, web-share, pointer-lock, fullscreen, picture-in-picture, web-crypto, web-worker, shared-worker, broadcast-channel, vibration, wake-lock, payment-request, history-api, sensors, analyser-node (web-audio sub-tag), biquad-filter, convolver, audio-worklet, image-data, getDisplayMedia, file-input.

Architectural improvements

Confidence tier per match. Add a strong | medium | weak weight per regex; require at least one strong hit before broadcasting a genre. Currently every regex match has equal vote.
Primary vs secondary tags. Compute one "primary genre" (highest-confidence specific tag) plus a small set of "tags". Dashboard renders primary big, tags small. Stops the 6-tag soup.
Cluster collapsing. If creative-coding, visual, and generative all fire, merge to one display tag (creative-coding). If audio, web-audio, music all fire, show as audio · music.
Cooccurrence promotion. Promote weak signals when they cluster: <canvas> + requestAnimationFrame + Math.random → generative. <input type=range> × N + class=knob → ui-lab. manifest.json + background.js → chrome-extension.
Multi-file sampling for folders. Currently reads one entry file. Read up to 3–5: index.html + the largest JS + the largest CSS + README. Union the libs/apis. Will dramatically improve folder coverage.
Tag provenance. Store why each tag fired ({tag: 'audio', reason: 'lib:Tone.js'}). Useful for debugging false positives and would let the dashboard show "tagged audio because of Tone.js, web-audio API, name 'synth'".
Tighten the bare-word regexes. Replace /\bthree\b/i with /three(?:\.js|@\d|-min|JsCdn|js\/build)/i — require library-shaped context.
Negative tags. A "stub" genre should suppress most other genres. A handwritten messy project should suppress polished. Already partly there for stub.
archive for trailing OLD/BAK/_old suffixes. Add (?:^|[_-])(old|bak|backup|legacy|deprecated)(?:[_-]|\d|$) and a no-boundary suffix variant.
Python content scanning. Run library/API catalogs against import lines and known function calls (openai.ChatCompletion, pandas.DataFrame, fastapi.FastAPI, flask.Flask, django.urls).
Tag synonyms / aliases. Let web-audio, audio-context, tone.js all collapse to a canonical audio family in display, while preserving the granular tags in the data.
Per-genre minimum file size. A 30-line HTML claiming [3d, audio, creative-coding, ai-llm, fullstack] is almost certainly a stub; only allow 1–2 genres for sub-stub-threshold files.


