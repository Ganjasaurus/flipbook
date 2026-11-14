import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RF_APPS,
  isTrustedRfOrigin,
  resolveRfAppUrl,
  sendToRfApp,
  installRfImportReceiver,
  bytesToBase64Url,
  base64UrlToBytes,
  targetsForKind,
} from '../dist/rf-bridge.js';
import { AudioStudio, encodeAudioBufferToRecording } from '../dist/audio.js';
import { newProject, validateProject } from '../dist/model.js';

test('rf-bridge resolves live URLs, MASQUE coopRelay, and survives minimal globalThis.location', () => {
  const prevLoc = globalThis.location;
  try {
    globalThis.location = { protocol: 'http:' };
    const soulUrl = resolveRfAppUrl('soulcode', 'flipbook', 'image', 'sprite', 'tok_1');
    assert.equal(
      soulUrl,
      'https://soulcode.retrofleshed.com/?rf_import=1&rf_from=flipbook&rf_kind=image&rf_role=sprite&rf_token=tok_1'
    );

    const masqueUrl = resolveRfAppUrl('masque', 'flipbook', 'image', 'mouth', 'tok_2');
    assert.equal(
      masqueUrl,
      'https://masque.retrofleshed.com/rf-relay.html?rf_import=1&rf_from=flipbook&rf_kind=image&rf_role=mouth&rf_token=tok_2'
    );

    assert.equal(isTrustedRfOrigin('https://fotoe.retrofleshed.com'), true);
    assert.equal(isTrustedRfOrigin('http://localhost:5173'), true);
    assert.equal(isTrustedRfOrigin('https://evil.example.com'), false);

    const audioTargets = targetsForKind('audio', 'flipbook').map((a) => a.id);
    assert.ok(audioTargets.includes('ripperclip'));
    assert.ok(audioTargets.includes('glyphnote'));
    assert.ok(audioTargets.includes('soulcode'));
  } finally {
    globalThis.location = prevLoc;
  }
});

test('installRfImportReceiver for flipbook accepts image & audio, rejects unsupported kinds, and works with minimal location', async () => {
  const prevWin = globalThis.window;
  const prevLoc = globalThis.location;
  const listeners = new Map();
  globalThis.location = { protocol: 'http:' };
  globalThis.window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
  };

  try {
    const received = [];
    const acks = [];
    installRfImportReceiver({
      appId: 'flipbook',
      accepts: ['image', 'audio'],
      onImport: async (item) => {
        received.push(item);
      },
    });

    const msgListeners = listeners.get('message') || [];
    assert.equal(msgListeners.length, 1);
    const fakeSource = { postMessage(msg) { acks.push(msg); } };

    // Unsupported kind ignored
    msgListeners[0]({
      origin: 'https://clai.retrofleshed.com',
      source: fakeSource,
      data: {
        type: 'rf:import',
        token: 'tok_3d',
        from: 'clai',
        to: 'flipbook',
        kind: 'model3d',
        name: 'clay.glb',
        mime: 'model/gltf-binary',
        bytes: new Uint8Array([1, 2, 3, 4]).buffer,
      },
    });

    // Image accepted
    msgListeners[0]({
      origin: 'https://fotoe.retrofleshed.com',
      source: fakeSource,
      data: {
        type: 'rf:import',
        token: 'tok_img',
        from: 'fotoe',
        to: 'flipbook',
        kind: 'image',
        role: 'layer',
        name: 'painted.png',
        mime: 'image/png',
        bytes: new Uint8Array([137, 80, 78, 71]).buffer,
      },
    });

    // Audio accepted
    msgListeners[0]({
      origin: 'https://glyphnote.retrofleshed.com',
      source: fakeSource,
      data: {
        type: 'rf:import',
        token: 'tok_wav',
        from: 'glyphnote',
        to: 'flipbook',
        kind: 'audio',
        role: 'cue',
        name: 'loop.wav',
        mime: 'audio/wav',
        bytes: new Uint8Array([82, 73, 70, 70]).buffer,
      },
    });

    // In-flight duplicate while onImport is running does not double-import
    msgListeners[0]({
      origin: 'https://glyphnote.retrofleshed.com',
      source: fakeSource,
      data: {
        type: 'rf:import',
        token: 'tok_wav',
        from: 'glyphnote',
        to: 'flipbook',
        kind: 'audio',
        name: 'loop.wav',
        mime: 'audio/wav',
        bytes: new Uint8Array([82, 73, 70, 70]).buffer,
      },
    });

    await new Promise((r) => setTimeout(r, 15));
    assert.equal(received.length, 2);
    assert.equal(acks.length, 2, 'rf:ack sent post-onImport once per completed import');

    // Post-import duplicate retry re-acks without double importing
    msgListeners[0]({
      origin: 'https://glyphnote.retrofleshed.com',
      source: fakeSource,
      data: {
        type: 'rf:import',
        token: 'tok_wav',
        from: 'glyphnote',
        to: 'flipbook',
        kind: 'audio',
        name: 'loop.wav',
        mime: 'audio/wav',
        bytes: new Uint8Array([82, 73, 70, 70]).buffer,
      },
    });

    await new Promise((r) => setTimeout(r, 15));
    assert.equal(received.length, 2);
    assert.equal(received[0].kind, 'image');
    assert.equal(received[0].name, 'painted.png');
    assert.equal(received[1].kind, 'audio');
    assert.equal(received[1].name, 'loop.wav');
    assert.equal(acks.length, 3);
  } finally {
    globalThis.window = prevWin;
    globalThis.location = prevLoc;
  }
});

