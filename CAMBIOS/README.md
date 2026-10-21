# 📋 Registro de Cambios - Albert Courier Express

**Última actualización:** 2026-10-21

> ⚠️ **Este repositorio es público.** Aquí no van precios, tarifas, costes ni claves. Los datos
> de negocio viven en el repo privado `NEGOCIO/`. La ficha de lo que dice la web está en
> [DATOS_WEB_REFERENCIA.md](DATOS_WEB_REFERENCIA.md).

---

## 🎯 Proyecto Actual

**Web:** https://albertcourierexpress.com (dominio oficial **sin `www`**)
**Repositorio:** https://github.com/hidrofilio/AlbertCourierexpress
**Hosting:** Railway, con despliegue automático desde GitHub. Lo sirve `server.js`, un servidor Node propio (sin dependencias) que entrega la web y guarda las analíticas — Railway lo arranca con `npm start`
**Formularios:** Web3Forms (no Netlify — Netlify se abandonó por límites de ancho de banda con vídeos de fondo)

**Modelo de negocio:** Dedicated Express Courier — vehículo exclusivo punto a punto (no paquetería compartida), cobertura en Irlanda + Irlanda del Norte (los 32 condados), sin Reino Unido. Base en Limerick/Shannon.

---

## ✨ Estado Actual de la Web

#### 📝 **Formulario de solicitud por zonas — sin precios desde el 26/09** ✅
- Formulario de 3 pasos: zonas (origen/destino) + vehículo → mercancía → datos de contacto
- **No muestra precio:** el resumen dice *"Price — Quote on request"* y Alberto contesta con un presupuesto hecho a mano. La tabla de tarifas se borró del código
- Al correo de Alberto sí le llegan la ruta, los km y el tiempo de conducción, para presupuestar rápido
- Casilla AOG / Time-Critical con banner de llamada/WhatsApp directo
- ETA estimado de recogida según zona de origen
- Mapa de ruta (Google Maps Embed API) + distancia/tiempo real vía Nominatim + OSRM

#### 📩 **Tres formularios, todos vía Web3Forms** ✅
- Solicitud de transporte (`#quoteForm`, arriba de la portada)
- Formulario general de contacto (`#inquiryForm`, antes del footer) con notificación flotante de éxito
- **Colaboradores / subcontratistas** (`#partnerForm`, desde el 27/09): llega a Gmail como *"New Partner/Subcontractor Application"*

#### 📂 **Secciones plegables** ✅ (27/09)
- Las secciones de la página se pliegan y se abren al pulsar en el menú; al recargar, la página vuelve arriba

#### 🎨 **Diseño Glassmorphism / Dark Mode** ✅
- Fondo azul eléctrico unificado (`--accent-color: #0066FF`)
- Fondo de pantalla con 4 fotos en carrusel (Ken Burns lento, 40s) + oscura intercalada entre cada una
- Recuadros con fondo translúcido, borde azul al 20% y `backdrop-filter: blur(12px)`
- Iconos animados (flotan) en la sección de especialidades

#### 🚚 **Secciones de contenido**
- Hero con H1 + cotizador
- Our Core Services
- Experience You Can Trust (About Us: 10+ años, corredores Dublin/Shannon/Cork/Belfast)
- Our Specialized Expertise (6 sectores: AOG/Aviation, Medical, Energy, Fine Art, High-Tech, Heavy Automotive)
- Our Professional Fleet (Ford Explorer EV + **Maxus Deliver 9 Luton** con elevadora, desde el 01/10 — la Transit se vendió)
- FAQ (acordeón, 5 preguntas, con schema FAQPage)
- Contact (tabla) + Send Us a Direct Message (formulario general)

#### 📊 **SEO Técnico** ✅
- Title/description optimizados para clientes corporativos
- Schema.org `LogisticsService` (no `LocalBusiness` genérico) + `FAQPage` JSON-LD
- H1 real en el hero (antes no existía)
- `preconnect` a Google Fonts
- `robots.txt` y `sitemap.xml`
- **Dirección única para Google (21/10):** `<link rel="canonical">` a `https://albertcourierexpress.com/` y redirección 301 de `www.albertcourierexpress.com` a la dirección sin `www`. La ficha de Google Business enlazaba a la versión con `www`, que servía la misma página y repartía el posicionamiento entre dos direcciones

