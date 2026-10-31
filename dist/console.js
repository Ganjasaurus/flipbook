// Xbox One support (Edge on the console): the shared console kit plus Flipbook's console-only touches.
// The kit marks <html> with `console-kit` on the console only (style.css holds the TV sizes for it). Everything after
// start() runs only when isConsole() is true; other devices get nothing but the kit's pad listener.
import { isConsole, start } from './console-kit.js';

start({ card: false }); // Flipbook works with Edge's cursor, so no "Use game controls" card.

const NOTE_KEY = 'flipbook.consoleNote.v1';

function noteDismissed() { try { return localStorage.getItem(NOTE_KEY) === '1'; } catch { return false; } }

function showNote() {
  if (noteDismissed()) return;
  const note = document.createElement('div');
  note.className = 'console-note';
  note.setAttribute('role', 'note');
  note.innerHTML = '<p><strong>Flipbook works best on a computer or tablet:</strong> drawing needs a mouse, pen or finger. Your flipbooks save on this Xbox as you go, in My flipbooks.</p><button type="button" class="button mint">Got it</button>';
  // B on the controller sends Escape: let it close the note before it leaves the page (dialogs close themselves).
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); close(); } };
  const close = () => {
    note.remove();
    document.removeEventListener('keydown', onKey, true);
    try { localStorage.setItem(NOTE_KEY, '1'); } catch { /* private mode: the note shows again next visit */ }
  };
  note.querySelector('button').addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(note);
}

if (isConsole()) showNote();
