export const LIMITS = Object.freeze({ frames: 240, layers: 8, operations: 16000, points: 240000, fileBytes: 32 * 1024 * 1024, audioBytes: 16 * 1024 * 1024, imageBytes: 8 * 1024 * 1024 });
export const BRUSHES = Object.freeze({
  pen: { name: 'Ink pen', hint: 'Smooth, confident lines', size: 7 },
  pencil: { name: 'Pencil', hint: 'Soft, sketchy little lines', size: 5 },
  marker: { name: 'Marker', hint: 'Big, bold strokes', size: 22 },
  crayon: { name: 'Crayon', hint: 'A lovely bit of texture', size: 18 },
  watercolor: { name: 'Watercolor', hint: 'Soft washes that build up', size: 38 },
  airbrush: { name: 'Airbrush', hint: 'A gentle cloud of color', size: 50 },
  neon: { name: 'Glow pen', hint: 'A little electric magic', size: 10 },
  pixel: { name: 'Pixel pen', hint: 'Perfect little blocks', size: 12 },
  eraser: { name: 'Eraser', hint: 'Make a little room', size: 28 }
});
export const SFX = ['pop', 'boing', 'sparkle', 'whoosh', 'drum', 'chirp'];
export const PALETTE = ['#32243f','#70607d','#ffffff','#d6c9b9','#f56e53','#ffad57','#f4d768','#a8c96d','#55b9a0','#338da3','#6485d5','#a58bd6','#df86b2','#995c52'];
let sequence = 0;
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `fb-${Date.now().toString(36)}-${++sequence}`;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function blankFrame(layers, cells) {
  return { id: uid(), hold: 1, cells: cells ?? Object.fromEntries(layers.map(l => [l.id, []])), cues: [] };
}
export function newProject(width = 960, height = 600) {
  const layers = [{ id: uid(), name: 'Sketch', visible: true, opacity: 1 }, { id: uid(), name: 'Color', visible: true, opacity: 1 }];
  return { format: 'flipbook', version: 1, id: uid(), title: 'My little flipbook', width, height, fps: 8, background: '#fffdf7', loop: true, layers, frames: [blankFrame(layers)], recordings: {} };
}
export function updateFrame(p, index, update) {
  return { ...p, frames: p.frames.map((f, i) => i === index ? { ...f, ...update } : f) };
}
export function appendOperation(p, index, layer, operation) {
  if (!p.layers.some(l => l.id === layer)) throw new Error('Choose a drawing layer.');
  const frame = p.frames[index];
  return updateFrame(p, index, { cells: { ...frame.cells, [layer]: [...frame.cells[layer], { ...operation, id: uid() }] } });
}
export function insertFrame(p, index, duplicate = false) {
  if (p.frames.length >= LIMITS.frames) throw new Error(`This flipbook is full! Start another after ${LIMITS.frames} frames.`);
  const frame = duplicate ? { ...p.frames[index], id: uid(), cues: [...p.frames[index].cues] } : blankFrame(p.layers);
  const frames = [...p.frames]; frames.splice(index + 1, 0, frame);
  return { ...p, frames };
}
export function removeFrame(p, index) {
  if (p.frames.length === 1) return updateFrame(p, 0, blankFrame(p.layers));
  return { ...p, frames: p.frames.filter((_, i) => i !== index) };
}
export function moveFrame(p, from, to) {
  if (to < 0 || to >= p.frames.length) return p;
  const frames = [...p.frames]; const [frame] = frames.splice(from, 1); frames.splice(to, 0, frame);
  return { ...p, frames };
}
export function addLayer(p) {
  if (p.layers.length >= LIMITS.layers) throw new Error('Eight layers is the limit for this flipbook.');
  const layer = { id: uid(), name: `Layer ${p.layers.length + 1}`, visible: true, opacity: 1 };
  return { ...p, layers: [layer, ...p.layers], frames: p.frames.map(f => ({ ...f, cells: { ...f.cells, [layer.id]: [] } })) };
}
export function removeLayer(p, id) {
  if (p.layers.length === 1) throw new Error('Keep one layer to draw on.');
  return { ...p, layers: p.layers.filter(l => l.id !== id), frames: p.frames.map(f => ({ ...f, cells: Object.fromEntries(Object.entries(f.cells).filter(([k]) => k !== id)) })) };
}
export function timeline(p) {
  let end = 0;
  return p.frames.map((f, index) => { const start = end; end += f.hold / p.fps; return { index, id: f.id, start, end, duration: end - start }; });
}
export function frameAtTime(p, time) {
  const list = timeline(p), duration = list.at(-1).end;
  const t = p.loop ? ((time % duration) + duration) % duration : clamp(time, 0, duration - 1e-9);
  return list.find(f => t < f.end)?.index ?? 0;
}
// History shares immutable operations; the budget counts unique strokes and assets.
export class History {
  constructor(limit = 32, budget = 24 * 1024 * 1024) { this.past = []; this.future = []; this.limit = limit; this.budget = budget; }
  push(project) { this.past.push(project); this.future = []; while (this.past.length > this.limit || (this.past.length > 1 && historyBytes(this.past) > this.budget)) this.past.shift(); }
  undo(current) { if (!this.past.length) return current; this.future.push(current); return this.past.pop(); }
  redo(current) { if (!this.future.length) return current; this.past.push(current); return this.future.pop(); }
  clear() { this.past = []; this.future = []; }
}
function historyBytes(projects) {
  let size = 0; const seen = new Set();
  for (const p of projects) {
    for (const f of p.frames) for (const ops of Object.values(f.cells)) for (const op of ops) if (!seen.has(op)) { seen.add(op); size += 100 + (op.points?.length ?? 0) * 24 + (op.src?.length ?? 0) * 2; }
    for (const r of Object.values(p.recordings)) if (!seen.has(r)) { seen.add(r); size += r.data.length * 2; }
  }
  return size;
}
const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const integer = (v, min, max) => Number.isInteger(v) && number(v, min, max);
function requireValue(ok, message = 'That file is not a valid Flipbook project.') { if (!ok) throw new Error(message); }
export function validateProject(input) {
  requireValue(input && typeof input === 'object' && input.format === 'flipbook' && input.version === 1);
  const p = input;
  requireValue(integer(p.width, 64, 1280) && integer(p.height, 64, 1280) && p.width * p.height <= 1280 * 960);
  requireValue(typeof p.title === 'string' && p.title.length <= 80 && color(p.background) && integer(p.fps, 1, 30) && typeof p.loop === 'boolean');
  requireValue(Array.isArray(p.layers) && p.layers.length > 0 && p.layers.length <= LIMITS.layers);
  requireValue(Array.isArray(p.frames) && p.frames.length > 0 && p.frames.length <= LIMITS.frames);
  const ids = new Set();
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
  for (const l of p.layers) { requireValue(validId(l.id) && !ids.has(l.id) && typeof l.name === 'string' && l.name.length <= 40 && typeof l.visible === 'boolean' && number(l.opacity, 0, 1)); ids.add(l.id); }
  const recordings = Object.create(null); let audioBytes = 0;
  requireValue(p.recordings && typeof p.recordings === 'object' && !Array.isArray(p.recordings));
  for (const [id, r] of Object.entries(p.recordings)) {
    requireValue(validId(id) && r && typeof r.name === 'string' && r.name.length <= 60 && number(r.duration, 0.01, 30));
    requireValue(typeof r.data === 'string' && /^data:audio\/(webm|ogg|mp4|wav)(;codecs=[a-z0-9.,-]+)?;base64,[a-zA-Z0-9+/=]+$/.test(r.data));
    audioBytes += r.data.length; requireValue(audioBytes <= LIMITS.audioBytes, 'There is too much recorded sound in this file.');
    recordings[id] = { name: r.name, duration: r.duration, data: r.data };
  }
  let opCount = 0, pointCount = 0, imageBytes = 0; const frameIds = new Set();
  const coord = a => Array.isArray(a) && a.length === 2 && a.every(v => number(v, -8192, 8192));
  const frames = p.frames.map(f => {
    requireValue(validId(f.id) && !frameIds.has(f.id) && integer(f.hold, 1, 24)); frameIds.add(f.id);
    requireValue(f.cells && Object.keys(f.cells).length === ids.size && Object.keys(f.cells).every(id => ids.has(id)));
    const cells = Object.create(null);
    for (const id of ids) {
      const ops = f.cells[id]; requireValue(Array.isArray(ops));
      cells[id] = ops.map(op => {
        requireValue(++opCount <= LIMITS.operations && op && validId(op.id));
        if (op.kind === 'stroke') {
          requireValue(Object.hasOwn(BRUSHES, op.brush) && color(op.color) && number(op.size, 1, 160) && number(op.opacity, 0.01, 1));
          requireValue(Array.isArray(op.points) && op.points.length > 0); pointCount += op.points.length; requireValue(pointCount <= LIMITS.points, 'This drawing has too many points to open safely.');
          requireValue(op.points.every(a => Array.isArray(a) && a.length === 3 && number(a[0], -8192, 8192) && number(a[1], -8192, 8192) && number(a[2], 0, 1)));
          return { id: op.id, kind: op.kind, brush: op.brush, color: op.color, size: op.size, opacity: op.opacity, points: op.points.map(a => [...a]) };
        }
        if (op.kind === 'shape') { requireValue(['line','rectangle','ellipse','star'].includes(op.shape) && coord(op.from) && coord(op.to) && color(op.color) && number(op.size, 1, 160) && number(op.opacity, .01, 1) && typeof op.fill === 'boolean'); return { id: op.id, kind: op.kind, shape: op.shape, from: [...op.from], to: [...op.to], color: op.color, size: op.size, opacity: op.opacity, fill: op.fill }; }
        if (op.kind === 'fill') { requireValue(coord(op.at) && color(op.color)); return { id: op.id, kind: op.kind, at: [...op.at], color: op.color }; }
        if (op.kind === 'text') { requireValue(typeof op.text === 'string' && op.text.length <= 200 && coord(op.at) && number(op.size, 8, 160) && color(op.color)); return { id: op.id, kind: op.kind, text: op.text, at: [...op.at], size: op.size, color: op.color }; }
        if (op.kind === 'transform') { requireValue(coord(op.offset)); return { id: op.id, kind: op.kind, offset: [...op.offset] }; }
        if (op.kind === 'image') {
          requireValue(coord(op.at) && number(op.width, 1, 1280) && number(op.height, 1, 1280) && typeof op.src === 'string' && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(op.src));
          imageBytes += op.src.length; requireValue(imageBytes <= LIMITS.imageBytes, 'This file contains too many imported pictures.');
          return { id: op.id, kind: op.kind, at: [...op.at], width: op.width, height: op.height, src: op.src };
        }
        throw new Error('This project contains an unknown drawing tool.');
      });
    }
    requireValue(Array.isArray(f.cues) && f.cues.length <= 8);
    const cues = f.cues.map(c => { requireValue(c && (SFX.includes(c.sound) || Object.hasOwn(recordings, c.sound)) && number(c.volume, 0, 1)); return { sound: c.sound, volume: c.volume }; });
    return { id: f.id, hold: f.hold, cells, cues };
  });
  return { format:'flipbook', version:1, id: validId(p.id) ? p.id : uid(), title:p.title, width:p.width, height:p.height, fps:p.fps, background:p.background, loop:p.loop, layers:p.layers.map(l=>({id:l.id,name:l.name,visible:l.visible,opacity:l.opacity})), frames, recordings };
}
export function parseProject(text) {
  requireValue(typeof text === 'string' && text.length <= LIMITS.fileBytes, 'That file is too large. Flipbook files can be up to 32 MB.');
  let input; try { input = JSON.parse(text); } catch { throw new Error('That file could not be read. Choose a .flipbook file.'); }
  return validateProject(input);
}
export function projectUsage(p) {
  let operations = 0, points = 0, imageBytes = 0, textBytes = 0;
  for (const f of p.frames) for (const ops of Object.values(f.cells)) { operations += ops.length; for (const op of ops) { points += op.points?.length ?? 0; imageBytes += op.src?.length ?? 0; textBytes += (op.text?.length ?? 0) * 6; } }
  const audioBytes=Object.values(p.recordings).reduce((n,r)=>n+r.data.length,0);
  return { operations, points, imageBytes, audioBytes, estimatedBytes: operations*300+points*72+imageBytes+audioBytes+textBytes+p.frames.length*p.layers.length*100 };
}