#### ♿ **Accesibilidad** — mantenida desde el origen (WCAG 2.1 AA: skip link, aria-labels, roles semánticos, contraste)

#### 🖼️ **Favicon** ✅
- `favicon.png`: recorte cuadrado del globo del logo `Mundomaslogo.jpg`, enlazado en `<head>` (`<link rel="icon">`)

#### 🤖 **SEO para IA / LLMs ("AI SEO")** ✅ (2026-09-13)
- Schema `LogisticsService` ampliado a tipo doble `["LogisticsService", "EmergencyService"]`
- Añadidos `email`, `founder` (Alberto Tome Aranda) y `contactPoint` (teléfono, email, WhatsApp, idiomas, horario 24/7) como datos estructurados
- Nuevo bloque de **texto plano visible** en el footer ("Urgent Dispatch Contact") con WhatsApp, email, tiempos de recogida por hub y cobertura — pensado para que los rastreadores de ChatGPT/Gemini/Perplexity lo indexen y citen directamente (no es una imagen, es texto real en el HTML)
- Pendiente de que el usuario haga en sus propias cuentas: activar Mensajes + WhatsApp en Google Business Profile, categorías "Courier Service"/"Freight Forwarder"/"Logistics Service", página de empresa en LinkedIn, altas en directorios de logística/aviación irlandeses

#### 📈 **Analíticas propias y buzón de notas** ✅
- `server.js` registra las visitas en `data/events.jsonl` (volumen persistente de Railway, **no está en git**); filtro antibots
- Panel en `/stats/` y buzón de notas desde el móvil en `/notas/`, ambos con la clave de la variable `STATS_KEY` de Railway (nunca en el código)

---

## 🕒 Cambios desde el 13/09/2026 (resumen; el detalle está en `git log`)

| Fecha | Cambio |
|---|---|
| 13/09 | Schema `EmergencyService`, puntos de contacto y bloque de texto para buscadores de IA · enlace a reseñas de Google · firma de correo |
| 14/09 | Analíticas propias (servidor Node + panel `/stats/`) · QR de WhatsApp en la sección de contacto · menú reordenado |
| 16/09 | El servidor deja de exponer el código y el registro de visitas · página de 8,8 MB a menos de 1 MB · `robots.txt` y `sitemap.xml` · gráficas del panel · buzón de notas `/notas/` · arreglo de fecha/hora en iOS |
| 26/09 | **La web deja de publicar precios**: cada trabajo se presupuesta a mano · la clave del panel sale del código público |
| 27/09 | Formulario de colaboradores/subcontratistas · secciones plegables |
| 01/10 | La Luton (Maxus Deliver 9) sustituye a la Transit en la flota |
| 21/10 | Redirección de `www` a la dirección sin `www` + etiqueta `canonical` (commit `5d10e58`). ⚠️ **Subido a GitHub pero Railway no lo había publicado** a 21/10: su último despliegue era del 01/10 — revisar Railway → Deployments |

---

## 📧 Correo Profesional y Firma de Email (2026-09-13)

- **Correo corporativo:** `info@albertcourierexpress.com` contratado en **Namecheap Private Email** (plan Launch, 1 buzón/5GB) — NO Zoho (se descartó por no tener ya plan gratuito para dominios nuevos)
- **Conectado a Gmail personal** (`hidrofilio@gmail.com`) por dos vías:
  - Reenvío automático (Forwarding) activado en Namecheap → llega todo a la bandeja de Gmail de siempre
  - "Enviar correo como" en Gmail vía SMTP de Namecheap (`mail.privateemail.com`, puerto 465 SSL) → se puede redactar y enviar como `info@albertcourierexpress.com` sin salir de Gmail
