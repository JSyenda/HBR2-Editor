// trim-worker.js — Web Worker que analiza y recorta un .hbr2 en segundo plano.
// Protocolo:
//   { id, action:'preview'|'save', bytes: ArrayBuffer, start, end }            -> trimReplay (+verify)
//   { id, action:'previewCut'|'saveCut', bytes: ArrayBuffer, start, end }      -> cutParts([start,end)) (+verify)
//   { id, action:'analysis', bytes: ArrayBuffer }                              -> analyzeReplay
//   { id, action:'inspect', bytes: ArrayBuffer }                               -> inspectReplay
//   { id, action:'saveParts', bytes: ArrayBuffer, removals:[[s,e]] }           -> cutParts (+verify)
//   -> { id, action, ok:true, ...resultado, verify } | { id, action, ok:false, error }
'use strict';

// ---------- stubs de navegador mínimos que exige game-min_patched.js ----------
// (el mismo patrón que merge-worker.js y hbr2_env.js; aquí el "entorno" es el worker).
function makeCtx() {
  const target = {
    createPattern: () => ({}), createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: (t) => ({ width: String(t == null ? '' : t).length * 10 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    putImageData() {}, setLineDash() {}, getLineDash: () => [], clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, arc() {}, arcTo() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, resetTransform() {},
    setTransform() {}, drawImage() {}, fillText() {}, strokeText() {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; return t[p] || (() => {}); }, set(t, p, v) { t[p] = v; return true; } });
}
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), nodeType: 1, _hook: null, _hooks: null, _children: [], _innerHTML: '',
    style: { setProperty() {} }, hidden: false, disabled: false, value: '', textContent: '', maxLength: Infinity,
    selectedIndex: 0, className: '', offsetLeft: 0, clientWidth: 300, clientHeight: 20,
    firstChild: null, firstElementChild: null, files: [], options: [], width: 0, height: 0,
    classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; }, toggle(c) { this._s[c] ? delete this._s[c] : (this._s[c] = 1); }, contains(c) { return !!this._s[c]; } },
    appendChild(c) { c.parentElement = el; el._children.push(c); if (!el.firstChild) el.firstChild = c; if (!el.firstElementChild) el.firstElementChild = c; return c; },
    removeChild(c) { el._children = el._children.filter(x => x !== c); if (el.firstChild === c) el.firstChild = null; if (el.firstElementChild === c) el.firstElementChild = null; return c; },
    insertBefore(n) { el.appendChild(n); return n; },
    remove() { if (el.parentElement) el.parentElement.removeChild(el); },
    querySelector() { return makeEl('div'); },
    querySelectorAll(sel) { if (sel === '[data-hook]' && el._hooks) return el._hooks.map(h => h.el); return []; },
    getAttribute(a) { if (a === 'data-hook') return el._hook; return null; },
    setAttribute() {}, removeAttribute() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 300, height: 20, bottom: 20, right: 300 }; },
    getContext() { return el._ctx; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, select() {}, click() {},
    contains() { return false; }, setSelectionRange() {},
    append(...n) { n.forEach(x => el.appendChild(x)); },
  };
  el._ctx = makeCtx();
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) { el._innerHTML = v; if (typeof v === 'string' && v.indexOf('data-hook') >= 0) { const h = makeEl('div'); h._hook = 'x'; el._children = [h]; el.firstChild = h; el.firstElementChild = h; } }
  });
  return el;
}

const _topObj = {};
const localStorageStub = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
self.window = {
  self: _topObj, top: _topObj,
  performance: { now: () => 0 }, devicePixelRatio: 1,
  localStorage: localStorageStub, sessionStorage: localStorageStub,
  document: {
    createElement: (t) => makeEl(t), createTextNode: () => ({}), getElementById: () => null,
    body: makeEl('body'), head: makeEl('head'), addEventListener() {}, removeEventListener() {},
  },
  location: { search: '' },
  setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  AudioContext: function () { this.createGain = () => ({ connect() {}, gain: { value: 0 } }); this.createBufferSource = () => ({ connect() {}, start() {} }); },
  crypto: { subtle: { sign: () => Promise.resolve(new ArrayBuffer(0)), verify: () => Promise.resolve(false), generateKey: () => Promise.resolve({ privateKey: null, publicKey: null }), exportKey: () => Promise.resolve({}), importKey: () => Promise.resolve(null) }, getRandomValues: (a) => a },
  navigator: globalThis.navigator,
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  Blob: function () {}, FileReader: function () {}, Event: function () {}, CustomEvent: function () {},
  console, addEventListener() {}, removeEventListener() {},
};
self.document = self.window.document;
self.PerfectScrollbar = function () {};
self.Image = function () {};

importScripts('pako.min.js');
if (!self.pako && self.window && self.window.pako) self.pako = self.window.pako;
importScripts('game-min_patched.js');
self.game = self.window._pxy_mod;
if (!self.game.p.wj || self.game.p.wj.size === 0) self.game.Nc.xj();
if (self.game.p.wj.size !== 24) throw new Error('Registro de acciones inesperado: ' + self.game.p.wj.size);
importScripts('merge_core.js');

self.onmessage = function (e) {
  const msg = e.data || {};
  function post(d, transfer) {
    const out = { id: msg.id, action: msg.action };
    for (const k in d) out[k] = d[k];
    self.postMessage(out, transfer || []);
  }
  try {
    const bytes = new Uint8Array(msg.bytes);
    if (msg.action === 'analysis') {
      const an = self.mergeCore.analyzeReplay(bytes);
      post({ ok: true, dur: an.dur, parts: an.parts, markers: an.markers });
      return;
    }
    if (msg.action === 'inspect') {
      post({ ok: true, info: self.mergeCore.inspectReplay(bytes) });
      return;
    }
    if (msg.action === 'saveParts') {
      const out = self.mergeCore.cutParts(bytes, msg.removals || []);
      const verify = self.mergeCore.verifyCut(bytes, msg.removals || [], out);
      post({ ok: true, size: out.length, bytes: out.buffer, verify }, [out.buffer]);
      return;
    }
    if (msg.action === 'saveCut' || msg.action === 'previewCut') {
      const out = self.mergeCore.cutParts(bytes, [[msg.start, msg.end]]);
      const verify = self.mergeCore.verifyCut(bytes, [[msg.start, msg.end]], out);
      post({ ok: true, size: out.length, bytes: out.buffer, verify }, [out.buffer]);
      return;
    }
    const out = self.mergeCore.trimReplay(bytes, msg.start, msg.end);
    const verify = self.mergeCore.verifyTrim(bytes, msg.start, msg.end, out);
    post({ ok: true, size: out.length, bytes: out.buffer, verify }, [out.buffer]);
  } catch (err) {
    post({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
