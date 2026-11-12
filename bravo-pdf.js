// Bravo Transfers — PDFs sin dependencias: factura, justificante de reserva y hoja de servicio.
// Usa las fuentes que trae todo lector de PDF (Helvetica) con la codificación WinAnsi, que
// cubre las letras del español y el símbolo del euro.
'use strict';
const fs = require('fs');
const path = require('path');

// El logo (un JPG normal) se mete tal cual en los PDF. Si falta, se dibuja un sol.
const LOGO = (function () {
  try {
    const buf = fs.readFileSync(path.join(__dirname, 'bravo', 'logo-pdf.jpg'));
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
        const comps = buf[i + 9];
        return { buf, h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), space: comps === 1 ? '/DeviceGray' : '/DeviceRGB', ok: comps === 1 || comps === 3 };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch (e) { /* sin logo */ }
  return null;
})();

// Anchos de Helvetica y Helvetica-Bold (caracteres 32 a 126), en milésimas del tamaño.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const SPECIAL = { '−': 0x2d, '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '→': 0xBB };

// Texto JS → bytes WinAnsi (como cadena "latin1": un carácter = un byte)
function winAnsi(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += String.fromCharCode(c);
    else if (SPECIAL[ch]) out += String.fromCharCode(SPECIAL[ch]);
    else if (c === 0x09 || c === 0x0a) out += ' ';
    else out += '?';
  }
  return out;
}
function charWidth(ch, bold) {
  const table = bold ? WB : W;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return table[c - 32];
  const base = ch.normalize('NFD').charAt(0);
  const b = base.charCodeAt(0);
  if (b >= 32 && b <= 126) return table[b - 32];
  return 556;
}
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch, bold);
  return (w * size) / 1000;
}
function pdfString(s) {
  return '(' + winAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
}

const PAGE_W = 595, PAGE_H = 842;
const C = { ink: [0.09, 0.07, 0.05], gold: [0.90, 0.71, 0.29], orange: [0.87, 0.48, 0.17], muted: [0.44, 0.38, 0.32], line: [0.88, 0.84, 0.78], band: [0.95, 0.93, 0.88], white: [1, 1, 1], red: [0.70, 0.15, 0.12] };
const rgb = (c) => c.map((v) => v.toFixed(3)).join(' ');

function canvas() {
  const ops = [];
  const api = {
    // y se mide desde ARRIBA de la página
    text(x, y, s, o) {
      o = o || {};
      const size = o.size || 10, bold = Boolean(o.bold);
      let tx = x;
      if (o.align === 'right') tx = x - textWidth(s, size, bold);
      if (o.align === 'center') tx = x - textWidth(s, size, bold) / 2;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(o.color || C.ink)} rg ${tx.toFixed(2)} ${(PAGE_H - y).toFixed(2)} Td ${pdfString(s)} Tj ET`);
    },
    rect(x, y, w, h, color) { ops.push(`${rgb(color)} rg ${x} ${(PAGE_H - y - h).toFixed(2)} ${w} ${h} re f`); },
    line(x1, y1, x2, y2, color, width) { ops.push(`${rgb(color || C.line)} RG ${width || 0.8} w ${x1} ${(PAGE_H - y1).toFixed(2)} m ${x2} ${(PAGE_H - y2).toFixed(2)} l S`); },
    // El logo, con su esquina de arriba a la izquierda en (x, y) y w de ancho. Devuelve su alto (0 si no hay logo).
    image(x, y, w) {
      if (!LOGO || !LOGO.ok) return 0;
      const h = (w * LOGO.h) / LOGO.w;
      ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(PAGE_H - y - h).toFixed(2)} cm /Im1 Do Q`);
      return h;
    },
    halfSun(cx, yBase, r, color) {
      const k = 0.5523 * r, by = PAGE_H - yBase;
      ops.push(`${rgb(color)} rg ${cx - r} ${by} m ${cx - r} ${by + k} ${cx - k} ${by + r} ${cx} ${by + r} c ${cx + k} ${by + r} ${cx + r} ${by + k} ${cx + r} ${by} c h f`);
    },
    wrap(s, size, bold, maxW) {
      const lines = [];
      for (const para of String(s == null ? '' : s).split(/\n/)) {
        let cur = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
          const next = cur ? cur + ' ' + word : word;
          if (textWidth(next, size, bold) <= maxW || !cur) cur = next;
          else { lines.push(cur); cur = word; }
        }
        lines.push(cur);
      }
      return lines;
    },
    ops
  };
  return api;
}

