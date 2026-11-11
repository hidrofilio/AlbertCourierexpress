# Albert Courier Express — contexto del proyecto

## Con quién trabajas

Alberto Tome Aranda, dueño de **Albert Couriers Limited** (Limerick, Irlanda). **No es programador** — habla español, revisa la web desde un **iPhone**, y necesita explicaciones en lenguaje llano, no jerga técnica. Responde siempre en español.

## Qué es esto

Web de una empresa de transporte urgente dedicado (vehículo exclusivo punto a punto) que cubre los 32 condados de Irlanda — República + Irlanda del Norte. **No opera en Gran Bretaña.**

- Producción: https://albertcourierexpress.com (dominio canónico **sin `www`**)
- Repo: `hidrofilio/AlbertCourierexpress`
- Los datos publicados (precios, zonas, flota, tiempos) están en **[CAMBIOS/DATOS_WEB_REFERENCIA.md](CAMBIOS/DATOS_WEB_REFERENCIA.md)** — consúltalo antes de afirmar cifras.

## Arquitectura

- **`index.html`** — toda la web (HTML + CSS + JS en un solo archivo)
- **`server.js`** — servidor Node sin dependencias. Sirve los archivos estáticos **y** las analíticas propias. No es un sitio estático: Railway lo arranca con `npm start`.
- **`cpc/`** — app de tests del dueño, sin relación con el negocio
- **`cpc-study/`** — los mismos tests en inglés para sus ~25 compañeros de clase (mercancías o viajeros). Cada uno elige un apodo y recibe un código en pantalla, sin correo. El progreso se guarda en el servidor (`data/cpc-study/`, solo el hash del código). Lo que reportan se lee en `/api/cpc-study/admin?key=` con la clave de `STATS_KEY` (si dice "mira las sugerencias del CPC"). El banco inglés `cpc/data-en.js` se genera con `node tools/cpc-en/build.js` desde `cpc/data.js`. Si cambias una explicación en español, tradúcela en `tools/cpc-en/tr/` (`pending.js` dice cuáles faltan) y vuelve a generarlo.
  - **Buscar en el libro** (tests para el case study): los de Alberto están en `cpc/buscar.js` (títulos sin temas, a propósito: el ejercicio es encontrar el tema). La versión inglesa `cpc/buscar-en.js` sale de `node tools/cpc-en/build-buscar.js` (`… pending 80` lista lo que falta traducir). A los de mercancías se les quitan las preguntas de módulos solo de autobús.
  - **Simulacros nuevos:** se escriben en `tools/cpc-en/mocks/1xx.json` (pregunta en inglés, explicación `es` para la app de Alberto y `en` para los compañeros, cada una con su 📍 del libro) y se añaden con `node tools/cpc-en/add-mocks.js` y luego `build.js`. **Los títulos no dicen de qué temas son** («Simulacro 16»), por petición de Alberto.
  - La página avisa de que **todo está hecho con IA** y puede tener fallos: no quitar ese aviso.
  - **Mercancías:** el libro del curso es de los dos exámenes, pero Alberto solo subió las páginas comunes y las de viajeros (faltan las de haulage; está preguntando si algún compañero las tiene escaneadas). Los temas de camión (`g10`, `g15`…) se escriben en inglés en `tools/cpc-en/goods/*.json`, **desde fuentes oficiales** (RSA, reglamentos UE, CMR), cada explicación con su línea 📍. Se generan con `node tools/cpc-en/build-goods.js` → `cpc/data-goods-en.js`. A los de mercancías la página les quita las preguntas de autobús de los temas comunes (`BUS_WORDS` en `cpc-study/index.html`). Que la respuesta correcta no sea la más larga: Alberto ya corrigió eso en su banco.
