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
  - **Panel** con seis pestañas: Viajes, Clientes, Facturas, Cuentas, Empresas y Ajustes. «Clientes» (antes «Mensajes», `tab-messages` en el código) es la ficha de cada cliente: buscador, sus reservas (un toque las abre en Viajes) y sus mensajes. En Ajustes se cambian los precios, los datos de las facturas, la factura automática (`autoInvoice`), el justificante de pago (`payEmail`) y las horas para que el cliente cancele (`cancelHours`), en `settings.json`.
  - **Llamar o escribir:** en cada viaje (cliente, empresa y conductor que va), en cada empresa y en cada cliente hay botones de WhatsApp (`wa.me`, con el mensaje ya escrito), 📞 Llamar (`tel:`) y correo. Al conductor que va se le manda el viaje sin lo que se paga. El cliente, en «Mi cuenta», tiene Llamar y WhatsApp a su conductor.
  - **Empresas de transporte, no «conductores»** (lo pidió Alberto el 11/11): quienes hacen los viajes y cobran son empresas o autónomos con licencia VTC o de autobús.
    - En el panel, en los PDF y en la contabilidad se dice «empresa de transporte». En el código siguen llamándose `driver*` (`drivers.json`, `driverName`, `driverPay`…).
    - «Conductor» solo se usa para la persona que va al volante. En la reserva va en `chauffeur` y `chauffeurPhone`; si está vacío, el cliente ve la empresa.
    - La categoría de gasto «Conductores (sin reserva)» pasó a «Empresas de transporte (sin reserva)»: `ledger()` traduce la vieja al leer.
  - **Cuentas (la contabilidad):** muestra los movimientos de cualquier periodo, con sus totales y el IVA (cobrado, pagado y la diferencia), y se descarga en CSV.
    - Los ingresos salen de las facturas no anuladas, por su fecha. Los pagos a conductores salen de las reservas no canceladas, por el día del servicio, con el IVA que se ponga en la reserva (`driverVat`).
    - Lo apuntado a mano va en `ledger.json`, y los tickets en `receipts/`. Al subir un ticket se comprueba por sus primeros bytes: JPG, PNG, WEBP o PDF, de 6 MB como mucho. La foto se reduce en el móvil antes de subirla.
    - **Pensada para una empresa en España:** cada categoría tiene su cuenta del Plan General Contable (`PGC` en `bravo-api.js`: 607, 62x, 631, 705, 759…). `books()` saca los libros registro de facturas emitidas y recibidas, el IVA por tipos y el libro diario (430/705/477 en las facturas, 6xx/472/410 en los gastos; las rectificativas, al revés).
    - Todo eso sale en el **PDF del periodo** (`/api/bravo/admin/accounts.pdf?from=&to=`, de varias páginas), además del CSV. Falta todavía: las amortizaciones.
    - Los apuntes llevan nº de factura y NIF del proveedor (o del cliente). **Los apuntes sí se pueden borrar. Las facturas no.**
    - **Banco:** los extractos van a `statements/` y sus movimientos a `bank.json`.
      - Se leen solos el CSV (con cabecera y formato español o inglés) y la **Norma 43**. El PDF se guarda y lo lee Claude: los movimientos se meten con `POST /api/bravo/admin/bank/lines`.
      - `autoMatch()` solo casa lo que no tiene dudas: el importe exacto, un único candidato y que ese candidato no sirva para otro movimiento.
      - Cada movimiento se puede casar con una factura, un apunte, una nómina o un pago a conductor (y entonces queda `paid`). También se puede marcar como comisión (crea el gasto 626), socio (551), pago a Hacienda (4750/4751/4752), Seguridad Social (476) o traspaso.
      - Los cobros y pagos van al libro diario con la 572 (o la 570 si es en efectivo).
    - **Nóminas:** son apuntes con `type: 'nomina'` y `payroll` (bruto, IRPF, SS del trabajador y de la empresa, y neto). El coste es bruto + SS de la empresa. **Se casa con el banco por el neto.** En el diario van a 640/642 contra 4751/476/465.
    - **La bandeja de tickets** está en `inbox/` (`inbox.json`): al apuntar un ticket (`inboxId`), su archivo pasa a ser el ticket del apunte.
    - **Copia de seguridad:** `/api/bravo/admin/backup.json` (sin los archivos).
    - **Si Alberto dice «concilia el banco» o «apunta los tickets»,** el procedimiento está en `NEGOCIO/bravo-transfers/contabilidad/README.md`.
  - **Facturas y PDFs:** `bravo-pdf.js` hace tres PDF sin dependencias (Helvetica en WinAnsi): la factura, el justificante del cliente y la hoja de servicio del conductor.
    - Se abren por un **enlace privado** `/api/bravo/doc/<clave>/…pdf`, sin contraseña. El enlace del cliente nunca abre la hoja del conductor.
    - Las facturas van numeradas `F-AAAA-0001`, seguidas por año. El IVA (0–30 %) se elige al crearlas, y los precios llevan el IVA incluido.
    - Cada factura guarda una copia de los datos del emisor. **No se borra ni se anula: se rectifica**, como en España. Se hace una **factura rectificativa** `R-AAAA-0001`, en negativo y con el motivo; la original queda «rectificada» y se puede hacer otra nueva.
    - Cualquier factura o rectificativa de una reserva se abre con `/api/bravo/doc/<clave del cliente>/f/<número>.pdf`.
  - Los botones de WhatsApp y de correo solo abren el mensaje ya escrito: lo envía Alberto.
  - **Correos automáticos** (`bravo-mail.js`, sin dependencias):
    - Salen por la API de **Brevo** (o Resend con `EMAIL_API=resend`). La clave va en la variable **`EMAIL_KEY`** de Railway, nunca en el repo. Sin ella no sale ningún correo, pero todo lo demás funciona.
    - Otras variables: `EMAIL_FROM` (por defecto `info@albertcourierexpress.com`), `EMAIL_OWNER` (a quién avisar), `PUBLIC_URL`. En las pruebas, `BRAVO_EMAIL_URL` apunta a un servidor falso: **nunca se mandan correos de verdad al probar**.
    - Al reservar, el cliente recibe sus datos, el total y el PDF «Reserva y presupuesto» con **PENDIENTE DE PAGO** en rojo, la contraseña (solo la primera vez) y un enlace para entrar.
    - **La factura se hace al cobrar, no al reservar** (lo pidió Alberto el 12/11). En cada viaje, «Cobro del cliente» → «Marcar como cobrado» (`POST admin/client-paid`, guarda `b.clientPaid`). Con `autoInvoice`, ahí se hace la factura, ya cobrada. Al marcarlo se manda siempre el correo «Pago recibido» (con la factura, también si ya existía de antes), **una sola vez por reserva** (mira `b.emails`). Desde entonces el PDF de la reserva dice **PAGADO** en verde. Está pagada si tiene `clientPaid` o su factura está cobrada (`isPaid()` en `bravo-pdf.js`). Aceptar un presupuesto tampoco hace factura.
    - Si no hay clave de correo, la última pantalla de la reserva lo dice (es la versión de pruebas) en vez de prometer un correo. Lo enviado se apunta en la reserva (`emails`). Desde el panel se reenvía con «Enviar el correo de la reserva», por ejemplo tras cambiar el día o la hora.
  - **Cuenta del cliente** en `/bravo/cuenta/` (en la fase 1, también tras la contraseña de pruebas):
    - Se crea sola con la primera reserva, una por correo, en `customers.json`. Guarda la contraseña con scrypt, las sesiones (cookie `bravo_cust`) y los enlaces de un solo uso, todo con hash.
    - **La contraseña no se enseña nunca en la página, solo va por correo.** Si no, cualquiera que reservara con el correo de otro entraría en su cuenta.
    - El cliente puede:
      - ver sus reservas, el conductor (solo si está asignada) y sus PDF;
      - añadir el viaje al calendario;
      - pedir un cambio;
      - cancelar hasta `cancelHours` antes del viaje. Alberto hace después la rectificativa, si había factura.
      - escribir mensajes (en `messages.json`; se contestan en la pestaña Clientes) y cambiar sus datos y su contraseña.
    - Hay un freno contra contraseñas malas, por IP y por correo. «He olvidado la contraseña» responde lo mismo exista o no la cuenta, y en la cuenta del cliente nunca salen `driverPay`, notas ni tokens.
  - **Justificante de pago** (`paymentPdf` en `bravo-pdf.js`), para el conductor o el proveedor al que se paga:
    - Sale por correo **solo cuando el pago queda marcado**: a mano en la reserva (banco, Bizum, efectivo, tarjeta), al casarlo con el banco, o en un gasto pagado. Va **solo para pagos de los últimos 15 días**, para que subir un extracto antiguo no le escriba a nadie, y se puede apagar en Ajustes (`payEmail`).
    - Lleva adjuntos el justificante y la hoja de servicio (conductor) o su propia factura, el ticket subido (proveedor). No va para nóminas ni ingresos.
    - El correo del conductor está en `drivers.json` y en la reserva (`driverEmail`); el del proveedor, en el gasto (`email`). Lo enviado queda en `paid.emailed`.
    - Volver a guardar no lo reenvía; el botón del panel, sí (`POST /api/bravo/admin/pay-email`, vista previa en `admin/payment.pdf`).
    - Un pago marcado a mano «por el banco» o Bizum se casa después con su movimiento del extracto, sin volver a mandar nada.
  - **Lo añadido el 12/11** (la lista «lo que falta» de `NEGOCIO/bravo-transfers/sugerencias/`):
    - **Viajes:** pantalla «Hoy» arriba; «Nueva reserva» a mano (`POST admin/book`, lugares libres, precio opcional, `source`); filtros Por cobrar, Por pagar e Incidencias (`admin/incident`); datos para el **registro del Ministerio** (texto para copiar, con `clientDoc`); sugerencia de lo que se paga a la empresa con sus tarifas (`rateKm`, `rateHour`, `rateMin` en `drivers.json`); historial de cambios de cada reserva (`b.history`).
    - **Papeles** de cada empresa y de Bravo (`docs.json` + `docs/`, tipos en `DOC_KINDS`), con aviso en «Hoy» si caducan en 30 días. Solo se redibujan si han cambiado, para no borrar lo que se está escribiendo.
    - **Copias automáticas** cada día en `backups/` (se guardan 30; los lunes, por correo si `backupEmail`). Borrar los datos de un cliente (`admin/customers/delete`): no si tiene viajes pendientes, y si tiene facturas se queda el nombre.
    - **Avisos solos** (`runReminders`, cada 15 min, en hora de Madrid): recordatorio al cliente (solo si hay empresa asignada), aviso a la empresa al asignarle o cambiarle un viaje (`notifyCompany`), aviso a Alberto de lo que queda sin asignar (`ownerAlerts`) y petición de reseña (`reviewUrl`, solo https). Todo lo enviado queda en `b.emails`.
    - **Presupuestos** `P-AAAA-0001` (`admin/quote`, PDF `presupuesto.pdf`): el cliente los acepta o rechaza en «Mi cuenta».
    - **Hoteles y agencias** (`partners.json`): enlace `?p=CODIGO`, extracto mensual en PDF. **Códigos de descuento** (`codes.json`); el servidor aplica el descuento, nunca la página.
    - **Números** (sub-pestaña de Cuentas): estadísticas, trimestres, borrador del modelo 303 y calendario de impuestos. **Las fechas de impuestos y el 303 son orientativos: los confirma el gestor.**
    - **La web nueva** (`bravo/index.html`): la portada A del lienzo (atardecer dibujado con CSS, con franjas de azulejo), rutas con precio desde el aeropuerto (`GET routes`, en caché 12 h), parada intermedia (`via`), cartel con nombre (`meetSign`) y equipaje especial (`SPECIAL`). Si se sube `bravo/hero.jpg`, sale de fondo; el vídeo aún no.
    - **Usuarios del panel** (`users.json`, cookie `bravo_op`): administrador u **operador** (el sobrino). El operador solo ve Viajes, Clientes y Empresas, sin dinero: `OP_ROUTES`, `OP_UPDATE` y `forOperator()` en `bravo-api.js`, y `[data-admin]` en el panel. Todo POST queda en `audit.jsonl`. Ojo: la hoja de servicio en PDF sí dice lo que se paga a la empresa.
  - Las pruebas, con Playwright: un OSRM falso, un servicio de correo falso, Nominatim y Web3Forms simulados, y `pdftotext` para leer los PDF.
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
