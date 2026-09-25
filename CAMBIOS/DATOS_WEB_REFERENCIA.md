# 📌 Datos de la Web — Ficha de Referencia

**Última verificación contra el código:** 2026-09-15
**Fuente:** `index.html` (leído directamente, no de memoria)

> Este documento es la ficha rápida de "qué dice la web". Útil para responder a IAs (Gemini/ChatGPT),
> rellenar directorios, perfiles de redes sociales o cualquier sitio donde haya que repetir estos datos
> sin tener que abrir el código. **Si se cambia algo en la web, actualizar aquí también.**

---

## 1. Identidad de la empresa

| Dato | Valor |
|---|---|
| Nombre comercial | Albert Courier Express Ireland |
| Nombre legal | **Albert Couriers Limited** |
| Fundador / Director | Alberto Tome Aranda |
| Company No. (CRO) | 792955 |
| VAT | IE4443513PH |
| Base | Limerick / Shannon, Irlanda |
| Dominio canónico | `https://albertcourierexpress.com` (**sin `www.`**) |
| Teléfono / WhatsApp | +353 (87) 459 2308 — 24/7/365 |
| Email | info@albertcourierexpress.com |
| Reseñas Google | https://g.page/r/CVWrGoZS_82eEBM/review |
| Idiomas de atención | Inglés y español |

**Eslogan:** *Dedicated Express Courier & 24/7 AOG Logistics*

---

## 2. A qué nos dedicamos

**Modelo:** *Dedicated Express Courier* — vehículo exclusivo punto a punto. El envío viaja solo,
directo de recogida a entrega. **No** es paquetería compartida, **no** hay multi-parada,
**no** se espera a otras paradas.

**Experiencia:** +10 años en el sector transporte, de los cuales +5 especializados en exprés.

### Los 6 sectores de especialización
1. **Aviación y AOG (Aircraft On Ground)** — piezas aeronáuticas de emergencia. Cadenas de suministro de aerolíneas europeas (Ryanair, Aer Lingus).
2. **Medical, Lab y Farmacéutico** — componentes de laboratorio, dispositivos médicos, suministro farmacéutico urgente.
3. **Energía e Industrial (Oil & Gas)** — componentes industriales críticos, piezas de perforación offshore. Cliente de referencia: SGS.
4. **Alto Valor y Obras de Arte** — carga discreta y segura, piezas de museo y exposiciones culturales.
5. **High-Tech y Electrónica** — componentes electrónicos sensibles, semiconductores, hardware de alto valor.
6. **Automoción Pesada y Soporte de Flotas** — recambios de vehículo comercial, maquinaria pesada, transmisiones.

---

## 3. Zona de cobertura

**Los 32 condados de la isla de Irlanda** = República de Irlanda + Irlanda del Norte.
**NO** se opera en Gran Bretaña / Reino Unido continental.

Corredores habituales: Dublin ↔ Shannon ↔ Cork ↔ Belfast.

### Las 4 zonas tarifarias y sus puntos de referencia
| Zona | Punto de referencia | Coordenadas | Tiempo estimado de recogida |
|---|---|---|---|
| Shannon/Limerick Area | Shannon Airport | 52.7019, -8.9248 | **~45 minutos** |
| Cork Area | Cork Airport | 51.8413, -8.4911 | **~2 horas** |
| Dublin Area | Dublin Airport | 53.4264, -6.2499 | **~2,5 horas** |
| Belfast Area | Belfast City Centre | 54.5973, -5.9301 | **5 a 6 horas** |

Cualquier otro punto = "Other Location" → sin precio automático, se pide contacto directo.

---

## 4. Precios: **ya no se publican** (26/09/2026)

**La web no da precios.** El cliente rellena la solicitud (recogida, entrega, fecha, carga,
vehículo y contacto) y Alberto responde con un presupuesto hecho a mano, según el trabajo que
tenga esa semana. Decisión suya del 25/09.

Lo que ve el cliente en el resumen:

| Antes | Ahora |
|---|---|
| "Estimated price — €320 + VAT" | **"Price — Quote on request"** |
| "Indicative only. We confirm the final price…" | **"Send the request and we reply fast with your price — 24/7."** |
| Subtítulo: *"flat rates on our main Irish corridors"* | *"tell us where and when, and we come straight back with your price"* |

**La tabla de tarifas se ha borrado del código** (`PRICE_MATRIX`, `LOCAL_PRICE`, `renderPrice`).
Estaba a la vista de cualquiera en el código público de la página, aunque no se mostrara.

**La tarifa interna** (lo que conviene cobrar de verdad, con el suelo por hora) vive solo en el
repo privado: `NEGOCIO/rentabilidad.md`.

**Lo que sí sigue:**
- **Distancia y tiempo de conducción:** se calculan igual y se le mandan a Alberto en el correo
  (`route_km` y `route_time`), para poder presupuestar en un minuto.
- **Tiempo estimado de recogida por zona** (los ~45 min de Shannon, etc.).
- **Analítica de qué rutas consulta la gente**, que es la mejor pista de dónde hay demanda.

**Nota legal que aparece en la web:** empresas con VAT de otros países UE pueden facturarse sin IVA
irlandés bajo el mecanismo de inversión del sujeto pasivo (reverse charge), indicando su número de VAT.

---

## 5. Flota

| Vehículo | Tipo | Carga máxima | Ideal para |
|---|---|---|---|
| **Ford Explorer** | 100% eléctrico, courier ligero | 1,5 m L × 1,3 m A × 1,0 m H | Paquetes, cajas, piezas críticas, urbano rápido |
| **Ford Transit Custom** | Furgoneta media dedicada | 2,8 m L × 1,4 m A × 1,4 m H | Palés, bultos grandes, mercancía comercial |

---

## 6. Distancias y tiempos reales entre hubs

Calculado con OSRM. La web suma siempre **+30 min de margen operativo** al tiempo de conducción real.

| Ruta | Distancia | Tiempo estimado (con margen) |
|---|---|---|
| Shannon ↔ Cork | 132 km | ~2h 27min |
| Dublin ↔ Belfast | 159 km | ~2h 21min |
| Shannon ↔ Dublin | 238 km | ~3h 19min |
| Cork ↔ Dublin | 272 km | ~3h 38min |
| Shannon ↔ Belfast | 391 km | ~4h 57min |
| Cork ↔ Belfast | 428 km | ~5h 17min |

---

## 7. Preguntas frecuentes publicadas (FAQ con schema)

1. ¿Qué es un servicio de courier exprés dedicado?
2. ¿Con qué rapidez se recogen envíos urgentes en Irlanda?
3. ¿Gestionáis logística AOG time-critical?
4. ¿Qué vehículos hay en la flota?
5. ¿Los corredores están restringidos a rutas fijas?

---

## 8. Archivos de imagen que SÍ existen en el servidor

Útil para no volver a referenciar archivos inexistentes en schema, Open Graph o firmas.

| Archivo | Uso |
|---|---|
| `favicon.png` | Icono de pestaña |
| `Mundomaslogo.jpg` | Logo completo (globo + nombre) |
| `whatsapp-qr.png` | QR de WhatsApp Business |
| `signature-v5.gif` | Firma de email animada |
| `og-image.jpg` | Vista previa al compartir en redes (creado 2026-09-15) |
| Fondos | `fondodepantallamasoscuro.jpg`, `imagendefondoconvehiculo.jpg`, `fondoalbertcourier.jpg`, `fondoexpressservices.jpg` |

---

**Para el detalle técnico del proyecto ver [FEATURES.md](FEATURES.md) y [README.md](README.md).**
