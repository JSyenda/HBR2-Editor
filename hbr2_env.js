// hbr2_env.js — Entorno de navegador mínimo que exige el motor game-min_patched.js.
// Cargar ANTES que merge_core.js en Node: instala sobre globalThis window, document y
// navigator, y expone { game, pako } vía globalThis. En navegador/worker no hace falta.
// merge_core.js y los harness reemplazan window.performance.now() por su propio reloj.
'use strict';
const path = require('path');
const DIR = __dirname;

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
global.window = {
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
  navigator: { storage: { persist: () => Promise.resolve(false), persisted: () => Promise.resolve(false) } },
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  Blob: function () {}, FileReader: function () {}, Event: function () {}, CustomEvent: function () {},
  console, addEventListener() {}, removeEventListener() {},
};
global.document = window.document;
try { global.navigator = window.navigator; } catch (e) {}
global.PerfectScrollbar = function () {};
global.Image = function () {};
global.pako = require(path.join(DIR, 'pako.min.js'));
try { global.JSON5 = require('json5'); } catch (e) {}

const game = require(path.join(DIR, 'game-min_patched.js'));
if (!game.p.wj || game.p.wj.size === 0) game.Nc.xj();
if (game.p.wj.size !== 24) throw new Error('Registro de acciones inesperado: ' + game.p.wj.size);
global.game = game;

module.exports = { game, pako: global.pako };
