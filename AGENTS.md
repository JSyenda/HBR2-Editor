# HBR2 Editor — Editor de recs HBR2

Proyecto: editor de grabaciones `.hbr2` (HaxBall). Fase actual: **recortar/editar frames**.

## Conocimiento de dominio: formato `.hbr2`

Estructura de archivo (nada de esto es un zip a nivel de archivo, es un contenedor propio):

- **Cabecera de 12 bytes** (big-endian):
  - `0x00` u32 magic `0x48425232` ("HBR2")
  - `0x04` u32 versión = **3**
  - `0x08` u32 duración en **frames a 60 fps**
- **Cuerpo** (`bytes[12..]`): flujo raw-deflate (`pako.inflateRaw`). Al descomprimir:
  1. **Tabla WOM** (marcadores): 2 bytes = nº de entradas, luego por entrada `[varint delta-abs, u8 tipo]`.
  2. **Snapshot de sala** (serializado solo al inicio del archivo; el formato no permite re-serializar la sala en medio).
  3. **Flujo de acciones**: secuencia de `[varint delta-frame, u8 actionId, payload serializado]`. El delta de la 1ª acción es relativo al frame 0; el resto relativo a la anterior.

### Clave: parsear/reescribir acciones requiere el motor

Las acciones son clases del registro `game.p.wj` del motor minificado. NO se pueden parsear por ids a mano (los payloads usan campos internos del motor). Para leer/escribir acciones hay que usar el motor:

- `new $b(bytes, state, 3)` parsea un replay.
- `rep.A()` avanza un frame; `rep.Y` = frame actual; `rep.Bf` = duración.
- `rep.ug` = próxima acción, `rep.vg` = su frame absoluto, `rep.dm()` la consume.
- `rep.hi` = reloj del replay; el motor lee el tiempo de `window.performance.now()`, así que el determinismo (lockstep) se consigue instalando `window.performance.now = () => _now` y avanzando `_now` un incremento monotónico (p. ej. 3.3333333333333335) antes de cada `A()`. El valor no codifica fps reales; el motor avanza 1 frame por `A()` y su reloj interno va a `uh = 16.6667 ms` (60 fps). Los tiempos mostrados se calculan con `frames / 60`.
- ids de tipo (orden de `game.Nc.xj()`, registro de 24): `Ha=5, na=6, bb=7, cb=8, Aa=10, Oa=11, fa=12, Pa=13, Qa=14, Kb=20, La=21, Mb=23`.

### Recorte — ya resuelto

`merge_core.js` ya tiene `trimReplay(bytes, start, end)` (recorte de `[start, end)`), con header/deltas/WOM recomprimidos y verificado byte-compatible. **Reutilizar como base del editor**, no reimplementar.

## Assets reutilizables (copiados del merger)

- `merge_core.js` — núcleo independiente del entorno (recibe bytes, devuelve resultado); exporta `mergeFiles` y `trimReplay`. Requiere `globalThis.pako` y `globalThis.game`.
- `game-min_patched.js` — motor HaxBall patcheado; expone `{$b, va, p, A, ...}` vía `globalThis.game`.
- `pako.min.js` (2.1.0) — `deflateRaw`/`inflateRaw`; expone `globalThis.pako`.
- `vendor/pako-jszip.min.js` — bundle JSZip+pako para navegador (necesario solo si se edita `res.dat`).

Cargar en navegador en orden: `pako.min.js`, `game-min_patched.js`, `merge_core.js`. En worker (`importScripts`) o Node (stub de window) igual: `globalThis` es el raíz compartido.

## Convenciones de trabajo (de la sesión del merger)

- Cambios pequeños e incrementales: editar → **verificar** → commit → push.
- Antes de commitear, ejecutar la verificación (harness de integración sobre la página servida) y comprobar `node --check` en los JS que se tocaron.
- Mensajes de commit en español, concisos, describiendo el cambio funcional.
- Toda cadena visible de usuario en **ES y EN** (diccionario i18n); el HTML mantiene fallback ES estático.
- CSS siguiendo el sistema de diseño existente (panel `#1d2330`, línea `#2d3443`, radio 8px).
- No comentarios de adorno en código; los comentarios que existen en `merge_core.js` son documentación técnica del formato y se conservan.

## Roadmap

1. **Fase 1 — Extraer/Aplicar**: parsear `.hbr2`, exponer frames/acciones, re-serializar sin pérdida (reutiliza `trimReplay` y el patrón de `mergeFiles`).
2. **Fase 2 — Recorte con UI**: selección inicio/fin, vista previa (motor patcheado), guardar `.hbr2` recortado.
3. **Fase 3 — Edición puntual**: eliminar/marcar frames, corregir posiciones, etc.