test('sendToRfApp opens popup synchronously before async payload and completes handshake', async () => {
  const prevWin = globalThis.window;
  const prevLoc = globalThis.location;
  const listeners = new Map();
  let openedSync = false;
  let payloadStarted = false;
  const posted = [];

  const childWin = {
    postMessage(data) {
      posted.push(data);
      if (data?.type === 'rf:import') {
        queueMicrotask(() => {
          for (const fn of listeners.get('message') || []) {
            fn({
              origin: 'https://ripperclip.retrofleshed.com',
              source: childWin,
              data: { type: 'rf:ack', token: data.token, app: 'ripperclip' },
            });
          }
        });
      }
    },
  };

  globalThis.location = { protocol: 'https:', origin: 'https://flipbook.retrofleshed.com', href: 'https://flipbook.retrofleshed.com/' };
  globalThis.window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    open(url, target) {
      assert.equal(payloadStarted, false, 'window.open must run before async producePayload');
      assert.equal(target, '_blank');
      assert.match(url, /^https:\/\/ripperclip\.retrofleshed\.com\/\?rf_import=1/);
      openedSync = true;
      queueMicrotask(() => {
        for (const fn of listeners.get('message') || []) {
          fn({ origin: 'https://ripperclip.retrofleshed.com', source: childWin, data: { type: 'rf:ready', app: 'ripperclip' } });
        }
      });
      return childWin;
    },
  };

  try {
    const res = await sendToRfApp({
      from: 'flipbook',
      to: 'ripperclip',
      kind: 'image',
      role: 'media',
      producePayload: async () => {
        payloadStarted = true;
        await new Promise((r) => setTimeout(r, 15));
        return { blob: new Blob([new Uint8Array([71, 73, 70, 56])], { type: 'image/gif' }), name: 'bounce.gif', mime: 'image/gif' };
      },
    });
    assert.equal(openedSync, true);
    assert.equal(res.delivered, true);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].name, 'bounce.gif');
    assert.equal(posted[0].from, 'flipbook');
  } finally {
    globalThis.window = prevWin;
    globalThis.location = prevLoc;
  }
});

