# 🎯 Features Técnicos - Albert Courier Express

**Última actualización:** 2026-10-21 — reemplaza la versión de 2026-09-09, que describía la web previa a Netlify (colores naranja, Citroën en la flota, `LocalBusiness` genérico, formulario Netlify). Todo eso ya no existe.

> ⚠️ Repositorio **público**: este documento no lleva precios, tarifas ni costes.

## 📱 Responsividad

```
Desktop: 769px+
Móvil:   < 768px
```
- Menú hamburguesa < 768px
- Grid 1 columna en móvil (cards, formulario de 2 pasos por fila → 1)
- `overflow-x: hidden` en `body` como red de seguridad
- Los `<select>` y campos de formulario llevan `width:100%; min-width:0; box-sizing:border-box` para que texto largo en las opciones no fuerce overflow horizontal (bug real que ocurrió al añadir dimensiones a las opciones de vehículo)

---

## 🎨 Tipografía

```
Body:     Inter (400, 500, 600, 700)
Headings: Poppins (600, 700)
```

## 🎨 Colores (unificados en azul eléctrico)

```
--primary-color:    #001F3F
--accent-color:     #0066FF
--border-color:     rgba(0, 102, 255, 0.2)   (borde azul al 20% de opacidad)
--success-color:    #0066FF
--error-color:      #FF6B6B  (solo para el banner AOG, intencionalmente distinto)
--text-light:       #ffffff
```

## 🪟 Glassmorphism

Todos los recuadros con texto (formularios, tabla de contacto, footer, FAQ, cards) comparten:
```css
background: rgba(0, 0, 0, 0.2);   /* o transparent en tabla/footer */
border: 1px solid var(--border-color);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border-radius: 8-16px;
```
El valor de blur se ha probado en varios niveles (1px, 2px, 6px, 10px, 12px) — **12px es el valor final**.

## 🎞️ Fondo animado

- 4 fotos en `.site-bg-slide`, orden `[0, 3, 0, 2, 0, 1]` (oscura intercalada entre cada foto)
- Transición de opacidad: 6s
- Ken Burns (zoom+pan lento): `@keyframes bgSlowPan`, 40s por ciclo
- Iconos de la sección Expertise: `@keyframes iconFloat`, flotan con distinto `animation-delay` cada uno

---

## ♿ Accesibilidad (WCAG 2.1 AA) — sin cambios de fondo desde el origen

- Skip link, roles semánticos (`header`, `main`, `nav`, `table`), `aria-label`/`aria-required`
- Foco visible, contraste alto (fondo oscuro + texto blanco)

---

## 📊 SEO

### Schema.org JSON-LD (dos bloques en el `<head>`)
1. **`["LogisticsService", "EmergencyService"]`** (tipo doble desde 2026-09-13, no `LocalBusiness` genérico): incluye `areaServed` (Ireland + Northern Ireland como entidades separadas), `makesOffer` con los 6 sectores de especialidad, `slogan`, base en Limerick/Shannon, `email`, `founder` (Alberto Tome Aranda) y `contactPoint` (teléfono/email/WhatsApp/idiomas/horario 24/7) — pensado para que los motores de IA (ChatGPT, Gemini, Perplexity) puedan citar la empresa como respuesta directa a búsquedas de transporte urgente.
2. **`FAQPage`**: las 5 preguntas/respuestas del acordeón FAQ, palabra por palabra.

### Texto plano para rastreadores de IA (footer)
Bloque "Urgent Dispatch Contact" añadido en el footer — WhatsApp, email, tiempos de recogida por hub (Shannon ~45min, Dublin ~2.5h, Cork ~2h, Belfast ~5-6h) y cobertura de los 32 condados, en HTML de texto real (no imagen) para que sea indexable.

### Meta tags
Title: `Albert Couriers | Dedicated Express Courier & 24/7 AOG Logistics Ireland`
Description menciona: furgoneta dedicada, 32 condados, AOG/Medical/Palletized freight.