// Une una o varias páginas (cada una, su lista de órdenes de dibujo) en un PDF
function assemble(opsOrPages, title) {
  const pages = Array.isArray(opsOrPages[0]) ? opsOrPages : [opsOrPages];
  const n = pages.length;
  const img = LOGO && LOGO.ok ? 1 : 0;
  const first = 6 + img; // número del primer objeto de página
  // Objetos: 1 catálogo, 2 páginas, 3 y 4 fuentes, 5 info, (6 logo), y luego página + contenido por cada hoja
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, k) => (first + k * 2) + ' 0 R').join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${pdfString(title)} /Producer (Bravo Transfers) >>`
  ];
  if (img) {
    objs.push(`<< /Type /XObject /Subtype /Image /Width ${LOGO.w} /Height ${LOGO.h} /ColorSpace ${LOGO.space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO.buf.length} >>\nstream\n${LOGO.buf.toString('latin1')}\nendstream`);
  }
  const res = `<< /Font << /F1 3 0 R /F2 4 0 R >>${img ? ' /XObject << /Im1 6 0 R >>' : ''} >>`;
  pages.forEach((ops, k) => {
    const content = ops.join('\n');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${res} /Contents ${first + 1 + k * 2} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i2) => { offsets.push(out.length); out += `${i2 + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- piezas comunes ----------
function header(c, title, subtitle) {
  const h = c.image(40, 20, 88);
  if (!h) { c.halfSun(80, 70, 26, C.gold); c.line(48, 76, 112, 76, C.gold, 2); }
  c.text(138, 52, 'BRAVO', { size: 24, bold: true });
  c.text(139, 67, 'T R A N S F E R S', { size: 8, color: C.orange });
  c.text(555, 48, title, { size: 15, bold: true, align: 'right' });
  if (subtitle) c.text(555, 66, subtitle, { size: 10, color: C.orange, align: 'right' });
  c.line(40, 94, 555, 94, C.gold, 1.5);
}
function footer(c, lines) {
  c.line(40, 790, 555, 790, C.line);
  let y = 806;
  for (const l of lines.filter(Boolean)) { c.text(297, y, l, { size: 8, color: C.muted, align: 'center' }); y += 11; }
}
function money(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
}
function day(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '');
}
// Filas "etiqueta: valor", con salto de línea si el valor es largo
function rows(c, x, y, list, labelW, maxW) {
  for (const [label, value] of list) {
    if (value == null || value === '') continue;
    c.text(x, y, label, { size: 9, color: C.muted });
    const lines = c.wrap(value, 10.5, false, maxW - labelW);
    lines.forEach((l, i) => c.text(x + labelW, y + i * 14, l, { size: 10.5 }));
    y += Math.max(1, lines.length) * 14 + 4;
  }
  return y;
}

function vehicleName(v, lang) {
  if (v === 'van') return lang === 'en' ? 'People carrier (up to 7)' : 'Monovolumen (hasta 7)';
  if (v === 'car') return lang === 'en' ? 'Car (up to 4)' : 'Coche (hasta 4)';
  return '';
}
function placeFrom(b) { return b.kind === 'group' ? b.fromText : (b.from && b.from.label) || ''; }
function placeTo(b) { return b.kind === 'group' ? b.toText : (b.to && b.to.label) || ''; }

// Concepto de la factura (bilingüe: los clientes son extranjeros)
function concept(b) {
  const when = day(b.date) + ' ' + b.time;
  if (b.kind === 'hourly') return `Servicio de coche con conductor por horas / Chauffeur service by the hour: ${b.hours} h, ${placeFrom(b)}, ${when}`;
  if (b.kind === 'group') return `Transporte de grupo / Group transport: ${placeFrom(b)} → ${placeTo(b)}, ${when}, ${b.passengers} pers.`;
  return `Traslado privado / Private transfer${b.roundTrip ? ' (ida y vuelta / return)' : ''}: ${placeFrom(b)} → ${placeTo(b)}, ${when}` +
    (b.km ? `, ${b.km} km` : '') + (b.vehicle ? `, ${vehicleName(b.vehicle, 'en')}` : '');
}

// ---------- FACTURA ----------
function invoicePdf(b, which) {
  const inv = which || b.invoice, iss = inv.issuer || {}, cus = inv.customer || {};
  const c = canvas();
  const credit = inv.kind === 'rectificativa';
  header(c, credit ? 'FACTURA RECTIFICATIVA' : 'FACTURA / INVOICE', inv.number);
  if (inv.status === 'anulada') c.text(555, 112, 'ANULADA / VOID', { size: 16, bold: true, color: C.red, align: 'right' });
  if (inv.status === 'rectificada') c.text(40, 104, 'Rectificada por / Corrected by ' + inv.rectifiedBy, { size: 9.5, bold: true, color: C.red });

  c.text(40, 122, 'EMISOR / FROM', { size: 8, bold: true, color: C.muted });
  c.text(40, 138, iss.name || 'Bravo Transfers', { size: 12, bold: true });
  let y = 154;
  for (const l of [iss.taxId ? 'NIF/CIF / Tax ID: ' + iss.taxId : 'NIF/CIF / Tax ID: (pendiente / pending)'].concat(c.wrap(iss.address || '', 10, false, 230), [iss.email, iss.phone])) {
    if (!l) continue;
    c.text(40, y, l, { size: 10 }); y += 13;
  }
  const meta = [['Nº factura / Invoice no.', inv.number], ['Fecha / Date', day(inv.date)], ['Reserva / Booking', b.ref], ['Servicio / Service', day(b.date) + ' ' + b.time]];
  if (credit) meta.push(['Rectifica / Corrects', inv.rectifies + ' (' + day(inv.rectifiesDate) + ')']);
  let my = 122;
  for (const [k, v] of meta) {
    c.text(330, my, k, { size: 8, bold: true, color: C.muted });
    c.text(555, my, v, { size: 10, bold: true, align: 'right' });
    my += 17;
  }

  y = Math.max(y, my) + 14;
  c.text(40, y, 'CLIENTE / CUSTOMER', { size: 8, bold: true, color: C.muted }); y += 16;
  c.text(40, y, cus.name || '', { size: 12, bold: true }); y += 15;
  for (const l of [cus.taxId ? 'NIF/CIF / Tax ID: ' + cus.taxId : ''].concat(c.wrap(cus.address || '', 10, false, 300), [cus.email])) {
    if (!l) continue;
    c.text(40, y, l, { size: 10 }); y += 13;
  }

  y += 18;
  c.rect(40, y, 515, 24, C.band);
  c.text(50, y + 16, 'CONCEPTO / DESCRIPTION', { size: 8.5, bold: true, color: C.muted });
  c.text(545, y + 16, 'IMPORTE / AMOUNT', { size: 8.5, bold: true, color: C.muted, align: 'right' });
  y += 42;
  const lines = c.wrap(inv.concept || concept(b), 10.5, false, 360);
  lines.forEach((l, i) => c.text(50, y + i * 14, l, { size: 10.5 }));
  c.text(545, y, money(inv.base), { size: 10.5, align: 'right' });
  y += lines.length * 14 + 10;
  c.line(40, y, 555, y);

  y += 22;
  const tot = [['Base imponible / Tax base', money(inv.base)], [`IVA / VAT ${String(inv.vatRate).replace('.', ',')} %`, money(inv.vat)]];
  for (const [k, v] of tot) {
    c.text(400, y, k, { size: 10, color: C.muted, align: 'right' });
    c.text(545, y, v, { size: 10.5, align: 'right' });
    y += 17;
  }
  c.rect(300, y - 4, 255, 28, C.ink);
  c.text(400, y + 14, 'TOTAL', { size: 11, bold: true, color: C.gold, align: 'right' });
  c.text(545, y + 14, money(inv.total), { size: 13, bold: true, color: C.white, align: 'right' });
  y += 46;
  if (credit) {
    c.text(40, y, 'Credit note: cancels invoice ' + inv.rectifies + '.', { size: 9.5, color: C.muted }); y += 14;
    if (inv.reason) c.wrap('Motivo / Reason: ' + inv.reason, 9.5, false, 515).forEach((l) => { c.text(40, y, l, { size: 9.5, color: C.muted }); y += 13; });
  } else if (b.payment) c.text(40, y, 'Pago / Payment: ' + b.payment, { size: 9.5, color: C.muted });

  footer(c, [iss.footer, (iss.name || 'Bravo Transfers') + (iss.email ? ' · ' + iss.email : '') + (iss.phone ? ' · ' + iss.phone : '')]);
  return assemble(c.ops, 'Factura ' + inv.number);
}

