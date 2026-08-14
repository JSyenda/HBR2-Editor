// smoke_trim.js — Smoke test de Fase 1: recorte [start, end) con trimReplay.
// Carga el entorno (stub de window), pako, el motor patcheado y merge_core, recorta un
// .hbr2 de ejemplo y verifica que el resultado es un .hbr2 válido (cabecera y duración)
// y que el motor patcheado lo carga y reproduce. Para recortes por el INICIO (start=0)
// verifica además paridad lockstep con el original en el tramo común.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
let _now = 0;

require(path.join(DIR, 'hbr2_env.js'));
const mergeCore = require(path.join(DIR, 'merge_core.js'));
const { trimReplay } = mergeCore;
const game = global.game;
global.window.performance.now = function () { return _now; };
const _log = console.log.bind(console);
console.log = (...a) => { if (a[0] === '[PXY] frame') return; _log(...a); };

let fails = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log('  OK   ' + msg);
  else { fails++; console.log('  FAIL ' + msg); }
}
function readHeader(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { magic: dv.getUint32(0, false), ver: dv.getUint32(4, false), dur: dv.getUint32(8, false) };
}
function makeRep(rawBytes) {
  _now = 0;
  const state = new game.va();
  const rep = new game.$b(rawBytes, state, 3);
  rep.hi = 0;
  return rep;
}
function snap(state) {
  const M = state.M;
  const ball = M && M.va && M.va.H ? M.va.H[0] : null;
  return {
    M: M ? 'y' : 'n', Ta: M ? M.Ta : null, Ob: M ? M.Ob : null, Tb: M ? M.Tb : null, Cb: M ? M.Cb : null,
    Bc: state.Bc, mb: state.mb, Ga: state.Ga,
    K: state.K.map(p => p.Z + ':' + (p.fa ? p.fa.ba : 0)).join(','),
    ball: ball ? [ball.a.x, ball.a.y, ball.V, ball.o, ball.ca, ball.Ea, ball.S, ball.i, ball.C].join(',') : 'null',
  };
}
// Recorre las acciones de un replay cargado y devuelve sus frames absolutos.
function actionFrames(rep) {
  const frames = [];
  while (rep.ug) { frames.push(rep.vg); rep.dm(); }
  return frames;
}
function advanceTo(rep, k) { rep.Ub = k * rep.uh; _now = rep.hi; rep.A(); }

const samplePath = path.join(DIR, 'samples', 'sample.hbr2');
const b = new Uint8Array(fs.readFileSync(samplePath));
const hdr = readHeader(b);

console.log('Sample: ' + path.basename(samplePath) + ' | ' + b.length + ' bytes | duración ' + hdr.dur + ' frames');
ok(hdr.magic === 0x48425232, 'magic del sample es HBR2');
ok(hdr.ver === 3, 'versión del sample es 3');
ok(hdr.dur > 1000, 'sample con duración suficiente (' + hdr.dur + ')');

console.log('\n— Recorte completo [0, dur) devuelve el mismo buffer —');
ok(trimReplay(b, 0, hdr.dur) === b, 'trimReplay(b, 0, dur) === b (sin copia)');

console.log('\n— Recorte inválido [end, start) lanza error —');
try { trimReplay(b, 5000, 1000); ok(false, 'debería lanzar error'); }
catch (e) { ok(true, 'lanza error: ' + e.message); }

function checkTrim(name, src, start, end, opts) {
  console.log('\n— ' + name + ' [' + start + ', ' + end + ') —');
  let out;
  try { out = trimReplay(src, start, end); }
  catch (e) { ok(false, 'trimReplay sin excepción: ' + e.message); return null; }
  const oh = readHeader(out);
  const len = end - start;
  ok(oh.magic === 0x48425232, 'magic HBR2');
  ok(oh.ver === 3, 'versión 3');
  ok(oh.dur === len, 'duración = ' + len + ' (got ' + oh.dur + ')');
  const rep = makeRep(out);
  ok(rep.Bf === len, 'el motor cargado lee Bf = ' + len);
  ok(actionFrames(rep).every(f => f >= start - start && f < len), 'todas las acciones en [0, ' + len + ')');
  rep.Ub = 0; rep.hi = 0;
  let crashed = false;
  for (let k = 1; k <= len; k++) { try { advanceTo(rep, k); } catch (e) { crashed = true; break; } }
  ok(!crashed, 'el motor avanza los ' + len + ' frames sin error');
  if (opts && opts.lockstep === true && !crashed) {
    const lenT = len;
    const orep = makeRep(src);
    const trep = makeRep(out);
    const sampleK = [1, 2, 3, 5, 10, 50, 200, 500, 1000, 2000, lenT - 1, lenT].filter(k => k >= 1 && k <= lenT);
    let mismatches = 0;
    for (let k = 1; k <= lenT; k++) {
      advanceTo(orep, start + k);
      advanceTo(trep, k);
      if (sampleK.indexOf(k) !== -1) {
        const a = snap(trep.T), b0 = snap(orep.T);
        if (JSON.stringify(a) !== JSON.stringify(b0)) {
          mismatches++;
          if (mismatches <= 3) { console.log('    mismatch frame ' + k); console.log('    trim : ' + JSON.stringify(a)); console.log('    orig : ' + JSON.stringify(b0)); }
        }
      }
    }
    ok(mismatches === 0, 'paridad lockstep con el original en ' + sampleK.length + ' frames muestreados');
  }
  return out;
}

checkTrim('Recorte por el INICIO (cabeza)', b, 0, 4000, { lockstep: true });
const tail = checkTrim('Recorte por el FINAL (cola)', b, 2500, hdr.dur);
const mid = checkTrim('Recorte en medio', b, 1500, 5000);

console.log('\n— Idempotencia —');
if (tail) ok(trimReplay(tail, 0, readHeader(tail).dur) === tail, 're-recortar la cola a rango completo devuelve la misma referencia');
if (tail) {
  const t2 = checkTrim('Segundo recorte de la cola', tail, 500, readHeader(tail).dur);
  if (t2) ok(readHeader(t2).dur === readHeader(tail).dur - 500, 'duración del segundo recorte acumula');
}
if (mid) {
  const m2 = trimReplay(mid, 0, readHeader(mid).dur);
  ok(m2 === mid, 're-recortar el medio a rango completo devuelve la misma referencia');
}

console.log('\n' + (fails === 0 ? 'RESULTADO: PASS' : 'RESULTADO: FAIL (' + fails + ' de ' + checks + ')'));
process.exitCode = fails === 0 ? 0 : 1;