### Dirección única (21/10/2026)
- `<link rel="canonical" href="https://albertcourierexpress.com/">` en el `<head>`
- `server.js` responde **301** a cualquier `GET`/`HEAD` que llegue a `www.albertcourierexpress.com`, hacia la misma ruta en `https://albertcourierexpress.com`. Los `POST` a `/api/*` no se redirigen (un 301 perdería el cuerpo de la petición)
- Motivo: la ficha de Google Business enlazaba a la versión con `www`, que servía la misma página (200) sin canonical — dos direcciones compitiendo por el mismo contenido

### Encabezados
```
h1: "Dedicated Express Courier Services in Ireland"   (antes NO existía ningún h1 — fallo real corregido)
h2: Our Core Services / Experience You Can Trust / Our Specialized Expertise /
    Our Professional Fleet / Frequently Asked Questions / Contact / Send Us a Direct Message
h3: cada sector dentro de Expertise, cada vehículo dentro de Fleet
```

### Rendimiento (Lighthouse real, no estimado)
Tras optimizaciones: Accesibilidad 95, Buenas Prácticas 100, SEO 100, **Rendimiento 92** (subió desde 70 — principal cuello de botella siguen siendo las 4 fotos de fondo JPG sin comprimir, ~2.2MB cada una; decisión consciente del dueño de priorizar el efecto visual).

Fixes de rendimiento aplicados:
- `preconnect` a `fonts.googleapis.com` / `fonts.gstatic.com`
- Barra de progreso del formulario animada con `transform: scaleX()` en vez de `width` (compositor-friendly, evita repintado de layout)
- `loading="lazy"` en el iframe del mapa

---

## 📝 Formularios (Web3Forms, NO Netlify)

Los tres formularios postean a `https://api.web3forms.com/submit` con un `access_key` público (por diseño de Web3Forms) y un campo honeypot `botcheck` anti-spam.

**⚠️ Web3Forms bloquea `*.up.railway.app`** — los envíos solo funcionan probando desde `albertcourierexpress.com`.

### 1. Solicitud de transporte (`#quoteForm`, 3 pasos)
- Paso 1: zona origen/destino (desplegable), vehículo, checkbox ASAP, checkbox AOG (con banner)
- Paso 2: mercancía, peso, pallets, dimensiones, tailift, hazardous
- Paso 3: direcciones exactas, email, teléfono, VAT, empresa, mensaje
- **No calcula ni envía precio** (desde el 26/09): el resumen dice *"Price — Quote on request"*
- Envía el ETA de recogida que vio el cliente y, en campos ocultos, la distancia y el tiempo de la ruta (`route_km`, `route_time`)

### 2. Formulario general (`#inquiryForm`)
- Full Name, Company (opcional), Email, Phone, Inquiry Type (desplegable: AOG/Medical/Energy/Fine Art/General), Message
- Notificación flotante ("toast") de éxito + mensaje inline
- Enlaces directos de llamada/WhatsApp junto al botón de envío

### 3. Colaboradores / subcontratistas (`#partnerForm`, desde el 27/09)
- Nombre, empresa, email, teléfono, zona que cubre, tipo de vehículo, mensaje
- Llega a Gmail con el asunto *"New Partner/Subcontractor Application — Albert Courier Express"* (primera solicitud real recibida el 21/10)

---

## 💰 Precios: la web no los publica (desde el 26/09/2026)