// ---------- JUSTIFICANTE (para el cliente, en su idioma) ----------
const J = {
  es: { title: 'JUSTIFICANTE DE RESERVA', ref: 'Reserva', when: 'Día y hora', from: 'Desde', to: 'Hasta', pickup: 'Recogida', hours: 'Horas', ret: 'Vuelta', pax: 'Pasajeros', veh: 'Vehículo', flight: 'Vuelo', bags: 'Maletas', seats: 'Sillas de niño', driver: 'Conductor', car: 'Coche', total: 'PRECIO TOTAL (IVA incluido)', quote: 'Presupuesto pendiente', note: 'Este documento confirma la reserva. No es una factura.', name: 'Cliente' },
  en: { title: 'BOOKING CONFIRMATION', ref: 'Booking', when: 'Date and time', from: 'From', to: 'To', pickup: 'Pick-up', hours: 'Hours', ret: 'Return', pax: 'Passengers', veh: 'Vehicle', flight: 'Flight', bags: 'Suitcases', seats: 'Child seats', driver: 'Driver', car: 'Car', total: 'TOTAL PRICE (VAT included)', quote: 'Quote pending', note: 'This document confirms your booking. It is not an invoice.', name: 'Customer' }
};
function confirmationPdf(b, issuer) {
  const t = J[b.lang === 'en' ? 'en' : 'es'];
  const c = canvas();
  header(c, t.title, b.ref);
  let y = 130;
  y = rows(c, 40, y, [
    [t.name, b.name],
    [t.when, day(b.date) + ' · ' + b.time],
    [b.kind === 'hourly' ? t.pickup : t.from, placeFrom(b)],
    [b.kind === 'hourly' ? t.hours : t.to, b.kind === 'hourly' ? String(b.hours) : placeTo(b)],
    [t.ret, b.roundTrip ? day(b.returnDate) + ' · ' + b.returnTime : ''],
    [t.pax, String(b.passengers)],
    [t.veh, vehicleName(b.vehicle, b.lang)],
    [t.flight, b.flight],
    [t.bags, b.kind === 'group' ? '' : String(b.bags || 0)],
    [t.seats, b.childSeats ? String(b.childSeats) : ''],
    [t.driver, (b.chauffeur || b.driverName) ? (b.chauffeur || b.driverName) + ((b.chauffeur ? b.chauffeurPhone || b.driverPhone : b.driverPhone) ? ' · ' + (b.chauffeur ? b.chauffeurPhone || b.driverPhone : b.driverPhone) : '') : ''],
    [t.car, b.driverCar || '']
  ], 140, 515);
  y += 14;
  c.rect(40, y, 515, 40, C.ink);
  c.text(56, y + 25, t.total, { size: 10, bold: true, color: C.gold });
  c.text(540, y + 26, b.price != null ? money(b.price) : t.quote, { size: 15, bold: true, color: C.white, align: 'right' });
  y += 64;
  c.text(40, y, t.note, { size: 9.5, color: C.muted });
  footer(c, [(issuer.name || 'Bravo Transfers') + (issuer.email ? ' · ' + issuer.email : '') + (issuer.phone ? ' · ' + issuer.phone : '')]);
  return assemble(c.ops, t.title + ' ' + b.ref);
}

