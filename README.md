# Flipbook

A little animation studio for big imaginations. An original browser app inspired by the approachable, tactile feel of clai and the frame-by-frame workflow of Flipnote. Ink plum, lavender, seafoam, and tangerine keep the studio playful and calm.

Static HTML, CSS, ES modules, Canvas 2D, IndexedDB, and Web Audio. No application server, account system, tracking, external fonts, or runtime CDN dependencies. The hosted test version uses private Sites access; the app itself can be served by any static host.

## Make something

- Start from an editable, twelve-frame bouncing character or a blank landscape, square, or portrait page.
- Draw with an ink pen, pencil, marker, crayon, watercolor wash, airbrush, glow pen, or pixel pen. Adjust size and opacity; stylus pressure changes width. Steady lines gently smooth pointer movement.
- Erase, fill closed areas on the selected layer, sample any canvas color, use fourteen palette colors or a full color picker, draw lines/rectangles/ellipses/stars, and add text or PNG/JPEG/WebP pictures.
- Use up to eight layers, with names, visibility, opacity, and order shared across the animation. Move or clear the selected layer's art on one frame. Layer movement crops beyond the canvas; Undo restores it.
- Add, duplicate, delete, and reorder frames. Use drag-and-drop on desktop or the frame options on touch devices. Hold any frame for 1–24 beats and play at 1–30 fps. Pink onion skin shows the previous frame, green the next. Playback can loop.
- Pinch with two fingers to zoom and pan. On a computer, scroll to zoom, choose Pan, hold Space, or drag with the right/middle button. Zoom ranges from 25% to 800% of the fitted canvas size; tap the percentage to recenter.
- Add six synthesized sound effects to any frame. Preview, remove, and adjust cue volumes. Record up to thirty seconds of microphone audio at a time; recordings are kept in the project and can be reused. Microphone access is requested only when Record is tapped; tracks stop on Stop, cancellation, closing the dialog, or leaving the app.
- Keep a device-local collection with autosave. Opening another project first saves the current one. If storage fails, download an editable backup before switching. Import validates all project structures before replacing current work.

Keyboard: B draw, E erase, F fill, S shapes, T text, I color picker, H pan, Space pan while held, arrows previous/next frame, N new frame, D duplicate, Enter play/pause, O onion skin, [ / ] brush size, 0 fit view, Ctrl/Cmd Z undo, Ctrl/Cmd Shift Z redo, Ctrl/Cmd S project download. Help is available from the rail or toolbox.

## Keep and share

| Format | Contents |
| --- | --- |
| `.flipbook` | Editable frames, strokes, layers, imported pictures, settings, and microphone recordings. Open in Flipbook on another device. |
| Animated GIF | Up to 640 pixels wide, adaptive 256-color palette per frame, holds and looping preserved. No sound. Export runs in a worker and supports cancellation. |
| Video | Full project resolution with sound; WebM or MP4 selected from the browser's supported codecs. Export runs in real time; keep the page visible. |
| PNG | The current frame at full resolution, including its paper color. |
| ZIP | Full-size PNGs for every frame, plus `timing.json` with durations, order, and frame rate. |
| WAV | Mono PCM soundtrack with sound effects and recorded cues, mixed at 24 kHz. |

Sounds start at their frame's time, continue across frames, and stop at the animation's end. A loop can overlap a previous loop's sound tail; playback caps simultaneous voices at 24. Video and WAV exports cover one animation cycle. Microphone codecs vary by browser; an editable recording may require the browser that created it. WAV is the portable sound export.

Device storage belongs to the current browser and origin. Clearing website data removes it, and it does not sync between devices. Download `.flipbook` files for durable backups. The service worker caches the app's static assets after its first HTTPS load; offline availability depends on browser storage and the host's access requirements.

## Run and check

Node.js 22+ and Python 3 are sufficient for development:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Microphone access requires HTTPS or localhost. There is no build step for the app; `dist/` is ready for static hosting. Development dependencies are used only for validation. GIF encoding and the font are vendored with their licenses.

```sh
npm run check
npm test
node scripts/benchmark.mjs
```

The tests exercise real native Canvas 2D pixels, all brushes, pressure, erasing, bounded flood fill, compositing, layer transforms, onion-skin isolation, cache limits, immutable frame/history behavior, project validation, IndexedDB transactions, synthetic audio, microphone lifecycle and denied permissions, WAV output, worker GIF export through an independent GIF decoder, PNG ZIP files, and pointer cancellation/pinch gestures. A DOM harness with real canvas backing exercises drawing, undo/redo, frames, layers, text, sound cues, project download/import, autosave, and the shelf.

Browser visual QA, hardware microphone recordings, actual MediaRecorder video encoding, and physical phone/tablet/desktop testing were unavailable in the build environment. The DOM harness does not verify CSS layout or browser rendering. The app targets current Safari, Chrome, Edge, and Firefox; video export, microphone formats, full screen, and install/offline support depend on browser capabilities and have explicit fallbacks.

## Performance and limits

- Pointer input uses coalesced samples; display draws at most once per animation frame and sleeps when idle. Strokes render incrementally into a temporary layer while drawing. The UI updates after a stroke, not on every pointer sample.
- Layers, composited frames, and tinted onion skins share a 32 MiB LRU pixel-cache budget. Thumbnails render in small time slices. Duplicate frames share immutable operations until edited. History retains up to 32 states, trimmed against an approximate 24 MiB budget of unique drawing/audio data.
- Canvas dimensions are independent of device pixel ratio. Presets are 960 × 600, 720 × 720, and 600 × 900. Files support dimensions up to 1280 per side, bounded to 1,228,800 pixels.
- Projects are bounded to 240 frames, 8 layers, 16,000 operations, 240,000 stroke points, 8 MiB of encoded imported pictures, 16 MiB of encoded recordings, and a 32 MiB editable file. Normal editing uses a conservative size estimate to keep saves reopenable. Frame cues are capped at 8. Video/WAV exports support up to three minutes; frame ZIPs cap PNG data at 64 MiB.
- The CPU benchmark measured 200 representative 960 × 600 drawing/compositing updates at a 3.60 ms median and 4.85 ms p95 in the build environment, with about 22 MiB of cached pixels. This is a native CPU canvas measurement, not a browser, GPU, or physical-device frame-rate guarantee.

## Files

- `dist/app.js`: editor UI, autosave, shelf, recording, and export flows.
- `dist/model.js`: immutable project operations, budgets, history, import validation, and timing.
- `dist/drawing.js`: textured brushes, compositing, flood fill, and bounded rendering caches.
- `dist/studio.js`: drawing gestures, pressure input, zoom, pan, and stroke previews.
- `dist/audio.js`: generated sound effects, cue playback, microphone lifecycle, and WAV mixing.
- `dist/export.js` and `dist/gif-worker.js`: downloadable projects, PNG/GIF/video/WAV/ZIP exports.
- `dist/storage.js`: transactional local collection.
- `dist/starter.js`: original editable starter artwork.
- `dist/style.css`: desktop, tablet, portrait/landscape phone, safe-area, keyboard-focus, and reduced-motion styles.

DM Sans is distributed under the SIL Open Font License (`dist/fonts/OFL.txt`). gifenc is distributed under MIT (`dist/vendor/GIFENC-LICENSE.md`).