- **`bravo/`** y **`bravo-api.js`** — **Bravo Transfers**, el proyecto nuevo de Alberto: traslados de personas desde Málaga con conductores VTC. **Lee antes `NEGOCIO/bravo-transfers/`** (el plan de la web está en `website/README.md` y lo decidido, en `decisiones/`). Ahora está en la **fase 1: escondida**.
  - Todo `/bravo/` (la web) y `/api/bravo/` pide contraseña: la variable `BRAVO_KEY` de Railway, o `STATS_KEY` mientras no exista. Lleva `noindex` y `no-store`. **No la pongas en `robots.txt`**, que es público y delataría la ruta.
  - El panel de Alberto está en `/bravo/panel/`. Las reservas (`bookings/BT-0001.json`…) y los precios (`settings.json`) se guardan en `DATA_DIR/bravo/`, nunca en git. Los precios de `DEFAULTS` en el código son **ficticios**. La regla 7 (no publicar precios) es de la mensajería; Bravo enseña precios por naturaleza.
  - **El servidor recalcula los km y el precio** antes de guardar: no te fíes de lo que mande la página. Los km salen de OSRM; `BRAVO_OSRM_URL` permite apuntar a uno falso en las pruebas.
  - El JS va dentro del HTML, porque `isPublicPath()` solo deja servir `.js` de `cpc/`. El aviso a Alberto se manda con Web3Forms, como la mensajería (solo funciona desde el dominio propio).
  - **Panel** con cinco pestañas: Viajes, Facturas, Cuentas, Conductores y Ajustes. En Ajustes se cambian los precios y los datos de las facturas (en `settings.json`). Los conductores se guardan en `drivers.json`.
  - **Cuentas (la contabilidad):** muestra los movimientos de cualquier periodo, con sus totales y el IVA (cobrado, pagado y la diferencia), y se descarga en CSV.
    - Los ingresos salen de las facturas no anuladas, por su fecha. Los pagos a conductores salen de las reservas no canceladas, por el día del servicio, con el IVA que se ponga en la reserva (`driverVat`).
    - Lo apuntado a mano va en `ledger.json`, y los tickets en `receipts/`. Al subir un ticket se comprueba por sus primeros bytes: JPG, PNG, WEBP o PDF, de 6 MB como mucho. La foto se reduce en el móvil antes de subirla.
    - **Pensada para una empresa en España:** cada categoría tiene su cuenta del Plan General Contable (`PGC` en `bravo-api.js`: 607, 62x, 631, 705, 759…). `books()` saca los libros registro de facturas emitidas y recibidas, el IVA por tipos y el libro diario (430/705/477 en las facturas, 6xx/472/410 en los gastos; las rectificativas, al revés).
    - Todo eso sale en el **PDF del periodo** (`/api/bravo/admin/accounts.pdf?from=&to=`, de varias páginas), además del CSV. Falta todavía: cobros y pagos por banco, amortizaciones y nóminas.
    - Los apuntes llevan nº de factura y NIF del proveedor (o del cliente). **Los apuntes sí se pueden borrar. Las facturas no.**
  - **Facturas y PDFs:** `bravo-pdf.js` hace tres PDF sin dependencias (Helvetica en WinAnsi): la factura, el justificante del cliente y la hoja de servicio del conductor.
    - Se abren por un **enlace privado** `/api/bravo/doc/<clave>/…pdf`, sin contraseña. El enlace del cliente nunca abre la hoja del conductor.
    - Las facturas van numeradas `F-AAAA-0001`, seguidas por año. El IVA (0–30 %) se elige al crearlas, y los precios llevan el IVA incluido.
    - Cada factura guarda una copia de los datos del emisor. **No se borra ni se anula: se rectifica**, como en España. Se hace una **factura rectificativa** `R-AAAA-0001`, en negativo y con el motivo; la original queda «rectificada» y se puede hacer otra nueva.
    - Cualquier factura o rectificativa de una reserva se abre con `/api/bravo/doc/<clave del cliente>/f/<número>.pdf`.
  - Los botones de WhatsApp y de correo solo abren el mensaje ya escrito: lo envía Alberto.
  - Las pruebas, con Playwright: un OSRM falso, Nominatim y Web3Forms simulados, y `pdftotext` para leer los PDF.