// ---------- JUSTIFICANTE DE PAGO (para el conductor o el proveedor al que se paga) ----------
// p = { id, kind: 'driver'|'supplier', payee: { name, taxId, email }, paid: { date, via }, lines: [{ concept, base, vatRate, vat, total }], total, theirInvoice }
const VIA = { banco: 'Transferencia bancaria', tarjeta: 'Tarjeta', efectivo: 'Efectivo', bizum: 'Bizum' };
function paymentPdf(p, issuer) {
  const c = canvas();
  header(c, 'JUSTIFICANTE DE PAGO', p.id);
  c.text(40, 122, 'PAGADOR', { size: 8, bold: true, color: C.muted });
  c.text(40, 138, issuer.name || 'Bravo Transfers', { size: 12, bold: true });
  let y = 154;
  for (const l of [issuer.taxId ? 'NIF/CIF: ' + issuer.taxId : ''].concat(c.wrap(issuer.address || '', 10, false, 230), [issuer.email, issuer.phone])) {
    if (!l) continue;
    c.text(40, y, l, { size: 10 }); y += 13;
  }
  const meta = [['Fecha del pago', day(p.paid.date)], ['Forma de pago', VIA[p.paid.via] || p.paid.via || '']];
  if (p.theirInvoice) meta.push(['Su factura nº', p.theirInvoice]);
  let my = 122;
  for (const [k, v] of meta) {
    c.text(330, my, k, { size: 8, bold: true, color: C.muted });
    c.text(555, my, v, { size: 10, bold: true, align: 'right' });
    my += 17;
  }
  y = Math.max(y, my) + 14;
  c.text(40, y, p.kind === 'driver' ? 'EMPRESA DE TRANSPORTE (COBRA)' : 'PROVEEDOR (COBRA)', { size: 8, bold: true, color: C.muted }); y += 16;
  c.text(40, y, p.payee.name || '', { size: 12, bold: true }); y += 15;
  for (const l of [p.payee.taxId ? 'NIF/CIF: ' + p.payee.taxId : '', p.payee.email]) {
    if (!l) continue;
    c.text(40, y, l, { size: 10 }); y += 13;
  }
  y += 18;
  c.rect(40, y, 515, 24, C.band);
  c.text(50, y + 16, 'CONCEPTO', { size: 8.5, bold: true, color: C.muted });
  c.text(420, y + 16, 'BASE', { size: 8.5, bold: true, color: C.muted, align: 'right' });
  c.text(480, y + 16, 'IVA', { size: 8.5, bold: true, color: C.muted, align: 'right' });
  c.text(545, y + 16, 'TOTAL', { size: 8.5, bold: true, color: C.muted, align: 'right' });
  y += 42;
  let base = 0, vat = 0;
  for (const l of p.lines) {
    const w = c.wrap(l.concept, 10, false, 300);
    w.forEach((t, i) => c.text(50, y + i * 13, t, { size: 10 }));
    c.text(420, y, money(l.base), { size: 10, align: 'right' });
    c.text(480, y, String(l.vatRate).replace('.', ',') + ' %', { size: 10, align: 'right' });
    c.text(545, y, money(l.total), { size: 10, align: 'right' });
    base += l.base; vat += l.vat;
    y += w.length * 13 + 10;
  }
  c.line(40, y, 555, y);
  y += 22;
  for (const [k, v] of [['Base', money(base)], ['IVA', money(vat)]]) {
    c.text(400, y, k, { size: 10, color: C.muted, align: 'right' });
    c.text(545, y, v, { size: 10.5, align: 'right' });
    y += 17;
  }
  c.rect(300, y - 4, 255, 28, C.ink);
  c.text(400, y + 14, 'PAGADO', { size: 11, bold: true, color: C.gold, align: 'right' });
  c.text(545, y + 14, money(p.total), { size: 13, bold: true, color: C.white, align: 'right' });
  y += 50;
  for (const l of c.wrap('Este documento justifica el pago. No es una factura' + (p.theirInvoice ? ': la factura es la nº ' + p.theirInvoice + ', emitida por quien cobra.' : '.'), 9.5, false, 515)) {
    c.text(40, y, l, { size: 9.5, color: C.muted }); y += 13;
  }
  footer(c, [(issuer.name || 'Bravo Transfers') + (issuer.email ? ' · ' + issuer.email : '') + (issuer.phone ? ' · ' + issuer.phone : '')]);
  return assemble(c.ops, 'Justificante de pago ' + p.id);
}