test('encodeAudioBufferToRecording downmixes stereo to mono, caps at 30s, and passes validateProject', async () => {
  // 1) Stereo downmix + WAV header + model validation
  const rate = 24000;
  const len = rate * 0.5;
  const left = new Float32Array(len).fill(0.8);
  const right = new Float32Array(len).fill(-0.2);
  const fakeStereoBuffer = {
    sampleRate: rate,
    length: len,
    duration: 0.5,
    numberOfChannels: 2,
    getChannelData: (ch) => (ch === 0 ? left : right),
  };

  const rec = await encodeAudioBufferToRecording(fakeStereoBuffer, 'boing-stereo-clip.mp3');
  assert.equal(rec.name, 'boing-stereo-clip');
  assert.equal(rec.duration, 0.5);
  assert.match(rec.data, /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/);

  const b64 = rec.data.slice('data:audio/wav;base64,'.length);
  const bytes = Buffer.from(b64, 'base64');
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE');
  // Mono channel count = 1 at offset 22
  assert.equal(bytes.readUInt16LE(22), 1);
  // Sample value ~0.3 * 32767 = ~9830
  const sample0 = bytes.readInt16LE(44);
  assert.ok(Math.abs(sample0 - Math.round(0.3 * 32767)) <= 2, `Expected ~9830, got ${sample0}`);

  const proj = newProject();
  const { id, ...record } = rec;
  proj.recordings[id] = record;
  proj.frames[0].cues.push({ sound: id, volume: 0.7 });
  const validated = validateProject(proj);
  assert.equal(validated.recordings[id].name, 'boing-stereo-clip');
  assert.equal(validated.frames[0].cues[0].sound, id);

  // 2) >30s duration cap
  const longRate = 8000;
  const longLen = longRate * 35; // 35 seconds
  const longMono = new Float32Array(longLen).fill(0.25);
  const fakeLongBuffer = {
    sampleRate: longRate,
    length: longLen,
    duration: 35,
    numberOfChannels: 1,
    getChannelData: () => longMono,
  };
  const capped = await encodeAudioBufferToRecording(fakeLongBuffer, 'very-long-song-name-'.repeat(5) + '.ogg');
  assert.equal(capped.duration, 30);
  assert.ok(capped.name.length <= 60);
  const proj2 = newProject();
  proj2.recordings[capped.id] = { name: capped.name, duration: capped.duration, data: capped.data };
  assert.doesNotThrow(() => validateProject(proj2));
});

test('AudioStudio.importFile decodes via AudioContext and returns valid WAV recording', async () => {
  const prevAC = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor() {
      this.state = 'running';
      this.sampleRate = 24000;
    }
    async decodeAudioData() {
      const arr = new Float32Array(2400).fill(0.4);
      return {
        sampleRate: 24000,
        length: 2400,
        duration: 0.1,
        numberOfChannels: 1,
        getChannelData: () => arr,
      };
    }
  };
  try {
    const studio = new AudioStudio();
    const fakeFile = new File([new Uint8Array([1, 2, 3, 4])], 'voice-note.m4a', { type: 'audio/mp4' });
    const rec = await studio.importFile(fakeFile);
    assert.equal(rec.name, 'voice-note');
    assert.equal(rec.duration, 0.1);
    assert.match(rec.data, /^data:audio\/wav;base64,/);
  } finally {
    globalThis.AudioContext = prevAC;
  }
});

test('flipbook sw.js, index.html, and app.js include all required rf-bridge & sound import wiring', async () => {
  const sw = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\.\/rf-bridge\.js'/);
  assert.match(sw, /ignoreSearch:\s*true/);
  assert.match(sw, /flipbook-static-v5/);
  assert.doesNotMatch(sw, /flipbook-static-v[34]/);

  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="sound-file"[^>]*accept="audio\/\*"/);
  assert.match(html, /<input type="file" id="project-file" hidden>/);
  assert.doesNotMatch(html, /id="project-file"[^>]*accept=/);

  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /id="import-sound"/);
  assert.match(app, /id="rf-sticker-png"/);
  for (const [fmt, target] of [
    ['video', 'ripperclip'],
    ['video', 'littleloop'],
    ['gif', 'ripperclip'],
    ['gif', 'littleloop'],
    ['png', 'fotoe'],
    ['png', 'soulcode'],
    ['png', 'masque'],
    ['png', 'zaypen'],
    ['wav', 'ripperclip'],
    ['wav', 'glyphnote'],
    ['wav', 'soulcode'],
  ]) {
    assert.match(app, new RegExp(`data-rf-format="${fmt}"\\s+data-rf-to="${target}"`));
  }
  assert.match(app, /data-rf-format="png"\s+data-rf-to="masque"\s+data-rf-role="mouth"/);
  assert.match(app, /text\/flipbook-frame/);
});
