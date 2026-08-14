// merge_core.js — Núcleo de fusión de dos .hbr2, independiente del entorno.
// No depende de fs/process/require: recibe los bytes y devuelve el resultado.
//
// Requiere (en el entorno de ejecución):
//   globalThis.pako   -> biblioteca pako (inflate/deflate raw)
//   globalThis.game   -> exports del motor (game-min_patched.js): {$b, va, p, A, ...}
//   window.performance.now() controlable (el motor lo lee como reloj)
//
// Uso:
//   const core = require('./merge_core.js');
//   const res  = core.mergeFiles(new Uint8Array(f1bytes), new Uint8Array(f2bytes), { mode });
//   mode: 'standard' (default) = junción solo con acciones vanilla (compatible haxball.com),
//         'exact'               = junción con Mb (restaura cuerpos exactos en formato
//                                 original f32; compatible con haxball.com y con el motor
//                                 patcheado tras revertir Mb a la clase original).
//   res = { merged, log[], warn, verifyOk, structural, mbEmitted, framesChecked, dur1, dur2, ... }
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(root);
  else root.mergeCore = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const game = root.game;
  const pako = root.pako;
  const { $b, va, p, A } = game;
  if (!game.p.wj || game.p.wj.size === 0) game.Nc.xj();
  if (game.p.wj.size !== 24) throw new Error('Registro de acciones inesperado: ' + game.p.wj.size);

  // ids de tipos (orden de Nc.xj): 5 Ha, 6 na, 7 bb, 8 cb, 10 Aa, 11 Oa, 12 fa, 13 Pa, 14 Qa, 20 Kb, 21 La, 23 Mb
  const T = { Ha: 5, na: 6, bb: 7, cb: 8, Aa: 10, Oa: 11, fa: 12, Pa: 13, Qa: 14, Kb: 20, La: 21, Mb: 23 };

  // ---------- helpers de stream ----------
  function readVarint(dec, pos) { let r = 0, s = 0, b; do { b = dec[pos++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return { v: r >>> 0, p: pos }; }
  function writeVarint(v, out) { v >>>= 0; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v & 0x7f); }
  function parseWom(dec) { let pos = 0; const cnt = (dec[0] << 8) | dec[1]; pos = 2; const entries = []; for (let i = 0; i < cnt; i++) { const { v, p: pp } = readVarint(dec, pos); pos = pp; const typ = dec[pos]; pos++; entries.push([v, typ]); } return { entries, end: pos }; }
  function buildWom(e1, e2, dur1) {
    const all = []; let c = 0;
    for (const [d, t] of e1) { c += d; all.push([c, t]); }
    c = 0;
    for (const [d, t] of e2) { c += d; all.push([c + dur1, t]); }
    const out = []; out.push((all.length >> 8) & 0xff, all.length & 0xff);
    let prev = 0;
    for (const [pabs, t] of all) { writeVarint(pabs - prev, out); out.push(t); prev = pabs; }
    return new Uint8Array(out);
  }
  // WOM a partir de posiciones absolutas ya desplazadas (para recortes).
  function buildWomSingle(entries) {
    const out = []; out.push((entries.length >> 8) & 0xff, entries.length & 0xff);
    let prev = 0;
    for (const [pabs, t] of entries) { writeVarint(pabs - prev, out); out.push(t); prev = pabs; }
    return new Uint8Array(out);
  }
  function varintBytes(v) {
    v >>>= 0; const out = [];
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v & 0x7f);
    return new Uint8Array(out);
  }
  function varintLen(v) { v >>>= 0; let n = 1; while (v >= 0x80) { v >>>= 7; n++; } return n; }
  function concatBytes(arrs) { let len = 0; for (const a of arrs) len += a.length; const out = new Uint8Array(len); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
  function bufEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  // ---------- motor ----------
  // La engine lee el tiempo de window.performance.now(): instalamos nuestro reloj sobre
  // el entorno (en Node, sobre el stub de window; en navegador idéntico) para que el
  // avance de _now sea exactamente el reloj que ve el motor (determinismo lockstep).
  let _now = 0;
  if (root.window && root.window.performance) root.window.performance.now = function () { return _now; };
  function makeRep(rawBytes) {
    _now = 0;
    const state = new va();
    const rep = new $b(rawBytes, state, 3);
    rep.hi = 0;
    return rep;
  }
  function toF(rep, F) { const n = F - rep.Y; if (n <= 0) return; _now = rep.hi + n * 3.3333333333333335; rep.A(); }

  function mergeFiles(b1, b2, opts) {
    const mode = (opts && opts.mode === 'exact') ? 'exact' : 'standard';
    const log = [];
    function line(msg) { log.push(msg); }
    const warn = [];
    const dec1 = pako.inflateRaw(b1.subarray(12));
    const dec2 = pako.inflateRaw(b2.subarray(12));
    const wom1 = parseWom(dec1);
    const wom2 = parseWom(dec2);
    line('WOM1: ' + wom1.entries.length + ' end ' + wom1.end + ' | WOM2: ' + wom2.entries.length + ' end ' + wom2.end);

    const rep1 = makeRep(b1);
    const rep2 = makeRep(b2);
    const dur1 = rep1.Bf, dur2 = rep2.Bf;
    line('dur1 = ' + dur1 + ' | dur2 = ' + dur2);

    // ---------- file1: hg1 + estado final S1 ----------
    const rep1e = makeRep(b1);
    let hg1 = 0;
    while (rep1e.ug) { hg1 = rep1e.vg; rep1e.dm(); }
    line('hg1 (último frame de acciones de file1) = ' + hg1);

    for (let i = 0; i < dur1; i++) { _now += 3.3333333333333335; rep1.A(); }
    const S1 = rep1.T;
    line('S1: M=' + !!S1.M + ' Bc=' + S1.Bc + ' mb=' + S1.mb + ' Ga=' + S1.Ga + ' gd=' + S1.gd + ' Gd=' + S1.Gd + ' ne=' + S1.ne + ' K=' + S1.K.length);

    // ---------- file2: offset de la 1ª acción + estado INIT S2 ----------
    const sc2 = rep2.Sc.a;
    const first = rep2.ug;
    if (!first) throw new Error('file2 sin acciones');
    const firstAction2Delta = rep2.vg; // delta (frame) real de la 1ª acción de file2
    let w = A.ka(64); w.pb(0); w.Xb(first.P); p.Cj(first, w);
    const firstBytes = w.Wb();            // [delta 0 (1B), id, payload]
    const firstBody = firstBytes.subarray(1); // [id, payload] sin el byte de delta
    const bodyEnd = wom2.end + sc2;       // fin del 1er registro (snapshot room + 1ª acción)
    const idPos = bodyEnd - firstBody.length; // pos del byte id (independiente del largo del delta real)
    let ok = firstBody.length > 0;
    for (let i = 0; i < firstBody.length; i++) if (dec2[idPos + i] !== firstBody[i]) ok = false;
    if (!ok) throw new Error('No se pudo verificar el offset de la 1ª acción de file2');
    let dLen = 1; { let v = firstAction2Delta >>> 0; while (v >= 0x80) { v >>>= 7; dLen++; } }
    const first_action2_abs = idPos - dLen; // inicio del varint delta real de file2
    line('file2 1ª acción: ' + first.constructor.name + ' P=' + first.P + ' delta=' + firstAction2Delta + ' @ ' + first_action2_abs + ' (id@' + idPos + ', ' + firstBody.length + ' bytes payload, verificado)');

    // S2 = estado INIT de file2 (frame 0). NO avanzar rep2 (rompería el cálculo por _now global).
    const S2 = rep2.T;
    line('S2: M=' + !!S2.M + ' Bc=' + S2.Bc + ' mb=' + S2.mb + ' Ga=' + S2.Ga + ' gd=' + S2.gd + ' Gd=' + S2.Gd + ' ne=' + S2.ne + ' K=' + S2.K.length);

    // ---------- construir acciones de junción ----------
    function newAct(id) { const o = Object.create(game.p.wj.get(id).prototype); o.qc = 0; o.gb = 0; return o; }

    const junctionBytes = [];
    let firstDelta = true;
    function push(act) {
      const delta = firstDelta ? (dur1 - hg1) : 0;
      firstDelta = false;
      const ww = A.ka(64);
      ww.pb(delta);
      ww.Xb(act.P);
      p.Cj(act, ww);
      junctionBytes.push(ww.Wb());
    }
    const actLog = [];
    function logAct(name) { actLog.push(name); }

    function teamOf(state, Z) { const pl = state.ma(Z); return pl && pl.fa ? pl.fa.ba : 0; }

    if (S1.M) { const a = newAct(T.cb); a.P = 0; push(a); logAct('cb'); }

    { // estadio (Oa) — requiere M==null al aplicar
      const w1 = A.ka(8192), w2 = A.ka(8192);
      S1.U.ha(w1); S2.U.ha(w2);
      if (!bufEq(w1.Wb(), w2.Wb())) {
        const a = newAct(T.Oa); a.P = 0; a.Yd = S2.U; push(a); logAct('Oa(estadio)');
      }
    }

    if (S1.mb !== S2.mb) { const a = newAct(T.Aa); a.P = 0; a.Gj = 0; a.newValue = S2.mb; push(a); logAct('Aa(mb=' + S2.mb + ')'); }
    if (S1.Ga !== S2.Ga) { const a = newAct(T.Aa); a.P = 0; a.Gj = 1; a.newValue = S2.Ga; push(a); logAct('Aa(Ga=' + S2.Ga + ')'); }

    if (S1.gd !== S2.gd || S1.Gd !== S2.Gd || S1.ne !== S2.ne) {
      let rj;
      if (S2.gd > 0) { rj = Math.round(S2.ne / S2.gd); if (rj < 0) rj = 0; if (rj > 100) rj = 100; if (rj * S2.gd !== S2.ne) warn.push('no se puede reproducir ne exactamente (gd=' + S2.gd + ', ne=' + S2.ne + ')'); }
      else rj = 0;
      const a = newAct(T.La); a.P = 0; a.min = S2.Gd; a.rate = S2.gd; a.rj = rj; push(a); logAct('La(' + S2.Gd + ',' + S2.gd + ',' + rj + ')');
    }

    const s1ids = new Set(S1.K.map(p => p.Z));
    const s2ids = new Set(S2.K.map(p => p.Z));

    for (const pl of S1.K) if (!s2ids.has(pl.Z)) { const a = newAct(T.na); a.P = 0; a.Z = pl.Z; a.qd = null; a.ah = false; push(a); logAct('na(remove ' + pl.Z + ')'); }
    for (const pl of S2.K) if (!s1ids.has(pl.Z)) { const a = newAct(T.Ha); a.P = 0; a.Z = pl.Z; a.name = pl.D; a.tj = pl.country; a.Zb = pl.Zb; push(a); logAct('Ha(add ' + pl.Z + ' ' + (pl.D || '') + ')'); }

    for (const pl of S2.K) {
      const t1 = teamOf(S1, pl.Z), t2 = pl.fa ? pl.fa.ba : 0;
      if (t1 !== t2) { const a = newAct(T.fa); a.P = 0; a.Vd = pl.Z; a.Bj = pl.fa; push(a); logAct('fa(' + pl.Z + '->' + t2 + ')'); }
    }

    if (mode === 'exact') {
      for (const pl of S2.K) {
        if (pl.cb !== (S1.ma(pl.Z) ? S1.ma(pl.Z).cb : false)) { const a = newAct(T.Qa); a.P = 0; a.Vd = pl.Z; a.jh = pl.cb; push(a); logAct('Qa(' + pl.Z + ' cb=' + pl.cb + ')'); }
      }
    }

    {
      const o1 = S1.K.map(p => p.Z).join(','), o2 = S2.K.map(p => p.Z).join(',');
      if (o1 !== o2) { const a = newAct(T.Kb); a.P = 0; a.Bn = true; a.lh = S2.K.map(p => p.Z); push(a); logAct('Kb(orden K)'); }
    }

    if (!!S1.Bc !== !!S2.Bc) { const a = newAct(T.Pa); a.P = 0; a.newValue = S2.Bc ? true : false; push(a); logAct('Pa(Bc=' + (S2.Bc ? 1 : 0) + ')'); }

    if (S2.M) { const a = newAct(T.bb); a.P = 0; push(a); logAct('bb'); }

    // Mb (SOLO modo 'exact'): restaurar lo que bb()+al() NO reproduce exactamente.
    // En modo 'standard' NO se emite Mb: la junción deja los cuerpos en el estado fresh de
    // bb()+al() (formación de kickoff), igual que el merger Original, y el motor vanilla
    // los mueve con las acciones de file2.
    // La clase Mb del motor patcheado está revertida al formato ORIGINAL (f32, sin campos
    // extra de jugador), así que el Mb emitido aquí también lo parsea haxball.com.
    let mbEmitted = 0;
    if (mode === 'exact' && S2.M) {
      function discEq(a, b) {
        return a.a.x === b.a.x && a.a.y === b.a.y && a.G.x === b.G.x && a.G.y === b.G.y
          && a.ra.x === b.ra.x && a.ra.y === b.ra.y && a.V === b.V && a.o === b.o
          && a.ca === b.ca && a.Ea === b.Ea && a.S === b.S && a.i === b.i && a.C === b.C;
      }
      // Estado fresh de bb()+al(): cuerpo por jugador (null = spectator sin cuerpo).
      function freshBodies() {
        const U = S2.U;
        const counters = [0, 0, 0];
        const fresh = new Map();
        for (const pl of S2.K) {
          const ba = pl.fa ? pl.fa.ba : 0;
          if (ba === 0) { fresh.set(pl.Z, null); continue; }
          const h = counters[ba];
          const k = ba === 1 ? U.Md : U.vd;
          let px, py;
          if (k.length === 0) {
            let k2 = (h + 1) >> 1;
            if (!(h & 1)) k2 = -k2;
            px = U.mc * pl.fa.Nh;
            py = 55 * k2;
          } else {
            let idx = h;
            if (idx >= k.length) idx = k.length - 1;
            px = k[idx].x; py = k[idx].y;
          }
          counters[ba]++;
          fresh.set(pl.Z, {
            a: { x: px, y: py },
            G: { x: 0, y: 0 },
            ra: { x: U.Kd.ra.x, y: U.Kd.ra.y },
            V: U.Kd.V, o: U.Kd.o, ca: U.Kd.ca, Ea: U.Kd.Ea,
            S: 0, i: 39, C: pl.fa.C | U.Kd.C,
          });
        }
        return fresh;
      }
      const discs = S2.M.va.H;
      const UH = S2.U.H;
      const nDisc = Math.min(UH.length, discs.length);
      for (let i = 0; i < nDisc; i++) {
        const d = discs[i];
        if (discEq(d, UH[i].aq())) continue;
        const m = newAct(T.Mb); m.P = 0; m.Ke = i; m.tn = false;
        m.Na = [d.a.x, d.a.y, d.G.x, d.G.y, d.ra.x, d.ra.y, d.V, d.o, d.ca, d.Ea];
        m.Yc = [d.S, d.i, d.C];
        push(m); mbEmitted++; logAct('Mb(disc[' + i + '])');
      }
      const fresh = freshBodies();
      for (const pl of S2.K) {
        const f = fresh.get(pl.Z);
        if (f === null) { if (pl.I) { logAct('Mb(player ' + pl.Z + ') NULL-fresh (estado no esperado)'); } continue; }
        const needsBody = !pl.I || !discEq(pl.I, f);
        if (!needsBody) continue;
        const d = pl.I;
        const m = newAct(T.Mb); m.P = 0; m.Ke = pl.Z; m.tn = true;
        // Mb.xa() itera Na/Yc SIEMPRE (fija el orden de bits de la máscara), así que
        // los arrays deben existir aunque no se restaura el cuerpo (elementos null =
        // bits a 0 = el cuerpo queda en el estado fresh de bb()+al()).
        // Nota: el formato original de Mb (f32, revertido) NO serializa campos de
        // jugador (W/Yb/Zc/Cc); los cuerpos se restauran con la precisión del f32.
        m.Na = d
          ? [d.a.x, d.a.y, d.G.x, d.G.y, d.ra.x, d.ra.y, d.V, d.o, d.ca, d.Ea]
          : [null, null, null, null, null, null, null, null, null, null];
        m.Yc = d ? [d.S, d.i, d.C] : [null, null, null];
        push(m); mbEmitted++; logAct('Mb(player ' + pl.Z + ')');
      }
      if (mbEmitted > 0) {
        warn.push('Junción con Mb (formato original f32): los cuerpos se restauran con precisión f32; la verificación lockstep confirmará la paridad byte-exacta.');
      }
    }

    line('Acciones de junción (' + junctionBytes.length + '):');
    actLog.forEach(x => line('  ' + x));
    const junctionBuf = concatBytes(junctionBytes);
    line('Bloque de junción: ' + junctionBuf.length + ' bytes, delta inicial ' + (dur1 - hg1));

    // ---------- ensamblar ----------
    const merged_dec = concatBytes([
      buildWom(wom1.entries, wom2.entries, dur1),
      dec1.subarray(wom1.end),
      junctionBuf,
      dec2.subarray(first_action2_abs),
    ]);
    const merged_dur = dur1 + dur2;
    const compressed = pako.deflateRaw(merged_dec);
    const out = new Uint8Array(12 + compressed.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x48425232, false);
    dv.setUint32(4, 3, false);
    dv.setUint32(8, merged_dur, false);
    out.set(compressed, 12);
    line('Dur total = ' + merged_dur + ' | ' + out.length + ' bytes | descomprimido ' + merged_dec.length);

    // ---------- verificación integrada (lockstep) ----------
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
    const frames = new Set([1, 2, 3, 5, 10, 50, 200, 500, 1000, 5000, 10000, 20000, 30000, 40000, 50000, dur2 - 1, dur2]);

    const frep = makeRep(b2);
    const mrep = makeRep(out);
    toF(mrep, dur1);             // merged -> frame dur1 (final de file1); hi queda = dur1*3.3333
    frep.hi = mrep.hi;           // alinear hi: ambos replays ven exactamente la misma secuencia de b
    _now = mrep.hi;
    // La verificación depende del modo:
    //   'exact'    -> gate byte-exacto estricto (marcador + pelota + jugadores/equipos).
    //                 Con Mb en formato original la junción restaura cuerpos exactos, así
    //                 que el gate estricto aplica también cuando hay Mb.
    //   'standard' -> gate ESTRUCTURAL: no puede exigir posiciones de cuerpos (sin Mb la
    //                 junción deja los cuerpos en el estado fresh de bb()+al(), que no es
    //                 S2 si file2 arranca en mitad de juego). Verifica que la estructura
    //                 del partido se mantiene: marcador/tiempos/roster/equipos/ajustes, y
    //                 además que la física SIGUE VIVA (los cuerpos se mueven, no se
    //                 congelan). Esto es exactamente lo que haxball.com necesita para
    //                 reproducir el merged con los jugadores en movimiento.
    // NOTA de avance: NO acumular Ub += uh (drift float hace que b=Ub*Ec trunque a a<Y y
    // la verificación se "congela"); se recalcula Ub = k*uh por frame (uh*Ec === 1 exacto)
    // con _now = rep.hi (elapsed 0).
    const structural = mode === 'standard';
    let fails = 0;
    function cmpAt(k) {
      const a = snap(mrep.T), b = snap(frep.T);
      // En modo standard solo se puede exigir lo que la junción controla directamente
      // (M presente, ajustes mb/Ga/Bc, roster+equipos K). El marcador y los tiempos
      // (Cb/Ta/Ob/Tb) divergen legítimamente sin Mb (los cuerpos de la 2ª parte arrancan
      // en formación fresh, no en S2 exacto), así que NO se comparan en este modo.
      // En modo exact la junción restaura cuerpos exactos y el gate es byte-exacto completo.
      const fin = structural
        ? a.M === b.M && a.Bc === b.Bc && a.mb === b.mb && a.Ga === b.Ga && a.K === b.K
          && (k <= 10 || (a.M === 'y' && b.M === 'y'))
        : a.M === b.M && a.Cb === b.Cb && a.Bc === b.Bc && a.mb === b.mb && a.Ga === b.Ga
          && a.K === b.K && a.Ta === b.Ta && a.Ob === b.Ob && a.Tb === b.Tb && a.ball === b.ball;
      if (!fin) { fails++; line('  MISMATCH frame ' + k + ' (merged ' + (dur1 + k) + ')'); line('    merged: ' + JSON.stringify(a)); line('    file2 : ' + JSON.stringify(b)); }
    }
    // Gate de física viva (modo standard): si los cuerpos no se mueven entre dos frames
    // separados de la 2ª parte, el merged está congelado y no sirve para haxball.com.
    // Se muestrea la posición de la pelota y de cada jugador con cuerpo, en orden
    // ascendente de frame (A() no retrocede: hay que capturarlo en el mismo barrido).
    let physicsAlive = false;
    let physicsPrev = null;
    const physicsK = [1, 500, 1000, 5000, 10000, 20000, 40000, dur2];
    function posOf(state) {
      const out = [];
      const M = state.M;
      if (M && M.va && M.va.H) out.push('b:' + M.va.H[0].a.x + ',' + M.va.H[0].a.y);
      for (const pl of state.K) if (pl.I) out.push(pl.Z + ':' + pl.I.a.x + ',' + pl.I.a.y);
      return out.join('|');
    }
    for (let k = 1; k <= dur2; k++) {
      mrep.Ub = (dur1 + k) * mrep.uh; _now = mrep.hi; mrep.A();
      frep.Ub = k * frep.uh; _now = frep.hi; frep.A();
      if (frames.has(k)) cmpAt(k);
      if (structural && physicsK.indexOf(k) !== -1) {
        const cur = posOf(mrep.T);
        if (physicsPrev !== null && cur !== physicsPrev) physicsAlive = true;
        physicsPrev = cur;
      }
    }
    if (structural) {
      if (!physicsAlive) { fails++; line('  FÍSICA CONGELADA: los cuerpos no se mueven en la 2ª parte del merged.'); }
      else line('  Física viva: cuerpos en movimiento en la 2ª parte (gate haxball.com).');
    }

    const verifyOk = fails === 0;
    line('Verificación: ' + (verifyOk
      ? (structural ? 'SUPERADA (estructural + física viva; ' + frames.size + ' frames muestreados)' : 'SUPERADA (paridad byte-exacta en ' + frames.size + ' frames muestreados; mbEmitted=' + mbEmitted + ')')
      : 'FALLIDA (' + fails + ')'));

    return {
      merged: out,
      log,
      warn,
      verifyOk,
      structural,
      mbEmitted,
      framesChecked: frames.size,
      dur1,
      dur2,
      junctionActions: actLog,
      junctionBytes: junctionBuf.length,
      mergedDur: merged_dur,
      mergedSize: out.length,
      mergedDecSize: merged_dec.length,
    };
  }

  return { mergeFiles, trimReplay };

  // ---------- recorte de replay ----------
  // Recorta un .hbr2 al intervalo de frames [start, end) (frames de replay, 30 fps).
  // Estrategia: se conserva el snapshot de sala del frame 0 (el formato solo permite
  // serializar la sala al inicio) y se filtran las acciones y los marcadores WOM del
  // tramo fuera del intervalo, recomprimiendo los deltas entre las que quedan. El
  // resultado es un .hbr2 válido cuya duración es (end - start).
  //
  // Para la fusión esto es correcto en ambos lados:
  //  - Rec 2: el merger descarta el snapshot de Rec 2 y engancha su flujo de acciones
  //    al estado de junción (S2); la verificación lockstep reproduce el recorte igual
  //    que el merged, porque ambos parten del mismo estado INIT de Rec 2.
  //  - Rec 1: el merged conserva el snapshot de Rec 1 y las acciones recortadas; S1 se
  //    calcula avanzando el recorte hasta su (nueva) duración, que coincide con el
  //    estado de la Rec 1 original en el instante de corte.
  // Nota visual: recortar el INICIO de Rec 1 deja la sala inicial sin acciones durante
  // ese tramo (limitación del formato); recortar el INICIO de Rec 2 es transparente.
  function trimReplay(b, start, end) {
    if (!b || b.length < 12) throw new Error('archivo demasiado corto para recortar');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(0, false) !== 0x48425232) throw new Error('no es un .hbr2');
    if (dv.getUint32(4, false) !== 3) throw new Error('versión de replay no soportada (se espera 3)');
    const dur = dv.getUint32(8, false);
    start = Math.max(0, Math.floor(start | 0));
    end = Math.min(dur, Math.ceil(end | 0));
    if (end <= start) throw new Error('recorte inválido: el final debe ser mayor que el inicio');
    if (start === 0 && end === dur) return b;

    const dec = pako.inflateRaw(b.subarray(12));
    const wom = parseWom(dec);

    // Leer todas las acciones del original (pos absoluta + bytes serializados).
    const rep = makeRep(b);
    const acts = [];
    let prevAbsOrig = 0;
    let totalAct = 0;
    while (rep.ug) {
      const abs = rep.vg;
      const act = rep.ug;
      const delta = abs - prevAbsOrig;
      const ww = A.ka(64);
      ww.pb(delta);
      ww.Xb(act.P);
      p.Cj(act, ww);
      const rec = ww.Wb();
      totalAct += rec.length;
      acts.push({ abs: abs, rec: rec, dlen: varintLen(delta) });
      prevAbsOrig = abs;
      rep.dm();
    }
    const snapshotLen = rep.Sc.a - totalAct;
    if (snapshotLen < 0 || wom.end + snapshotLen > dec.length) {
      throw new Error('no se pudo localizar el snapshot de sala');
    }

    // Filtrar acciones del tramo y recomprimir deltas.
    const newRecs = [];
    let prevAbs = start;
    for (const a of acts) {
      if (a.abs < start) continue;
      if (a.abs >= end) break;
      const nd = a.abs - prevAbs;
      prevAbs = a.abs;
      const body = a.rec.subarray(a.dlen); // [varint P][payload]
      newRecs.push(concatBytes([varintBytes(nd), body]));
    }

    // Marcadores WOM del tramo, desplazados a la nueva línea de tiempo.
    let c = 0;
    const markers = [];
    for (const [d, t] of wom.entries) { c += d; if (c >= start && c < end) markers.push([c - start, t]); }

    const snapshot = dec.subarray(wom.end, wom.end + snapshotLen);
    const newDec = concatBytes([buildWomSingle(markers), snapshot].concat(newRecs));
    const compressed = pako.deflateRaw(newDec);
    const out = new Uint8Array(12 + compressed.length);
    const dv2 = new DataView(out.buffer);
    dv2.setUint32(0, 0x48425232, false);
    dv2.setUint32(4, 3, false);
    dv2.setUint32(8, end - start, false);
    out.set(compressed, 12);
    return out;
  }
});