// ---------- PRESUPUESTO (grupos y reservas sin precio), en el idioma del cliente ----------
function quotePdf(b, issuer) {
  const en = b.lang === 'en', q = b.quote;
  const c = canvas();
  header(c, en ? 'QUOTE' : 'PRESUPUESTO', q.number);
  c.text(40, 122, en ? 'FROM' : 'EMISOR', { size: 8, bold: true, color: C.muted });
  c.text(40, 138, issuer.name || 'Bravo Transfers', { size: 12, bold: true });
  let y = 154;
  for (const l of [issuer.taxId ? 'NIF/CIF: ' + issuer.taxId : ''].concat(c.wrap(issuer.address || '', 10, false, 230), [issuer.email, issuer.phone])) {
    if (!l) continue;
    c.text(40, y, l, { size: 10 }); y += 13;
  }
  let my = 122;
  for (const [k, v] of [[en ? 'Date' : 'Fecha', day(q.date)], [en ? 'Valid until' : 'Válido hasta', day(q.validUntil)], [en ? 'Booking' : 'Reserva', b.ref]]) {
    c.text(330, my, k, { size: 8, bold: true, color: C.muted });
    c.text(555, my, v, { size: 10, bold: true, align: 'right' });
    my += 17;
  }
  y = Math.max(y, my) + 14;
  c.text(40, y, en ? 'FOR' : 'PARA', { size: 8, bold: true, color: C.muted }); y += 16;
  c.text(40, y, b.name || '', { size: 12, bold: true }); y += 15;
  for (const l of [b.email, b.phone]) { if (l) { c.text(40, y, l, { size: 10 }); y += 13; } }
  y += 16;
  y = rows(c, 40, y, [
    [en ? 'Date and time' : 'Día y hora', day(b.date) + ' · ' + b.time],
    [en ? 'From' : 'Desde', placeFrom(b)],
    [b.kind === 'hourly' ? (en ? 'Hours' : 'Horas') : (en ? 'To' : 'Hasta'), b.kind === 'hourly' ? String(b.hours) : placeTo(b)],
    [en ? 'Return' : 'Vuelta', b.roundTrip ? day(b.returnDate) + ' · ' + b.returnTime : ''],
    [en ? 'Passengers' : 'Personas', String(b.passengers)]
  ], 140, 515);
  if (q.notes) {
    y += 6;
    c.text(40, y, en ? 'DETAILS' : 'DETALLES', { size: 8, bold: true, color: C.muted }); y += 15;
    for (const l of c.wrap(q.notes, 10, false, 515)) { c.text(40, y, l, { size: 10 }); y += 13; }
  }
  y += 18;
  c.rect(40, y, 515, 40, C.ink);
  c.text(56, y + 25, en ? 'TOTAL (VAT included)' : 'TOTAL (IVA incluido)', { size: 10, bold: true, color: C.gold });
  c.text(540, y + 26, money(q.price), { size: 15, bold: true, color: C.white, align: 'right' });
  y += 62;
  for (const l of c.wrap(en ? 'To accept it, sign in to your account (My account) or reply to our email. This quote is valid until ' + day(q.validUntil) + '.'
    : 'Para aceptarlo, entra en tu cuenta (Mi cuenta) o contesta a nuestro correo. Este presupuesto vale hasta el ' + day(q.validUntil) + '.', 9.5, false, 515)) {
    c.text(40, y, l, { size: 9.5, color: C.muted }); y += 13;
  }
  footer(c, [(issuer.name || 'Bravo Transfers') + (issuer.email ? ' · ' + issuer.email : '') + (issuer.phone ? ' · ' + issuer.phone : '')]);
  return assemble(c.ops, (en ? 'Quote ' : 'Presupuesto ') + q.number);
}

// ---------- LIQUIDACIÓN DEL MES de un hotel o agencia ----------
function partnerPdf(p, month, list, issuer) {
  const pages = [];
  let c = null, y = 0;
  const [yy, mm] = month.split('-');
  function newPage() {
    c = canvas(); pages.push(c.ops);
    header(c, 'LIQUIDACIÓN', mm + '/' + yy);
    c.text(40, 122, (p.type === 'agencia' ? 'AGENCIA' : p.type === 'hotel' ? 'HOTEL' : 'COLABORADOR'), { size: 8, bold: true, color: C.muted });
    c.text(40, 138, p.name, { size: 12, bold: true });
    c.text(555, 138, 'Comisión ' + String(p.commission || 0).replace('.', ',') + ' %', { size: 10, bold: true, align: 'right' });
    y = 166;
    c.rect(40, y, 515, 22, C.band);
    for (const [x, t, al] of [[48, 'DÍA', 'left'], [100, 'RESERVA · CLIENTE · RUTA', 'left'], [470, 'PRECIO', 'right'], [547, 'COMISIÓN', 'right']]) c.text(x, y + 15, t, { size: 8, bold: true, color: C.muted, align: al });
    y += 38;
  }
  newPage();
  let tp = 0, tc = 0;
  for (const r of list) {
    const lines = c.wrap(r.ref + ' · ' + r.name + ' · ' + r.route + (r.invoice ? ' · ' + r.invoice : ''), 9.5, false, 330);
    if (y + lines.length * 12 > 740) newPage();
    c.text(48, y, day(r.date).slice(0, 5), { size: 9.5 });
    lines.forEach((l, i) => c.text(100, y + i * 12, l, { size: 9.5 }));
    c.text(470, y, money(r.price), { size: 9.5, align: 'right' });
    c.text(547, y, money(r.commission), { size: 9.5, align: 'right' });
    y += lines.length * 12 + 8;
    tp += r.price; tc += r.commission;
  }
  if (!list.length) { c.text(48, y, 'No hay viajes en este mes.', { size: 10, color: C.muted }); y += 20; }
  if (y > 700) newPage();
  c.line(40, y, 555, y); y += 22;
  c.text(400, y, 'Viajes: ' + list.length + ' · Total', { size: 10, color: C.muted, align: 'right' }); c.text(547, y, money(tp), { size: 10.5, align: 'right' }); y += 18;
  c.rect(300, y - 4, 255, 28, C.ink);
  c.text(400, y + 14, 'COMISIÓN', { size: 11, bold: true, color: C.gold, align: 'right' });
  c.text(547, y + 14, money(Math.round(tc * 100) / 100), { size: 13, bold: true, color: C.white, align: 'right' });
  y += 46;
  c.text(40, y, 'Resumen para revisar juntos. No es una factura.', { size: 9.5, color: C.muted });
  footer(c, [(issuer.name || 'Bravo Transfers') + (issuer.email ? ' · ' + issuer.email : '') + (issuer.phone ? ' · ' + issuer.phone : '')]);
  return assemble(pages, 'Liquidación ' + p.name + ' ' + month);
}