- **No hay tabla de tarifas en el código** (`PRICE_MATRIX`, `LOCAL_PRICE` y `renderPrice` se borraron): estaba a la vista en el código público aunque no se mostrara. **No volver a meterla.**
- El cliente manda la solicitud y Alberto responde con un presupuesto hecho a mano. La tarifa interna vive solo en el repo privado `NEGOCIO/`
- Se mantiene: ETA de recogida por zona de origen (Shannon ~45min, Dublin ~2.5h, Cork ~2h, Belfast ~5-6h) y el tiempo de trayecto real con OSRM, que suma siempre +30min de margen operativo
- "Other Location": se pide contacto directo
- Vehículos: **Ford Explorer** (100% EV, ligero) y **Maxus Deliver 9 Luton** con elevadora (desde el 01/10; la Transit se vendió). Ver [DATOS_WEB_REFERENCIA.md](DATOS_WEB_REFERENCIA.md#5-flota)

---

## 🗺️ Mapa

Google Maps Embed API (iframe, gratis) — NO Maps JavaScript API ni Mapbox (descartados, ver memoria del proyecto). Distancia/tiempo real vía Nominatim + OSRM, con caché y debounce de 1.1s.

---

## 💬 WhatsApp Floating Button

```
Position: fixed, bottom-right
Color: #25D366
Link: wa.me/353874592308 (mensaje pre-rellenado distinto según contexto)
```

---

## 🔐 Seguridad / Privacidad

- HTTPS automático (Railway + Let's Encrypt)
- Honeypot anti-spam en los tres formularios (no CAPTCHA)
- Sin cookies de terceros. Las analíticas son **propias**: `server.js` guarda las visitas con la IP anonimizada en `data/events.jsonl` (volumen de Railway, fuera de git) y descarta bots
- `server.js` solo entrega extensiones de una lista blanca y bloquea `data/`, `CAMBIOS/` y los `.js` fuera de `cpc/` (ver `isPublicPath()`): el servidor llegó a exponer el código y el registro de visitas
- `/stats/` y `/notas/` piden la clave de la variable `STATS_KEY` de Railway, que nunca se escribe en el repo

---

## 📦 Archivos del Proyecto

```
index.html              Todo el código de la web (HTML + CSS + JS embebidos)
server.js                Servidor Node sin dependencias: web, analíticas, notas, redirección de www
package.json             Solo "npm start" → node server.js (Node >= 18)
stats/, notas/           Panel de analíticas y buzón de notas (con clave)
robots.txt, sitemap.xml  Para buscadores, con la dirección sin www
favicon.png              Icono de pestaña (globo recortado de Mundomaslogo.jpg)
*.jpg                    Fotos de fondo, logos (Mundomaslogo.jpg, irlandamaslogo.jpg, fondos del carrusel)
whatsapp-qr.png          QR de WhatsApp Business recortado, usado en la firma de email
signature-vN.gif         Firma de email animada (GIF, versión N = la más reciente subida)
email-signature.html    HTML de la firma para abrir localmente y copiar/pegar en Gmail — NO es una página pública de la web
CAMBIOS/                 Esta documentación
cpc/                     App privada de tests CPC del dueño (sí está en git y desplegada en /cpc/, con PIN de acceso — ver nota abajo)
```

**No existe** `netlify.toml` (eliminado), ni `.hero-slide` con imágenes activas (se quitaron las fotos de la portada, solo queda el fondo de pantalla general).

**Nota sobre `cpc/`:** app de tests aparte del negocio (examen "Transport Manager CPC – Passenger" que estudia el dueño), en `https://albertcourierexpress.com/cpc/`, protegida con PIN local (`localStorage`, no es seguridad real) y sin enlace desde el menú ni el `robots.txt`/`meta robots` la indexa. `CPC-tests/` y `CPC course/` sí son material personal (txt/pdf) que queda en la misma carpeta del proyecto pero **deliberadamente sin añadir a git** — cuidado con `git add .` en vez de añadir archivos por nombre.

---

## 🚀 Deployment Pipeline

```
Local Edit → git push → GitHub → Railway detecta el push → npm start (node server.js) → Deploy
                                                                    ↓
                                        https://albertcourierexpress.com (~1-2 min)
```

- **Comprobar que se publicó:** en Railway → Deployments debe aparecer el commit nuevo. El 21/10 el push de `5d10e58` no generó despliegue (el último era del 01/10) — si vuelve a pasar, es Railway, no el código
- El CDN de Railway cachea 1 hora: verificar con `?nc=<número>` en la URL. Invalidar de verdad solo lo puede hacer el dueño (Railway → Settings → Purge All)
- No hay Node en el ordenador de Alberto: la sintaxis de `server.js` se valida con Edge headless (`new Function(código)`), ver `CLAUDE.md`

---

**Última actualización:** 2026-10-21