- **Firma de email** (`email-signature.html`, no se sube a producción como página, solo se abre localmente para copiar/pegar en Gmail):
  - Es un **GIF animado** (`signature-vN.gif` en la raíz del repo — el número de versión sube cada vez que se regenera, ver el archivo `email-signature.html` para saber cuál es el vigente) que cicla entre los 4 fondos de la web (fotos completas, sin recortar, mismo encuadre/zoom en las cuatro)
  - Incluye: logo completo (`Mundomaslogo.jpg`), nombre "Albert Courier Express", "Alberto Tome Aranda - Founder", línea de servicios (24/7 AOG | Medical & Lab | Urgent Freight | High-Value Cargo), teléfono/email/web, QR de WhatsApp Business (recortado de `WhatsappBusinessAccount.jpg`), y datos legales (Albert Couriers Limited, CRO, VAT)
  - Renderizada al doble de resolución (1640×520, se muestra a 820×260) para que el texto no se vea pixelado
  - **Detalle técnico importante:** el GIF animado se construye a mano con PowerShell/.NET (`System.Drawing`) fusionando fotogramas GIF individuales a nivel de bytes (no hay ImageMagick/ffmpeg instalados en el entorno) — cada fotograma necesita su propia tabla de color local copiada de su tabla global original, si no el GIF sale corrupto/en blanco (bug real que ocurrió y se corrigió)
  - Cachear en Railway/CDN puede servir una versión vieja del GIF tras redeploy — si pasa, renombrar el archivo (subir versión) es más rápido que pelear con cache-busting

---

## 📈 Estructura del Proyecto

```
AlbertoCourierExpress/
├── index.html               (Archivo único: HTML + CSS + JS de la web principal)
├── server.js                (Servidor Node: entrega la web, analíticas, notas, redirección de www)
├── package.json             (Solo el `npm start` que usa Railway)
├── stats/, notas/           (Panel de analíticas y buzón de notas, con clave)
├── robots.txt, sitemap.xml
├── data/                     (Registro de visitas y notas — volumen de Railway, NO está en git)
├── favicon.png               (Icono de pestaña)
├── whatsapp-qr.png            (QR de WhatsApp Business, usado en la firma de email)
├── signature-vN.gif           (Firma de email animada — N = versión más reciente)
├── email-signature.html      (HTML de la firma, para copiar/pegar en Gmail; no es una página pública)
├── *.jpg                      (Fotos de fondo, logos)
├── cpc/                       (App privada de tests CPC del dueño, con PIN — no relacionada con el negocio)
├── CPC-tests/, CPC course/    (Material de estudio personal — NO están en git)
├── .git/
└── CAMBIOS/
    ├── README.md        (Este archivo — resumen del estado actual)
    ├── CHANGELOG.md     (Historial manual — discontinuado el 2026-09-09, ver git log después)
    ├── FEATURES.md      (Detalle técnico actual)
    ├── DATOS_WEB_REFERENCIA.md (Ficha de lo que dice la web)
    └── COMO_AGREGAR_CAMBIOS.md
```

**Nota:** ya no existe `netlify.toml` — se eliminó al migrar a Railway.

---

## 🔄 Cómo Funcionan los Cambios

1. Editar el código en `index.html` (o `server.js`)
2. `git add` **por nombre de archivo** + `git commit` + `git push` (nunca `git add .`: hay material personal en la carpeta)
3. **Railway despliega automáticamente** en ~1-2 minutos. Si no aparece un despliegue nuevo en Railway → Deployments, no se ha publicado
4. Ojo con la caché: el CDN de Railway guarda 1 hora. Comprobar con `?nc=<número>` al final de la URL

---

## 📧 Contacto para Soporte

**Email personal (dueño):** hidrofilio@gmail.com
**Email corporativo:** info@albertcourierexpress.com (Namecheap Private Email, reenviado y enviable desde el Gmail personal — ver sección de Correo Profesional arriba)
**WhatsApp / Teléfono:** +353 (87) 459 2308

---

**Para el historial completo y real de cambios, usar `git log` — este documento es un resumen, no la fuente de verdad.**

**Última revisión:** 2026-10-21