// ---------- HOJA DE SERVICIO (para el conductor) ----------
function driverSheetPdf(b, issuer) {
  const c = canvas();
  header(c, 'HOJA DE SERVICIO', b.ref);
  let y = 130;
  y = rows(c, 40, y, [
    ['Empresa', b.driverName],
    ['Conductor', b.chauffeur ? b.chauffeur + (b.chauffeurPhone ? ' · ' + b.chauffeurPhone : '') : ''],
    ['Coche', b.driverCar],
    ['Día y hora', day(b.date) + ' · ' + b.time],
    [b.kind === 'hourly' ? 'Recogida' : 'Recogida', placeFrom(b)],
    [b.kind === 'hourly' ? 'Horas' : 'Destino', b.kind === 'hourly' ? String(b.hours) : placeTo(b)],
    ['Distancia', b.km ? b.km + ' km · ~' + b.minutes + ' min' : ''],
    ['Vuelta', b.roundTrip ? day(b.returnDate) + ' · ' + b.returnTime : ''],
    ['Pasajeros', String(b.passengers)],
    ['Vehículo', vehicleName(b.vehicle, 'es')],
    ['Vuelo', b.flight],
    ['Maletas', b.kind === 'group' ? '' : String(b.bags || 0)],
    ['Sillas de niño', b.childSeats ? String(b.childSeats) : ''],
    ['Cliente', b.name + ' · ' + b.phone],
    ['Comentarios', b.comments],
    ['Nota', b.driverNote]
  ], 120, 515);
  y += 14;
  if (b.driverPay != null) {
    c.rect(40, y, 515, 36, C.band);
    c.text(56, y + 23, 'SE TE PAGA POR ESTE SERVICIO', { size: 10, bold: true, color: C.muted });
    c.text(540, y + 24, money(b.driverPay), { size: 14, bold: true, align: 'right' });
    y += 56;
  }
  c.text(40, y, 'Recuerda comunicar el servicio al Registro del Ministerio de Transportes antes de empezar.', { size: 9.5, bold: true, color: C.orange });
  footer(c, [(issuer.name || 'Bravo Transfers') + (issuer.phone ? ' · ' + issuer.phone : '') + (issuer.email ? ' · ' + issuer.email : '')]);
  return assemble(c.ops, 'Hoja de servicio ' + b.ref);
}

