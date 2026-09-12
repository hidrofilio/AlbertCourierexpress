# 📋 Registro de Cambios - Albert Courier Express

**Última actualización:** 2026-09-12

---

## 🎯 Proyecto Actual

**Web:** https://albertcourierexpress.com
**Repositorio:** https://github.com/hidrofilio/AlbertCourierexpress
**Hosting:** Railway (Deploy automático desde GitHub, servido por Caddy)
**Formularios:** Web3Forms (no Netlify — Netlify se abandonó por límites de ancho de banda con vídeos de fondo)

**Modelo de negocio:** Dedicated Express Courier — vehículo exclusivo punto a punto (no paquetería compartida), cobertura en Irlanda + Irlanda del Norte (los 32 condados), sin Reino Unido. Base en Limerick/Shannon.

---

## ✨ Estado Actual de la Web

#### 💰 **Cotizador de Tarifa Plana por Zonas** ✅
- Formulario de 3 pasos: zonas (origen/destino) + vehículo → mercancía → datos de contacto
- Matriz de precios fija por par de zonas (Shannon/Limerick, Dublin, Cork, Belfast) y tipo de vehículo
- Casilla AOG / Time-Critical con banner de llamada/WhatsApp directo
- ETA estimado de recogida según zona de origen
- Mapa de ruta (Google Maps Embed API) + distancia/tiempo real vía Nominatim + OSRM

#### 📩 **Dos formularios, ambos vía Web3Forms** ✅
- Cotizador (`#calculator`, arriba de la portada)
- Formulario general de contacto (`#inquiry`, antes del footer) con notificación flotante de éxito

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
- Our Professional Fleet (Ford Explorer EV + Ford Transit Custom — **sin Citroën**, se eliminó)
- FAQ (acordeón, 5 preguntas, con schema FAQPage)
- Contact (tabla) + Send Us a Direct Message (formulario general)

#### 📊 **SEO Técnico** ✅
- Title/description optimizados para clientes corporativos
- Schema.org `LogisticsService` (no `LocalBusiness` genérico) + `FAQPage` JSON-LD
- H1 real en el hero (antes no existía)
- `preconnect` a Google Fonts

#### ♿ **Accesibilidad** — mantenida desde el origen (WCAG 2.1 AA: skip link, aria-labels, roles semánticos, contraste)

---

## 📈 Estructura del Proyecto

```
AlbertoCourierExpress/
├── index.html          (Archivo único: HTML + CSS + JS)
├── *.jpg                (Fotos de fondo y logos)
├── .git/
└── CAMBIOS/
    ├── README.md        (Este archivo — resumen del estado actual)
    ├── CHANGELOG.md     (Historial manual — discontinuado el 2026-09-09, ver git log después)
    ├── FEATURES.md      (Detalle técnico actual)
    └── COMO_AGREGAR_CAMBIOS.md
```

**Nota:** ya no existe `netlify.toml` — se eliminó al migrar a Railway.

---

## 🔄 Cómo Funcionan los Cambios

1. Editar el código en `index.html`
2. `git add` + `git commit` + `git push`
3. **Railway despliega automáticamente** en ~1-2 minutos
4. Ojo con la caché del navegador: añadir `?v=N` a la URL para forzar la versión nueva

---

## 📧 Contacto para Soporte

**Email:** hidrofilio@gmail.com
**WhatsApp / Teléfono:** +353 (87) 459 2308

---

**Para el historial completo y real de cambios, usar `git log` — este documento es un resumen, no la fuente de verdad.**

**Última revisión:** 2026-09-12
