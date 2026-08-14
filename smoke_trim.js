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
const { trimReplay, cutParts, analyzeReplay } = mergeCore;
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

// ---------- Fase 2b: análisis de partes y recorte por partes ----------
function parityAt(origRep, cutRep, cutK, mapK) {
  advanceTo(origRep, mapK(cutK));
  advanceTo(cutRep, cutK);
  return { a: snap(origRep.T), b0: snap(cutRep.T) };
}
function checkCut(name, src, removals, opts) {
  console.log('\n— ' + name + ' (eliminar ' + JSON.stringify(removals) + ') —');
  let out;
  try { out = cutParts(src, removals); }
  catch (e) { ok(false, 'cutParts sin excepción: ' + e.message); return null; }
  const oh = readHeader(out);
  const srcH = readHeader(src);
  const removedLen = removals.reduce((t, r) => t + (r[1] - r[0]), 0);
  const len = srcH.dur - removedLen;
  ok(oh.magic === 0x48425232, 'magic HBR2');
  ok(oh.ver === 3, 'versión 3');
  ok(oh.dur === len, 'duración = ' + len + ' (got ' + oh.dur + ')');
  const rep = makeRep(out);
  ok(rep.Bf === len, 'el motor cargado lee Bf = ' + len);
  ok(actionFrames(rep).every(f => f >= 0 && f < len), 'todas las acciones en [0, ' + len + ')');
  rep.Ub = 0; rep.hi = 0;
  let crashed = false;
  for (let k = 1; k <= len; k++) { try { advanceTo(rep, k); } catch (e) { crashed = true; break; } }
  ok(!crashed, 'el motor avanza los ' + len + ' frames sin error');
  if (opts && opts.lockstep === true && !crashed) {
    // La paridad lockstep solo es comparable antes del primer tramo eliminado:
    // al saltarse un tramo en medio, la física continúa desde el estado previo
    // (comportamiento esperado del editor), así que el estado diverge en la costura.
    const until = Math.min.apply(null, removals.map(r => r[0]));
    const mapK = (k) => { let o = k; for (const r of removals) { if (o >= r[0]) o += r[1] - r[0]; } return o; };
    const orep = makeRep(src);
    const crep = makeRep(out);
    const sampleK = [1, 2, 3, 5, 10, 50, 200, 500, 1000, 2000, until - 1].filter(k => k >= 1 && k < until);
    let mismatches = 0;
    for (let k = 1; k < until; k++) {
      const { a, b0 } = parityAt(orep, crep, k, mapK);
      if (sampleK.indexOf(k) !== -1 && JSON.stringify(a) !== JSON.stringify(b0)) {
        mismatches++;
        if (mismatches <= 3) { console.log('    mismatch frame ' + k + ' (orig ' + mapK(k) + ')'); console.log('    cut  : ' + JSON.stringify(a)); console.log('    orig : ' + JSON.stringify(b0)); }
      }
    }
    ok(mismatches === 0, 'paridad lockstep pre-corte en ' + sampleK.length + ' frames muestreados');
  }
  return out;
}

console.log('\n— Análisis de partes (analyzeReplay) —');
const an = analyzeReplay(b);
ok(an.dur === hdr.dur, 'analyzeReplay.dur = ' + hdr.dur);
ok(Array.isArray(an.parts) && Array.isArray(an.markers), 'devuelve parts[] y markers[]');
ok(an.parts.every(p => p.start >= 0 && p.end <= hdr.dur && p.start < p.end), 'partes con rangos válidos');
ok(an.parts.length === 1, 'el sample tiene 1 parte (bb detectado)');
if (an.parts.length === 1) {
  ok(an.parts[0].start > 0, 'la parte arranca en el kickoff (frame ' + an.parts[0].start + ')');
  ok(an.parts[0].end === hdr.dur, 'la parte llega hasta el final de la rec');
}
ok(an.markers.length === 0, 'el sample no tiene marcadores WOM');

console.log('\n— cutParts: sin eliminaciones devuelve el mismo buffer —');
ok(cutParts(b, []) === b, 'cutParts(b, []) === b (sin copia)');

