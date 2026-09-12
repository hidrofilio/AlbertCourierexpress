# 🎯 Features Técnicos - Albert Courier Express

**Última actualización:** 2026-09-12 — reemplaza la versión de 2026-09-09, que describía la web previa a Netlify (colores naranja, Citroën en la flota, `LocalBusiness` genérico, formulario Netlify). Todo eso ya no existe.

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
1. **`LogisticsService`** (no `LocalBusiness` genérico): incluye `areaServed` (Ireland + Northern Ireland como entidades separadas), `makesOffer` con los 6 sectores de especialidad, `slogan`, base en Limerick/Shannon.
2. **`FAQPage`**: las 5 preguntas/respuestas del acordeón FAQ, palabra por palabra.

### Meta tags
Title: `Albert Couriers | Dedicated Express Courier & 24/7 AOG Logistics Ireland`
Description menciona: furgoneta dedicada, 32 condados, AOG/Medical/Palletized freight.

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

Ambos formularios postean a `https://api.web3forms.com/submit` con un `access_key` público (por diseño de Web3Forms) y un campo honeypot `botcheck` anti-spam.

**⚠️ Web3Forms bloquea `*.up.railway.app`** — los envíos solo funcionan probando desde `albertcourierexpress.com`.

### 1. Cotizador (`#quoteForm`, 3 pasos)
- Paso 1: zona origen/destino (desplegable), vehículo, checkbox ASAP, checkbox AOG (con banner)
- Paso 2: mercancía, peso, pallets, dimensiones, tailift, hazardous
- Paso 3: direcciones exactas, email, teléfono, VAT, empresa, mensaje
- Envía también el precio calculado y el ETA de recogida que vio el cliente

### 2. Formulario general (`#inquiryForm`)
- Full Name, Company (opcional), Email, Phone, Inquiry Type (desplegable: AOG/Medical/Energy/Fine Art/General), Message
- Notificación flotante ("toast") de éxito + mensaje inline
- Enlaces directos de llamada/WhatsApp junto al botón de envío

---

## 💰 Motor de precios (tarifa plana, NO por km)

Ver `[[project-albert-courier]]` en memoria para la matriz completa. Resumen:
- Misma zona: €90
- Pares de zona (Shannon/Dublin/Cork/Belfast): matriz fija por vehículo (Explorer / Transit)
- "Other Location": sin precio, mensaje de contacto directo
- ETA de recogida por zona de origen (45min–6h)
- Vehículos: **solo 2** — Ford Explorer (100% EV, Light/Small) y Ford Transit Custom (Medium Van). El Citroën Relay se eliminó por completo.

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
- Honeypot anti-spam en ambos formularios (no CAPTCHA)
- Sin cookies de terceros ni tracking

---

## 📦 Archivos del Proyecto

```
index.html        Todo el código (HTML + CSS + JS embebidos)
*.jpg              Fotos de fondo, logos
CAMBIOS/           Esta documentación
```

**No existe** `netlify.toml` (eliminado), ni `.hero-slide` con imágenes activas (se quitaron las fotos de la portada, solo queda el fondo de pantalla general).

---

## 🚀 Deployment Pipeline

```
Local Edit → git push → GitHub → Railway detecta el push → Build (Caddy) → Deploy
                                                                    ↓
                                        https://albertcourierexpress.com (~1-2 min)
```

---

**Última actualización:** 2026-09-12
