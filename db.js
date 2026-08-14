// db.js — Persistencia del historial de recs modificadas en IndexedDB.
// Guarda localmente el resultado de cada recorte/quita de partes que se descarga,
// de forma que se pueda volver a abrir, descargar o borrar desde el historial.
(function (w) {
  'use strict';
  const DB = 'hbr2-editor';
  const VER = 1;
  const STORE = 'edits';
  let _db = null;
  let _pending = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_pending) return _pending;
    _pending = new Promise(function (resolve, reject) {
      const req = w.indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () {
        const d = req.result;
        if (d.objectStoreNames.contains(STORE)) {
          _db = d;
          resolve(_db);
        } else {
          // El almacén no existe: la base se creó con un upgrade abortado. Con la
          // misma versión onupgradeneeded no vuelve a dispararse, así que se cierra
          // y se reabre con versión+1 para repararla.
          const v = d.version;
          d.close();
          const req2 = w.indexedDB.open(DB, v + 1);
          req2.onupgradeneeded = function () {
            if (!req2.result.objectStoreNames.contains(STORE)) req2.result.createObjectStore(STORE, { keyPath: 'id' });
          };
          req2.onsuccess = function () { _db = req2.result; resolve(_db); };
          req2.onerror = function () { reject(req2.error); };
          req2.onblocked = function () { reject(new Error('IndexedDB bloqueado')); };
        }
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB bloqueado')); };
    });
    return _pending;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        fn(t);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function saveEdit(rec) {
    return tx('readwrite', function (t) { t.objectStore(STORE).put(rec); });
  }

  function getEdit(id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, 'readonly');
        const q = t.objectStore(STORE).get(id);
        q.onsuccess = function () { resolve(q.result || null); };
        q.onerror = function () { reject(q.error); };
      });
    }).then(function (r) {
      if (r && r.data) r.data = new Uint8Array(r.data);
      return r;
    });
  }

  function deleteEdit(id) {
    return tx('readwrite', function (t) { t.objectStore(STORE).delete(id); });
  }

  function clearEdits() {
    return tx('readwrite', function (t) { t.objectStore(STORE).clear(); });
  }

  // Listado ligero (sin data): solo metadatos, del más reciente al más antiguo.
  function listEdits() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, 'readonly');
        const q = t.objectStore(STORE).getAll();
        q.onsuccess = function () {
          const list = q.result || [];
          list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
          resolve(list.map(function (r) {
            return {
              id: r.id, createdAt: r.createdAt, op: r.op,
              srcName: r.srcName, name: r.name,
              size: r.size, dur: r.dur, params: r.params,
            };
          }));
        };
        q.onerror = function () { reject(q.error); };
      });
    });
  }

  w.HBRDB = { saveEdit: saveEdit, getEdit: getEdit, deleteEdit: deleteEdit, clearEdits: clearEdits, listEdits: listEdits };
})(window);
