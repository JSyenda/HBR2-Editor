// harness_parts.js — Harness headless (CDP) de la Fase 2 (panel de partes).
// Lanza Chrome con remote-debugging y, vía WebSocket (CDP), controla la página en
// vivo: carga ?sample=… y verifica que el análisis detecta las partes de una rec
// multi-parte, que ?autoparts=1 quita las partes 2..n y deja el resultado listo, y
// que una rec de 1 parte deshabilita el botón de quitar.
// Uso: node harness_parts.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = 8931;
const CDP_PORT = 9223;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.hbr2': 'application/octet-stream', '.dat': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

let fails = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log('  OK   ' + msg);
  else { fails++; console.log('  FAIL ' + msg); }
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      };
    });
  }
  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }
  async waitFor(expr, timeoutMs, pollMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const v = await this.evaluate(expr);
        if (v) return v;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, pollMs || 250));
    }
    return null;
  }
}

async function launch() {
  const udd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hbr2cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + udd, 'about:blank',
  ], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json');
      targets = await res.json();
    } catch (e) {}
    if (!targets) await new Promise((r) => setTimeout(r, 250));
  }
  const page = targets && targets.find((t) => t.type === 'page');
  if (!page) { chrome.kill(); throw new Error('no se pudo conectar a CDP'); }
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return { chrome, cdp };
}

async function goto(cdp, url) {
  await cdp.send('Page.navigate', { url });
}

const FACTS = 'JSON.stringify({' +
  'rows:document.querySelectorAll(".partrow").length,' +
  'labels:Array.from(document.querySelectorAll(".pnum")).map(function(e){return e.textContent}),' +
  'partsInfo:document.getElementById("partsInfo").textContent,' +
  'partsStatus:document.getElementById("partsStatus").className+"|"+document.getElementById("partsStatus").textContent,' +
  'btnSaveHidden:document.getElementById("btnPartsSave").classList.contains("hidden"),' +
  'btnRemoveDisabled:document.getElementById("btnPartsRemove").disabled,' +
  'playerName:document.getElementById("playerName").textContent,' +
  'status:document.getElementById("status").textContent,' +
  'errDisplay:document.getElementById("err").style.display' +
  '})';

async function run() {
  const { chrome, cdp } = await launch();
  const base = 'http://localhost:' + PORT + '/';
  try {
    console.log('\n— Rec multi-parte (análisis sin autoparts) —');
    await goto(cdp, base + '?sample=samples/multipart.hbr2');
    await cdp.waitFor('document.querySelectorAll(".partrow").length === 3', 30000);
    let f = JSON.parse(await cdp.evaluate(FACTS));
    ok(f.rows === 3, '3 filas de parte renderizadas');
    ok(f.labels.join(',') === 'Parte 1,Parte 2,Parte 3', 'etiquetas Parte 1/2/3');
    ok(f.btnRemoveDisabled === true, 'botón quitar deshabilitado sin selección');
    ok(f.errDisplay !== 'block', 'sin caja de error');

    console.log('\n— Rec multi-parte (autoparts quita partes 2 y 3) —');
    await goto(cdp, base + '?sample=samples/multipart.hbr2&autoparts=1');
    await cdp.waitFor('document.title.indexOf("PARTS_DONE_") === 0', 60000);
    f = JSON.parse(await cdp.evaluate(FACTS));
    ok(f.rows === 1, 'tras quitar partes 2 y 3 queda 1 parte');
    ok(f.labels.join(',') === 'Parte 1', 'sin etiquetas Parte 2/3');
    ok(f.btnSaveHidden === false, 'botón Guardar .hbr2 de partes visible');
    ok(f.playerName === 'multipart.hbr2 → multipart_sin_partes.hbr2', 'el reproductor muestra el resultado');
    ok(f.status.indexOf('Partes quitadas: resultado listo') === 0, 'estado "Partes quitadas…"');
    ok(f.errDisplay !== 'block', 'sin caja de error');

    console.log('\n— Rec de 1 parte (sample.hbr2) —');
    await goto(cdp, base + '?sample=samples/sample.hbr2');
    await cdp.waitFor('document.querySelectorAll(".partrow").length === 1', 30000);
    f = JSON.parse(await cdp.evaluate(FACTS));
    ok(f.rows === 1, '1 fila de parte');
    ok(f.partsInfo === '1 parte', 'etiqueta "1 parte"');
    ok(f.btnRemoveDisabled === true, 'botón quitar deshabilitado con 1 parte');
    ok(f.errDisplay !== 'block', 'sin caja de error');
  } finally {
    chrome.kill();
  }

  console.log('\n' + (fails === 0 ? 'HARNESS: PASS' : 'HARNESS: FAIL (' + fails + ' de ' + checks + ')'));
  process.exitCode = fails === 0 ? 0 : 1;
}

server.listen(PORT, async () => {
  try { await run(); } catch (e) { console.error('HARNESS ERROR: ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
  server.close();
});
