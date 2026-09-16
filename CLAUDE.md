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
- **`cpc/`** — app privada de tests del dueño (PIN 8214), sin relación con el negocio
- **`stats/`** — panel de analíticas (misma puerta con PIN, clave real en la variable `STATS_KEY` de Railway)
- **`data/events.jsonl`** — registro de visitas, en un volumen persistente de Railway montado en `/app/data`. **No está en git.**

**Despliegue:** `git push` → Railway construye y publica en 1-2 minutos. No hay otro paso.

## Reglas que te ahorrarán romper cosas

**1. Nunca sirvas archivos nuevos sin pensar.** `server.js` solo entrega extensiones de una lista blanca, y bloquea `data/`, `CAMBIOS/` y los `.js` fuera de `cpc/`. Esto existe porque el servidor llegó a exponer públicamente el código fuente y el registro entero de visitantes. Si añades un tipo de archivo público, revisa `isPublicPath()`.

**2. No hay Node instalado en la máquina local**, así que no puedes ejecutar ni probar `server.js` antes de desplegar. Para validar la sintaxis sin desplegar a ciegas, usa Edge headless:
```powershell
# genera un HTML que hace new Function(<codigo en base64>) y vuelca el resultado
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files --user-data-dir=<perfil> --virtual-time-budget=6000 --dump-dom "file:///<ruta>"
```

**3. El CDN de Railway cachea 1 hora.** Tras desplegar, verifica siempre con un rompecachés (`?nc=$(date +%s%N)`), o creerás que el cambio no subió. Si hay que invalidar de verdad, solo el dueño puede: Railway → Settings → **Purge All**.

**4. No puedes probar Safari de iPhone.** El emulador móvil de Chromium da falsos negativos con controles nativos de iOS (`date`, `time`, `select`). Si reporta un fallo visual en móvil y tu medición dice que todo está bien, **pídele una captura** en vez de concluir que no existe.

**5. Al probar `/api/track` con `curl` siempre dará 0 visitas**: el filtro antibots descarta cualquier user-agent que contenga "curl". Manda una cabecera de navegador real.

**6. Formularios:** Web3Forms (clave pública por diseño). **Bloquea `*.up.railway.app`** — pruébalos solo desde el dominio propio.

**7. Precios:** tarifa plana por zona, nunca por km. La matriz la definió él; no inventes tarifas ni cambies el modelo sin que lo pida.

## Cómo le gusta trabajar

- **Nada de silencios largos.** Di en una frase qué vas a hacer antes de una tanda de herramientas, y ve soltando hallazgos según aparecen.
- **Mide antes de parchear.** Ante un fallo que no reproduces, diagnostica con datos (curl, mediciones en el DOM) en vez de encadenar parches especulativos.
- **Di claramente lo que no has podido verificar**, para que lo confirme él en su móvil.