- **`stats/`** y **`notas/`** — panel de analíticas y buzón de notas. **La clave no se escribe nunca aquí**: vive en la variable `STATS_KEY` de Railway, y apuntada en el repo privado (`NEGOCIO/empresa/acceso.md`)
- **`data/events.jsonl`** — registro de visitas, en un volumen persistente de Railway montado en `/app/data`. **No está en git.**

**Despliegue:** `git push` → Railway construye y publica en 1-2 minutos. No hay otro paso.

## Reglas que te ahorrarán romper cosas

**1. Nunca sirvas archivos nuevos sin pensar.** `server.js` solo entrega extensiones de una lista blanca, y bloquea `data/`, `CAMBIOS/` y los `.js` fuera de `cpc/`. Esto existe porque el servidor llegó a exponer públicamente el código fuente y el registro entero de visitantes. Si añades un tipo de archivo público, revisa `isPublicPath()`.

**2. No hay Node instalado en la máquina local**, así que no puedes ejecutar ni probar `server.js` antes de desplegar. *(En una sesión en la nube sí lo hay: allí usa `node --check server.js`, y no habrá Edge.)* Para validar la sintaxis en el ordenador de Alberto sin desplegar a ciegas, usa Edge headless:
```powershell
# genera un HTML que hace new Function(<codigo en base64>) y vuelca el resultado
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files --user-data-dir=<perfil> --virtual-time-budget=6000 --dump-dom "file:///<ruta>"
```

**3. El CDN de Railway cachea 1 hora.** Tras desplegar, verifica siempre con un rompecachés (`?nc=$(date +%s%N)`), o creerás que el cambio no subió. Si hay que invalidar de verdad, solo el dueño puede: Railway → Settings → **Purge All**.

**4. No puedes probar Safari de iPhone.** El emulador móvil de Chromium da falsos negativos con controles nativos de iOS (`date`, `time`, `select`). Si reporta un fallo visual en móvil y tu medición dice que todo está bien, **pídele una captura** en vez de concluir que no existe.

**5. Al probar `/api/track` con `curl` siempre dará 0 visitas**: el filtro antibots descarta cualquier user-agent que contenga "curl". Manda una cabecera de navegador real.

**6. Formularios:** Web3Forms (clave pública por diseño). **Bloquea `*.up.railway.app`** — pruébalos solo desde el dominio propio.

**7. Precios: la web ya no publica ninguno** (26/09/2026). El cliente manda la solicitud y Alberto responde con un presupuesto hecho a mano, según el trabajo que tenga esa semana. La tabla de tarifas se borró del código — **no la vuelvas a meter** ni publiques cifras. Lo que sí viaja en el correo del formulario es la ruta, los km y el tiempo. La tarifa interna está en el repo privado (`NEGOCIO/dinero/rentabilidad.md`), nunca aquí.

## Si dice "lee NEGOCIO" o "mira mis notas"

`NEGOCIO/` es un **repositorio privado aparte** (no está en este repo, está en `.gitignore`)
donde vive el trabajo de negocio: rentabilidad por ruta, clientes, decisiones.

Además de leer esos archivos, **recoge el buzón de notas**: Alberto apunta cosas desde el
móvil en `/notas/` y quedan en el servidor hasta que se archivan. El procedimiento exacto
—y la clave, que **no puede estar en este repo público**— están en `NEGOCIO/web/notas-recibidas.md`
y `NEGOCIO/empresa/acceso.md`.

## Cómo le gusta trabajar

- **Nada de silencios largos.** Di en una frase qué vas a hacer antes de una tanda de herramientas, y ve soltando hallazgos según aparecen.
- **Mide antes de parchear.** Ante un fallo que no reproduces, diagnostica con datos (curl, mediciones en el DOM) en vez de encadenar parches especulativos.
- **Di claramente lo que no has podido verificar**, para que lo confirme él en su móvil.
