export const RF_APPS = {
  clai:       { id: 'clai',       name: 'CLAI',       url: 'https://clai.retrofleshed.com/',       accepts: ['clai', 'image'],                  desc: '3D clay studio' },
  masque:     { id: 'masque',     name: 'MASQUE',     url: 'https://masque.retrofleshed.com/',     accepts: ['model3d', 'image'], coopRelay: true, desc: '3D face & VTuber studio' },
  fotoe:      { id: 'fotoe',      name: 'Fotoe',      url: 'https://fotoe.retrofleshed.com/',      accepts: ['image'],                          desc: 'Photo editor' },
  soulcode:   { id: 'soulcode',   name: 'Soulcode',   url: 'https://soulcode.retrofleshed.com/',   accepts: ['image', 'model3d', 'audio'],      desc: '2D/3D game maker' },
  ripperclip: { id: 'ripperclip', name: 'RipperClip', url: 'https://ripperclip.retrofleshed.com/', accepts: ['video', 'image', 'audio'],        desc: 'Video studio' },
  flipbook:   { id: 'flipbook',   name: 'Flipbook',   url: 'https://flipbook.retrofleshed.com/',   accepts: ['image', 'audio'],                 desc: 'Animation studio' },
  glyphnote:  { id: 'glyphnote',  name: 'Glyphnote',  url: 'https://glyphnote.retrofleshed.com/',  accepts: ['audio'],                          desc: 'Music loop toy' },
  zaypen:     { id: 'zaypen',     name: 'Zaypen',     url: 'https://zaypen.retrofleshed.com/',     accepts: ['image'],                          desc: 'Kids drawing & piano pad' },
  generator:  { id: 'generator',  name: 'Generator',  url: 'https://generator.retrofleshed.com/',  accepts: ['model3d'],                        desc: 'Procedural 3D worlds' },
  littleloop: { id: 'littleloop', name: 'Littleloop', url: 'https://littleloop.retrofleshed.com/', accepts: ['video', 'image'],                 desc: 'Family memories hub' },
  petstudio:  { id: 'petstudio',  name: 'Pet Studio', url: 'https://petstudio.retrofleshed.com/',  accepts: ['image', 'audio'],                 desc: '3D creative pet studio' },
  lingrove:   { id: 'lingrove',   name: 'Lingrove',   url: 'https://lingrove.retrofleshed.com/',   accepts: ['audio', 'json'],                  desc: 'Bilingual lesson studio' },
};

export function isTrustedRfOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  if (typeof location !== 'undefined' && location?.origin && origin === location.origin) return true;
  return /^https:\/\/([a-z0-9-]+\.)?retrofleshed\.com$/i.test(origin) ||
         /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

function openRfInboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('rf-bridge-inbox-v1', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('packets')) {
        req.result.createObjectStore('packets', { keyPath: 'token' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readAndDeleteRfInbox(token) {
  if (!token || typeof indexedDB === 'undefined') return null;
  const db = await openRfInboxDb();
  return new Promise((resolve) => {
    const tx = db.transaction('packets', 'readwrite');
    const store = tx.objectStore('packets');
    const getReq = store.get(token);
    getReq.onsuccess = () => {
      const val = getReq.result || null;
      if (val) store.delete(token);
      resolve(val);
    };
    getReq.onerror = () => resolve(null);
  });
}

export function resolveRfAppUrl(targetAppId, sourceAppId, kind, role = '', token = '') {
  const entry = RF_APPS[targetAppId];
  if (!entry) throw new Error(`Unknown app: ${targetAppId}`);
  let base = entry.url;
  try {
    if (typeof localStorage !== 'undefined') {
      const map = JSON.parse(localStorage.getItem('rf_app_urls') || 'null');
      if (map && typeof map[targetAppId] === 'string' && map[targetAppId]) {
        base = map[targetAppId];
      }
    }
  } catch {}
  const baseHref = (typeof location !== 'undefined' && typeof location?.href === 'string' && location.href)
    ? location.href
    : 'https://retrofleshed.com/';
  const u = new URL(base, baseHref);
  if (entry.coopRelay) {
    u.pathname = u.pathname.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/rf-relay.html');
  }
  u.searchParams.set('rf_import', '1');
  if (sourceAppId) u.searchParams.set('rf_from', sourceAppId);
  if (kind) u.searchParams.set('rf_kind', kind);
  if (role) u.searchParams.set('rf_role', role);
  if (token) u.searchParams.set('rf_token', token);
  return u.toString();
}

export function bytesToBase64Url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function hasPendingRfImport(loc = globalThis.location) {
  const search = String(loc?.search ?? '');
  const hash = String(loc?.hash ?? '');
  if (hash.includes('rf_b64=')) return true;
  if (!search) return false;
  const params = new URLSearchParams(search);
  return params.get('rf_import') === '1' || Boolean(params.get('rf_inbox')) || Boolean(params.get('rf_token'));
}

export async function sendToRfApp(opts) {
  const token = 'rf_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  const targetUrl = resolveRfAppUrl(opts.to, opts.from, opts.kind, opts.role || '', token);
  const targetOrigin = new URL(targetUrl).origin;
  const isolatedSender = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  let win = null;
  let childReady = false;
  let acked = false;
  let sendCount = 0;
  let retryTimer = null;
  let message = null;
  let ab = null;
  let resolveHandshake = null;

  const cleanup = () => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', onMessage);
    }
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  };

  const pushPayload = () => {
    if (acked || !win || !message || !ab) return;
    sendCount++;
    try {
      win.postMessage({ ...message, bytes: ab.slice(0) }, targetOrigin);
    } catch {}
  };

  const startPushing = () => {
    if (acked || !win || !message || !ab) return;
    pushPayload();
    if (!retryTimer) {
      retryTimer = setInterval(() => {
        if (acked || sendCount >= 5) {
          clearInterval(retryTimer);
          retryTimer = null;
        } else {
          pushPayload();
        }
      }, 900);
      retryTimer?.unref?.();
    }
  };

  const onMessage = (ev) => {
    if (!ev.data || typeof ev.data !== 'object') return;
    if (ev.origin !== targetOrigin || ev.source !== win) return;
    if (ev.data.type === 'rf:ready' && (!ev.data.token || ev.data.token === token)) {
      childReady = true;
      if (message && ab) startPushing();
    } else if (ev.data.type === 'rf:ack' && (ev.data.token === token)) {
      acked = true;
      cleanup();
      opts.onStatus?.(`Sent to ${RF_APPS[opts.to]?.name || opts.to}!`);
      resolveHandshake?.({ delivered: true, fallback: false });
    }
  };

  if (!isolatedSender && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', onMessage);
  }

  try {
    win = (!isolatedSender && typeof window !== 'undefined' && typeof window.open === 'function')
      ? window.open(targetUrl, '_blank')
      : null;
  } catch {
    win = null;
  }

  let raw;
  try {
    raw = await opts.producePayload();
  } catch (err) {
    cleanup();
    throw err;
  }
  let blob;
  const mime = raw.mime || (raw.blob && raw.blob.type) || 'application/octet-stream';
  if (raw.bytes instanceof ArrayBuffer) {
    ab = raw.bytes;
    blob = raw.blob || new Blob([ab], { type: mime });
  } else if (ArrayBuffer.isView(raw.bytes)) {
    ab = raw.bytes.buffer.slice(raw.bytes.byteOffset, raw.bytes.byteOffset + raw.bytes.byteLength);
    blob = raw.blob || new Blob([ab], { type: mime });
  } else if (raw.blob instanceof Blob) {
    blob = raw.blob;
    ab = await raw.blob.arrayBuffer();
  } else {
    cleanup();
    throw new Error('producePayload must return blob or bytes');
  }
  const safeName = String(raw.name || 'asset').replace(/[^a-zA-Z0-9._ -]/g, '_');

  message = {
    type: 'rf:import',
    version: 1,
    token,
    from: opts.from,
    to: opts.to,
    kind: opts.kind,
    role: opts.role || '',
    name: safeName,
    mime,
    bytes: ab,
    meta: raw.meta || {},
  };

  try {
    const bc = new BroadcastChannel('retrofleshed-bridge-v1');
    bc.unref?.();
    bc.postMessage(message);
    setTimeout(() => bc.close(), 2000)?.unref?.();
  } catch {}

  if (isolatedSender) {
    cleanup();
    if (ab.byteLength <= 1200 * 1024) {
      const header = encodeURIComponent(JSON.stringify({ token, from: opts.from, to: opts.to, kind: opts.kind, role: opts.role || '', name: safeName, mime }));
      const b64 = bytesToBase64Url(ab);
      const baseDirect = resolveRfAppUrl(opts.to, opts.from, opts.kind, opts.role || '', token).replace(/\/rf-relay\.html(\?|$)/, '/$1');
      const hashUrl = baseDirect + '#rf_meta=' + header + '&rf_b64=' + b64;
      const w2 = typeof window !== 'undefined' && typeof window.open === 'function' ? window.open(hashUrl, '_blank') : null;
      if (w2) {
        opts.onStatus?.(`Sent to ${RF_APPS[opts.to]?.name || opts.to}!`);
        return { delivered: true, fallback: false };
      }
    }
    try {
      const db = await openRfInboxDb();
      await new Promise((res, rej) => {
        const tx = db.transaction('packets', 'readwrite');
        tx.objectStore('packets').put({ ...message, targetUrl, savedAt: Date.now() });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      const baseHref = (typeof location !== 'undefined' && typeof location?.href === 'string' && location.href)
        ? location.href
        : 'https://retrofleshed.com/';
      const relayOut = new URL('./rf-relay.html', baseHref);
      relayOut.searchParams.set('rf_outbox', token);
      const wRelay = typeof window !== 'undefined' && typeof window.open === 'function' ? window.open(relayOut.toString(), '_blank') : null;
      if (wRelay) {
        opts.onStatus?.(`Sending ${safeName} to ${RF_APPS[opts.to]?.name || opts.to}…`);
        return { delivered: true, fallback: false };
      }
    } catch {}
    if (opts.onFallbackDownload) opts.onFallbackDownload(blob, safeName, 'isolated-large');
    else triggerDownload(blob, safeName);
    try { window.open(RF_APPS[opts.to]?.url || targetUrl, '_blank'); } catch {}
    opts.onStatus?.(`Saved ${safeName} and opened ${RF_APPS[opts.to]?.name || opts.to} — drop it right in!`);
    return { delivered: false, fallback: true };
  }

  if (!win) {
    cleanup();
    if (opts.onFallbackDownload) opts.onFallbackDownload(blob, safeName, 'popup-blocked');
    else triggerDownload(blob, safeName);
    opts.onStatus?.(`Saved ${safeName} — open ${RF_APPS[opts.to]?.name || opts.to} and drop it in!`);
    return { delivered: false, fallback: true };
  }

  if (acked) {
    return { delivered: true, fallback: false };
  }

  return new Promise((resolve) => {
    resolveHandshake = resolve;
    if (childReady) startPushing();
    setTimeout(() => {
      if (!acked) {
        cleanup();
        resolve({ delivered: sendCount > 0, fallback: false });
      }
    }, 30000)?.unref?.();
  });
}

export function triggerDownload(blob, filename) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000)?.unref?.();
}

export function installRfImportReceiver({ appId, accepts, onImport }) {
  const seenTokens = new Set();
  const pending = hasPendingRfImport();

  const handlePacket = async (data, replySource, replyOrigin) => {
    if (!data || data.type !== 'rf:import') return;
    if (data.to && data.to !== appId) return;
    if (accepts && accepts.length && data.kind && !accepts.includes(data.kind)) return;
    const tok = data.token || '';
    if (tok && seenTokens.has(tok)) {
      try { replySource?.postMessage({ type: 'rf:ack', token: tok, app: appId }, replyOrigin || '*'); } catch {}
      return;
    }
    let ab = null;
    if (data.bytes instanceof ArrayBuffer) ab = data.bytes;
    else if (ArrayBuffer.isView(data.bytes)) ab = data.bytes.buffer.slice(data.bytes.byteOffset, data.bytes.byteLength + data.bytes.byteOffset);
    else if (data.blob instanceof Blob) ab = await data.blob.arrayBuffer();
    if (!ab || ab.byteLength === 0 || ab.byteLength > 210 * 1024 * 1024) return;

    if (tok) seenTokens.add(tok);
    const safeName = String(data.name || 'imported-file').replace(/[^a-zA-Z0-9._ -]/g, '_');
    const mime = String(data.mime || 'application/octet-stream');
    const blob = new Blob([ab], { type: mime });
    const file = new File([blob], safeName, { type: mime });

    try {
      replySource?.postMessage({ type: 'rf:ack', token: tok, app: appId }, replyOrigin || '*');
    } catch {}

    await onImport({
      file,
      blob,
      bytes: ab,
      name: safeName,
      mime,
      kind: String(data.kind || ''),
      role: String(data.role || ''),
      from: String(data.from || ''),
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
    });
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.type !== 'rf:import') return;
      if (!isTrustedRfOrigin(ev.origin)) return;
      void handlePacket(ev.data, ev.source, '*');
    });
  }

  try {
    const bc = new BroadcastChannel('retrofleshed-bridge-v1');
    bc.unref?.();
    bc.addEventListener('message', (ev) => {
      if (ev.data?.type === 'rf:import' && ev.data?.to === appId) {
        void handlePacket(ev.data, null, '*');
      }
    });
  } catch {}

  const searchStr = String(globalThis.location?.search ?? '');
  const params = new URLSearchParams(searchStr);
  const inboxToken = params.get('rf_inbox') || '';
  if (inboxToken) {
    void readAndDeleteRfInbox(inboxToken).then((pkt) => {
      if (pkt) void handlePacket({ ...pkt, type: 'rf:import' }, null, '*');
    });
  }

  const hashStr = String(globalThis.location?.hash ?? '');
  if (hashStr.includes('rf_b64=')) {
    try {
      const hp = new URLSearchParams(hashStr.slice(1));
      const metaRaw = hp.get('rf_meta');
      const b64 = hp.get('rf_b64');
      if (metaRaw && b64) {
        const meta = JSON.parse(decodeURIComponent(metaRaw));
        const bytes = base64UrlToBytes(b64);
        if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
          history.replaceState(history.state, '', String(globalThis.location?.pathname ?? '/') + searchStr);
        }
        void handlePacket({ ...meta, type: 'rf:import', bytes }, null, '*');
      }
    } catch {}
  }

  const token = params.get('rf_token') || '';
  if (typeof window !== 'undefined' && window.opener && (params.get('rf_import') === '1' || token)) {
    const announce = () => {
      try {
        window.opener.postMessage({ type: 'rf:ready', app: appId, token }, '*');
      } catch {}
    };
    announce();
    setTimeout(announce, 250)?.unref?.();
    setTimeout(announce, 900)?.unref?.();
  }

  if (params.get('rf_import') === '1' || inboxToken || token) {
    try {
      if (typeof history !== 'undefined' && typeof history.replaceState === 'function' && globalThis.location?.href) {
        const clean = new URL(globalThis.location.href);
        ['rf_import', 'rf_from', 'rf_kind', 'rf_role', 'rf_token', 'rf_inbox'].forEach(k => clean.searchParams.delete(k));
        history.replaceState(history.state, '', clean.pathname + clean.search + clean.hash);
      }
    } catch {}
  }

  return { pending, handlePacket };
}

export function targetsForKind(kind, excludeAppId = '') {
  return Object.values(RF_APPS).filter(a => a.id !== excludeAppId && a.accepts.includes(kind));
}