// ---------- INFORME CONTABLE DEL PERIODO (varias páginas) ----------
function accountsPdf(rep, issuer) {
  const pages = [];
  let c = null, y = 0;
  const TOP = 70, BOTTOM = 800;
  const title = 'Informe contable · ' + day(rep.from) + ' – ' + day(rep.to);
  function newPage() {
    c = canvas(); pages.push(c.ops);
    if (!c.image(40, 10, 46)) c.halfSun(62, 40, 14, C.gold);
    c.text(94, 34, 'BRAVO TRANSFERS', { size: 12, bold: true });
    c.text(555, 34, title, { size: 9.5, color: C.orange, align: 'right' });
    c.line(40, 52, 555, 52, C.gold, 1.2);
    y = TOP;
  }
  function need(h) { if (y + h > BOTTOM) newPage(); }
  function fit(t, w, size, bold) {
    t = String(t == null ? '' : t);
    if (textWidth(t, size, bold) <= w) return t;
    while (t.length > 1 && textWidth(t + '…', size, bold) > w) t = t.slice(0, -1);
    return t + '…';
  }
  function h1(t) { need(40); y += 10; c.text(40, y, t, { size: 13, bold: true }); y += 8; c.line(40, y, 555, y, C.gold, 1.2); y += 16; }
  function para(t, o) { for (const l of c.wrap(t, 8.5, false, 515)) { need(12); c.text(40, y, l, Object.assign({ size: 8.5, color: C.muted }, o || {})); y += 11; } }
  // Tabla: cols = [{t: título, w: ancho, r: derecha}], filas de textos; se parte entre páginas repitiendo la cabecera
  function table(cols, rows, o) {
    o = o || {};
    const size = 8;
    const headRow = () => {
      need(34);
      c.rect(40, y, 515, 16, C.band);
      let x = 40;
      for (const col of cols) { c.text(col.r ? x + col.w - 4 : x + 4, y + 11, col.t, { size: 7, bold: true, color: C.muted, align: col.r ? 'right' : undefined }); x += col.w; }
      y += 16;
    };
    headRow();
    rows.forEach((row) => {
      if (y + 13 > BOTTOM) { newPage(); headRow(); }
      let x = 40;
      const isObj = !Array.isArray(row);
      const bold = isObj && row.bold;
      if (isObj && row.fill) c.rect(40, y, 515, 13, row.fill);
      cols.forEach((col, k) => {
        const v = isObj ? row.cells[k] : row[k];
        c.text(col.r ? x + col.w - 4 : x + 4, y + 9.5, fit(v, col.w - 8, size, bold), { size, bold, align: col.r ? 'right' : undefined, color: (isObj && row.color) || C.ink });
        x += col.w;
      });
      y += 13;
      c.line(40, y, 555, y, C.line, 0.4);
    });
    y += 10;
  }
  const m = money;
  const t = rep.totals;
  newPage();
  c.text(40, y + 4, issuer.name || 'Bravo Transfers', { size: 16, bold: true }); y += 20;
  c.text(40, y, 'Periodo: ' + day(rep.from) + ' a ' + day(rep.to) + (issuer.taxId ? ' · NIF/CIF: ' + issuer.taxId : ''), { size: 9.5, color: C.muted }); y += 12;
  c.text(40, y, 'Generado el ' + day(rep.generated) + ' con el panel de Bravo Transfers', { size: 9.5, color: C.muted }); y += 10;

  h1('1. Resumen');
  table([{ t: '', w: 235 }, { t: 'BASE', w: 95, r: 1 }, { t: 'IVA', w: 90, r: 1 }, { t: 'TOTAL', w: 95, r: 1 }], [
    ['Ingresos', m(t.ingresosBase), m(t.ivaRepercutido), m(t.ingresos)],
    ['Gastos', m(t.gastosBase), m(t.ivaSoportado), m(t.gastos)],
    { cells: ['Beneficio antes de impuestos (ingresos − gastos, sin IVA)', m(t.beneficio), '', ''], bold: true },
    { cells: [t.ivaResultado >= 0 ? 'IVA a pagar (repercutido − soportado)' : 'IVA a devolver (repercutido − soportado)', '', m(Math.abs(t.ivaResultado)), ''], bold: true }
  ].concat(t.nominas ? [
    ['Nóminas: coste para la empresa (ya incluido en gastos)', m(t.nominas), '', ''],
    ['Retenciones de IRPF practicadas (modelo 111)', m(t.irpfRetenido), '', ''],
    ['Seguridad Social (trabajador + empresa)', m(t.seguridadSocial), '', '']
  ] : []));
  if (rep.unbilled && rep.unbilled.n) para('Aviso: ' + rep.unbilled.n + ' viaje(s) del periodo con precio y sin factura (' + m(rep.unbilled.total) + '): no cuentan como ingreso.', { color: C.orange });

  h1('2. IVA por tipo (para la declaración trimestral)');
  const vr = (list) => list.length ? list.map((x) => [String(x.rate).replace('.', ',') + ' %', m(x.base), m(x.vat)]) : [['—', '', '']];
  c.text(40, y, 'IVA devengado (repercutido en facturas emitidas e ingresos)', { size: 9, bold: true }); y += 6;
  table([{ t: 'TIPO', w: 175 }, { t: 'BASE IMPONIBLE', w: 170, r: 1 }, { t: 'CUOTA', w: 170, r: 1 }], vr(rep.vatByRate.repercutido).concat([{ cells: ['Total devengado', m(t.ingresosBase), m(t.ivaRepercutido)], bold: true }]));
  c.text(40, y, 'IVA deducible (soportado en gastos y pagos a empresas de transporte)', { size: 9, bold: true }); y += 6;
  table([{ t: 'TIPO', w: 175 }, { t: 'BASE IMPONIBLE', w: 170, r: 1 }, { t: 'CUOTA', w: 170, r: 1 }], vr(rep.vatByRate.soportado).concat([{ cells: ['Total deducible', m(t.gastosBase), m(t.ivaSoportado)], bold: true }]));
  table([{ t: 'RESULTADO', w: 345 }, { t: 'IMPORTE', w: 170, r: 1 }], [{ cells: [t.ivaResultado >= 0 ? 'A ingresar' : 'A compensar o devolver', m(Math.abs(t.ivaResultado))], bold: true }]);

  h1('3. Gastos por cuenta');
  table([{ t: 'CUENTA', w: 235 }, { t: 'APUNTES', w: 50, r: 1 }, { t: 'BASE', w: 75, r: 1 }, { t: 'IVA', w: 70, r: 1 }, { t: 'TOTAL', w: 85, r: 1 }],
    rep.expenseAccounts.length ? rep.expenseAccounts.map((x) => [x.account + ' ' + x.name, String(x.n), m(x.base), m(x.vat), m(x.total)]) : [['Sin gastos en el periodo', '', '', '', '']]);

  if ((rep.nominas || []).length) {
    h1('3.1 Nóminas');
    const nr = rep.nominas.map((x) => [day(x.date), x.party, m(x.payroll.gross), m(x.payroll.irpf), m(x.payroll.ssEmp), m(x.payroll.ssCo), m(x.payroll.net), m(x.total)]);
    const sum = (k) => m(rep.nominas.reduce((a, x) => a + x.payroll[k], 0));
    nr.push({ cells: ['', 'Total', sum('gross'), sum('irpf'), sum('ssEmp'), sum('ssCo'), sum('net'), m(rep.nominas.reduce((a, x) => a + x.total, 0))], bold: true });
    table([{ t: 'FECHA', w: 52 }, { t: 'TRABAJADOR', w: 113 }, { t: 'BRUTO', w: 60, r: 1 }, { t: 'IRPF', w: 52, r: 1 }, { t: 'SS TRAB.', w: 55, r: 1 }, { t: 'SS EMPRESA', w: 58, r: 1 }, { t: 'NETO', w: 60, r: 1 }, { t: 'COSTE', w: 65, r: 1 }], nr);
  }

  const regCols = [{ t: 'FECHA', w: 52 }, { t: 'Nº FACTURA', w: 68 }, { t: '', w: 128 }, { t: 'NIF', w: 62 }, { t: 'BASE', w: 58, r: 1 }, { t: 'TIPO', w: 36, r: 1 }, { t: 'CUOTA', w: 52, r: 1 }, { t: 'TOTAL', w: 59, r: 1 }];
  const regRows = (list) => list.map((x) => ({ cells: [day(x.date), x.number || '—', x.party, x.taxId || '', m(x.base), String(x.vatRate).replace('.', ',') + '%', m(x.vat), m(x.total)], color: x.total < 0 ? C.red : undefined }));
  const sumRow = (list) => ({ cells: ['', '', 'Total', '', m(list.reduce((a, x) => a + x.base, 0)), '', m(list.reduce((a, x) => a + x.vat, 0)), m(list.reduce((a, x) => a + x.total, 0))], bold: true });
  h1('4. Libro registro de facturas emitidas');
  regCols[2].t = 'CLIENTE';
  table(regCols, rep.emitidas.length ? regRows(rep.emitidas).concat([sumRow(rep.emitidas)]) : [['', '', 'Sin facturas en el periodo', '', '', '', '', '']]);
  h1('5. Libro registro de facturas recibidas (gastos)');
  regCols[2].t = 'PROVEEDOR / CONCEPTO';
  table(regCols, rep.recibidas.length ? regRows(rep.recibidas).concat([sumRow(rep.recibidas)]) : [['', '', 'Sin gastos en el periodo', '', '', '', '', '']]);

  h1('6. Libro diario (cuentas del Plan General Contable)');
  const diaryRows = [];
  let tD = 0, tH = 0;
  for (const a of rep.diario) {
    diaryRows.push({ cells: ['Asiento ' + a.n + ' · ' + day(a.date) + ' · ' + a.concept, '', ''], bold: true, fill: C.band });
    for (const l of a.lines) {
      diaryRows.push(['   ' + l.account + ' ' + l.name, l.debe ? m(l.debe) : '', l.haber ? m(l.haber) : '']);
      tD += l.debe || 0; tH += l.haber || 0;
    }
  }
  diaryRows.push({ cells: ['Sumas del periodo', m(tD), m(tH)], bold: true });
  table([{ t: 'CUENTA', w: 335 }, { t: 'DEBE', w: 90, r: 1 }, { t: 'HABER', w: 90, r: 1 }], rep.diario.length ? diaryRows : [['Sin asientos en el periodo', '', '']]);

  h1('7. Banco: movimientos y conciliación');
  const bl = rep.bankLines || [];
  table([{ t: 'FECHA', w: 55 }, { t: 'CONCEPTO DEL BANCO', w: 205 }, { t: 'IMPORTE', w: 70, r: 1 }, { t: 'CONCILIADO CON', w: 185 }],
    bl.length ? bl.map((l) => ({ cells: [day(l.date), l.concept, m(l.amount), l.status], color: l.status === 'pendiente' ? C.orange : undefined }))
      : [['', 'Sin extractos del banco en el periodo', '', '']]);
  if (bl.length) para(bl.filter((l) => l.status === 'pendiente').length + ' de ' + bl.length + ' movimientos sin conciliar.');

  h1('8. Pendiente de cobro y de pago (a ' + day(rep.to) + ')');
  const pr = (list) => list.map((x) => [day(x.date), x.label, m(Math.abs(x.amount))]);
  c.text(40, y, 'Por cobrar (cuenta 430)', { size: 9, bold: true }); y += 6;
  table([{ t: 'FECHA', w: 60 }, { t: 'FACTURA O INGRESO', w: 365 }, { t: 'IMPORTE', w: 90, r: 1 }], (rep.pendingIn || []).length ? pr(rep.pendingIn) : [['', 'Nada pendiente de cobro', '']]);
  c.text(40, y, 'Por pagar (cuenta 410)', { size: 9, bold: true }); y += 6;
  table([{ t: 'FECHA', w: 60 }, { t: 'GASTO O PAGO A CONDUCTOR', w: 365 }, { t: 'IMPORTE', w: 90, r: 1 }], (rep.pendingOut || []).length ? pr(rep.pendingOut) : [['', 'Nada pendiente de pago', '']]);
  const pt = rep.pendingTaxes || { irpf: 0, ss: 0 };
  if (pt.irpf || pt.ss) {
    c.text(40, y, 'Con Hacienda y la Seguridad Social (de las nóminas)', { size: 9, bold: true }); y += 6;
    table([{ t: 'CONCEPTO', w: 425 }, { t: 'IMPORTE', w: 90, r: 1 }], [
      ['Retenciones de IRPF por ingresar a Hacienda (cuenta 4751)', m(pt.irpf)],
      ['Cuotas por pagar a la Seguridad Social (cuenta 476)', m(pt.ss)]
    ]);
  }

  h1('Notas');
  para('· Los precios de los viajes llevan el IVA incluido; la base y la cuota se calculan con el tipo de cada factura o gasto.');
  para('· Las facturas no se borran: se corrigen con una factura rectificativa (serie R), que aparece en negativo.');
  para('· Los cobros y pagos salen de la conciliación con el banco (572) o de lo marcado como pagado en efectivo (570). Lo que mete o saca el socio va a la 551.');
  para('· Las nóminas van al 640 (bruto) y 642 (Seguridad Social de la empresa); la retención al 4751, las cuotas al 476 y el neto al 465 hasta que se paga.');
  para('· Los pagos a Hacienda (IVA, retenciones, sociedades) y a la Seguridad Social salen del banco. El libro diario no incluye todavía la liquidación trimestral del IVA (477 y 472 contra 4750) ni las amortizaciones.');
  para('· Informe generado por el panel. Antes de presentar impuestos, conviene que lo revise un profesional.');

  pages.forEach((ops, k) => {
    ops.push(`BT /F1 7.5 Tf ${C.muted.map((v) => v.toFixed(3)).join(' ')} rg ${(PAGE_W / 2 - 20).toFixed(2)} 22 Td ${pdfString('Página ' + (k + 1) + ' de ' + pages.length)} Tj ET`);
  });
  return assemble(pages, title);
}

module.exports = { invoicePdf, confirmationPdf, driverSheetPdf, paymentPdf, quotePdf, partnerPdf, accountsPdf, concept, _test: { W, WB, winAnsi, textWidth } };
