// Bravo Transfers — PDFs sin dependencias: factura, justificante de reserva y hoja de servicio.
// Usa las fuentes que trae todo lector de PDF (Helvetica) con la codificación WinAnsi, que
// cubre las letras del español y el símbolo del euro.
'use strict';

// Anchos de Helvetica y Helvetica-Bold (caracteres 32 a 126), en milésimas del tamaño.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const SPECIAL = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '→': 0xBB };

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

function assemble(ops, title) {
  const content = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfString(title)} /Producer (Bravo Transfers) >>`
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- piezas comunes ----------
function header(c, title, subtitle) {
  c.rect(0, 0, PAGE_W, 92, C.ink);
  c.halfSun(66, 58, 24, C.gold);
  c.line(36, 64, 96, 64, C.gold, 2);
  c.text(108, 46, 'BRAVO', { size: 24, bold: true, color: C.white });
  c.text(109, 62, 'T R A N S F E R S', { size: 8, color: C.gold });
  c.text(555, 46, title, { size: 15, bold: true, color: C.white, align: 'right' });
  if (subtitle) c.text(555, 64, subtitle, { size: 10, color: C.gold, align: 'right' });
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
function invoicePdf(b) {
  const inv = b.invoice, iss = inv.issuer || {}, cus = inv.customer || {};
  const c = canvas();
  header(c, 'FACTURA / INVOICE', inv.number);
  if (inv.status === 'anulada') c.text(555, 112, 'ANULADA / VOID', { size: 16, bold: true, color: C.red, align: 'right' });

  c.text(40, 122, 'EMISOR / FROM', { size: 8, bold: true, color: C.muted });
  c.text(40, 138, iss.name || 'Bravo Transfers', { size: 12, bold: true });
  let y = 154;
  for (const l of [iss.taxId ? 'NIF/CIF / Tax ID: ' + iss.taxId : 'NIF/CIF / Tax ID: (pendiente / pending)'].concat(c.wrap(iss.address || '', 10, false, 230), [iss.email, iss.phone])) {
    if (!l) continue;
    c.text(40, y, l, { size: 10 }); y += 13;
  }
  const meta = [['Nº factura / Invoice no.', inv.number], ['Fecha / Date', day(inv.date)], ['Reserva / Booking', b.ref], ['Servicio / Service', day(b.date) + ' ' + b.time]];
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
  if (b.payment) c.text(40, y, 'Pago / Payment: ' + b.payment, { size: 9.5, color: C.muted });

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
    [t.driver, b.driverName ? b.driverName + (b.driverPhone ? ' · ' + b.driverPhone : '') : ''],
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

// ---------- HOJA DE SERVICIO (para el conductor) ----------
function driverSheetPdf(b, issuer) {
  const c = canvas();
  header(c, 'HOJA DE SERVICIO', b.ref);
  let y = 130;
  y = rows(c, 40, y, [
    ['Conductor', b.driverName],
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

module.exports = { invoicePdf, confirmationPdf, driverSheetPdf, concept, _test: { W, WB, winAnsi, textWidth } };