console.log('\n— cutParts: recorte de cabeza y cola byte-idénticos a trimReplay —');
{
  const keepHead = cutParts(b, [[4000, hdr.dur]]);
  const tHead = trimReplay(b, 0, 4000);
  ok(keepHead.length === tHead.length && keepHead.every((v, i) => v === tHead[i]),
    'quitar cola [4000,dur) == trimReplay(b,0,4000) byte a byte');

  const dropHead = cutParts(b, [[0, 4000]]);
  const tDrop = trimReplay(b, 4000, hdr.dur);
  ok(dropHead.length === tDrop.length && dropHead.every((v, i) => v === tDrop[i]),
    'quitar cabeza [0,4000) == trimReplay(b,4000,dur) byte a byte');
}

console.log('\n— cutParts: eliminar un tramo del medio —');
checkCut('Eliminar medio [1500, 5000)', b, [[1500, 5000]], { lockstep: true });

console.log('\n— cutParts: eliminar cola [2500, dur) —');
checkCut('Eliminar cola', b, [[2500, hdr.dur]], { lockstep: true });

console.log('\n— cutParts: eliminar dos tramos (medio + cola) —');
checkCut('Eliminar [1000, 2000) y [3000, 5000)', b, [[1000, 2000], [3000, 5000]], { lockstep: true });

console.log('\n— cutParts: eliminaciones solapadas se fusionan —');
{
  const via = cutParts(b, [[500, 2000], [1500, 3000]]);
  ok(readHeader(via).dur === hdr.dur - 2500, 'duración = ' + (hdr.dur - 2500) + ' (got ' + readHeader(via).dur + ')');
}

console.log('\n— cutParts: rango inválido lanza error —');
try { cutParts(b, [[0, hdr.dur]]); ok(false, 'debería lanzar error'); }
catch (e) { ok(true, 'lanza error: ' + e.message); }

// ---------- Fase 2c: rec multi-parte real ----------
const mpPath = path.join(DIR, 'samples', 'multipart.hbr2');
if (fs.existsSync(mpPath)) {
  const mp = new Uint8Array(fs.readFileSync(mpPath));
  const mph = readHeader(mp);
  console.log('\n— Multi-parte: ' + path.basename(mpPath) + ' | ' + mp.length + ' bytes | ' + mph.dur + ' frames —');
  const an = analyzeReplay(mp);
  ok(an.dur === mph.dur, 'analyzeReplay.dur = ' + mph.dur);
  ok(an.parts.length === 3, 'detecta 3 partes (got ' + an.parts.length + ')');
  ok(an.parts[0].start === 1904 && an.parts[0].end === 45840, 'parte 1 = [1904, 45840)');
  ok(an.parts[1].start === 45840 && an.parts[1].end === 50615, 'parte 2 = [45840, 50615)');
  ok(an.parts[2].start === 50615 && an.parts[2].end === mph.dur, 'parte 3 = [50615, dur)');
  ok(an.markers.length === 10, '10 marcadores WOM');

  const second = an.parts[1];
  const removed = second.end - second.start;
  const mpCut = cutParts(mp, [[second.start, second.end]]);
  const mc = readHeader(mpCut);
  ok(mc.dur === mph.dur - removed, 'quitar parte 2 → dur ' + (mph.dur - removed) + ' (got ' + mc.dur + ')');
  const mrep = makeRep(mpCut);
  ok(mrep.Bf === mc.dur, 'el motor carga el resultado (Bf = ' + mc.dur + ')');
  ok(actionFrames(mrep).every(f => f >= 0 && f < mc.dur), 'todas las acciones en [0, ' + mc.dur + ')');
  const an2 = analyzeReplay(mpCut);
  ok(an2.parts.length === 2, 'reanálisis: quedan 2 partes');
  ok(an2.parts[0].start === 1904 && an2.parts[0].end === 45840, 'parte restante 1 = [1904, 45840)');
  ok(an2.parts[1].start === 45840 && an2.parts[1].end === mc.dur, 'parte restante 2 = [45840, dur)');
}

console.log('\n' + (fails === 0 ? 'RESULTADO: PASS' : 'RESULTADO: FAIL (' + fails + ' de ' + checks + ')'));
process.exitCode = fails === 0 ? 0 : 1;
