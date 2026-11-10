"use strict";
// Cross-section of a block: the crop and its root zone, the irrigation equipment and its wetted soil, and the
// HydraScout® probe with its sensors, drawn as a vertical cut. Depths come from the crop step (FAO-56 roots,
// suggested or chosen probe); widths from the irrigation spacings. Above ground is not to scale.

// Usual row spacing (m) per crop family, used when the irrigation does not give it.
const SECTION_ROWS = { field: 0.75, veg: 0.75, berry: 1.2, tree: 4.5, vine: 2.2 };
const SECTION_COLORS = { soil: "#c9ab86", soilDeep: "#a88762", roots: "#7cb342", active: "#33691e", now: "#1b5e20", wet: "#4fc3f7", pipe: "#0d3c8c", probe: "#263238", sensor: "#ff8f00", plant: "#558b2f", trunk: "#6d4c41" };

// x: { roots, probe, cropKey } from the crop step (or null), irr: readIrrigation() output.
function sectionData(x, irr) {
  const kind = irr && irr.type !== "none" ? irr.type : "none", fam = x && CROP_FAMILY[x.cropKey] ? CROP_FAMILY[x.cropKey] : "field";
  const assumed = [];
  let row;
  if (kind === "drip" && irr.lineSpacing) row = irr.lineSpacing / 100;
  else { row = SECTION_ROWS[fam]; if (kind === "drip") assumed.push(`drip lines ${fmt(row * 100, 0)} cm apart, one per row`); else assumed.push(`crop rows ${fmt(row, 2)} m apart`); }
  const emitter = kind === "drip" ? (irr.emitter || 30) / 100 : null;
  if (kind === "drip" && !irr.emitter) assumed.push("emitters every 30 cm");
  return { kind, fam, row, emitter, roots: x && x.roots, probe: x && x.probe, crop: x && x.roots ? x.roots.crop : null, assumed, irr };
}

// Plant drawn above ground at (cx, gy): h = height in px (symbolic).
function sectionPlant(fam, cx, gy, h, w) {
  const C = SECTION_COLORS;
  if (fam === "tree") return `<rect x="${cx - 4}" y="${gy - h * 0.45}" width="8" height="${h * 0.45}" fill="${C.trunk}"/><ellipse cx="${cx}" cy="${gy - h * 0.7}" rx="${Math.min(w * 0.42, h * 0.45)}" ry="${h * 0.32}" fill="${C.plant}" opacity=".9"/>`;
  if (fam === "vine") return `<path d="M${cx},${gy} L${cx},${gy - h * 0.55}" stroke="${C.trunk}" stroke-width="5"/><line x1="${cx - w * 0.3}" y1="${gy - h * 0.55}" x2="${cx + w * 0.3}" y2="${gy - h * 0.55}" stroke="#9e9e9e" stroke-width="1.5"/><ellipse cx="${cx}" cy="${gy - h * 0.72}" rx="${Math.min(w * 0.22, h * 0.25)}" ry="${h * 0.22}" fill="${C.plant}" opacity=".9"/>`;
  if (fam === "berry") return `<ellipse cx="${cx}" cy="${gy - h * 0.18}" rx="${Math.min(w * 0.3, 26)}" ry="${h * 0.18}" fill="${C.plant}"/>`;
  // Annual: a stem with leaves.
  const s = h * (fam === "veg" ? 0.45 : 0.9);
  return `<path d="M${cx},${gy} L${cx},${gy - s}" stroke="${C.plant}" stroke-width="3"/>` +
    [0.3, 0.5, 0.7].map((t, i) => { const d = i % 2 ? -1 : 1; return `<path d="M${cx},${gy - s * t} q${d * 8},-2 ${d * 16},-10" stroke="${C.plant}" stroke-width="3" fill="none"/>`; }).join("") +
    `<ellipse cx="${cx}" cy="${gy - s}" rx="5" ry="9" fill="${C.plant}"/>`;
}

// One panel. along = false: across the rows; true: along the drip line.
function sectionPanel(D, { along = false, W = 760, top = 0 } = {}) {
  const C = SECTION_COLORS, r = D.roots, p = D.probe;
  const maxCm = Math.max(60, r ? r.maxCm : 0, p ? p.lengthCm : 0) + 20, AIR = 150, SOIL = 300, L = 70, R = 110, gy = top + AIR;
  const span = along ? Math.max(6 * D.emitter, 1.2) : D.row * (D.row >= 1.5 ? 3 : D.row >= 0.6 ? 4 : 6);
  const pxm = (W - L - R) / span, X = (m) => L + m * pxm, Z = (cm) => gy + (cm / maxCm) * SOIL;
  const out = [], rows = [];
  // Soil and depth axis.
  out.push(`<defs><linearGradient id="soilG${along ? 1 : 0}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.soil}"/><stop offset="1" stop-color="${C.soilDeep}"/></linearGradient>
    <clipPath id="soilC${along ? 1 : 0}"><rect x="${L}" y="${gy}" width="${W - L - R}" height="${SOIL}"/></clipPath></defs>`);
  out.push(`<rect x="${L}" y="${top + 8}" width="${W - L - R}" height="${AIR - 8}" fill="#eef6fb"/><rect x="${L}" y="${gy}" width="${W - L - R}" height="${SOIL}" fill="url(#soilG${along ? 1 : 0})"/>`);
  for (let cm = 0; cm <= maxCm; cm += maxCm > 120 ? 20 : 10) out.push(`<line x1="${L - 5}" y1="${Z(cm)}" x2="${L}" y2="${Z(cm)}" stroke="#5c6b61"/><text x="${L - 8}" y="${Z(cm) + 4}" font-size="11" text-anchor="end" fill="#5c6b61">${cm}</text>`);
  out.push(`<text x="14" y="${gy + SOIL / 2}" font-size="11" fill="#5c6b61" transform="rotate(-90 14 ${gy + SOIL / 2})" text-anchor="middle">Depth (cm)</text>`);
  const g = [];
  // Plant positions: the rows across, or plants along the row.
  if (along) { const step = D.fam === "tree" ? span : D.fam === "vine" ? Math.max(1, span / 2) : Math.max(0.25, span / 6); for (let m = step / 2; m < span; m += step) rows.push(m); }
  else for (let m = D.row / 2; m < span; m += D.row) rows.push(m);
  const mid = rows[Math.floor((rows.length - 1) / 2)];
  // Wetted soil under the irrigation (schematic: depends on soil, flow and run time), drawn over the roots.
  const wet = [];
  if (D.kind === "drip") {
    const ems = along ? (() => { const a = []; for (let m = D.emitter / 2; m < span; m += D.emitter) a.push(m); return a; })() : rows;
    ems.forEach((m) => wet.push(`<ellipse cx="${X(m)}" cy="${gy}" rx="${0.35 * pxm}" ry="${Z(45) - gy}" fill="${C.wet}" fill-opacity="${along ? 0.2 : 0.35}" stroke="#0288d1" stroke-width="1.2" stroke-dasharray="5 3"/>`));
  } else if (D.kind === "furrow") {
    rows.slice(0, -1).forEach((m, i) => wet.push(`<ellipse cx="${X(m + D.row / 2)}" cy="${gy}" rx="${0.45 * D.row * pxm}" ry="${Z(50) - gy}" fill="${C.wet}" fill-opacity=".35" stroke="#0288d1" stroke-width="1.2" stroke-dasharray="5 3"/>`));
  } else if (D.kind === "micro") {
    const hs = (D.irr.spacing || 6) * pxm;
    for (let x = X(D.row); x < W - R; x += Math.max(hs, 60)) wet.push(`<ellipse cx="${x}" cy="${gy}" rx="${Math.min(1.5 * pxm, 70)}" ry="${Z(40) - gy}" fill="${C.wet}" fill-opacity=".35" stroke="#0288d1" stroke-width="1.2" stroke-dasharray="5 3"/>`);
  } else if (D.kind !== "none") wet.push(`<rect x="${L}" y="${gy}" width="${W - L - R}" height="${Z(35) - gy}" fill="${C.wet}" fill-opacity=".3"/><line x1="${L}" y1="${Z(35)}" x2="${W - R}" y2="${Z(35)}" stroke="#0288d1" stroke-width="1.2" stroke-dasharray="5 3"/>`);
  // Root zones.
  if (r) {
    const half = along ? span / 2 : Math.min(D.row * 0.48, D.fam === "tree" ? 2.2 : 1);
    if (along) {
      // Many plants along the row: their roots make one continuous band.
      const deep = Z(r.maxCm), act = Z(r.activeCm), x0 = L, x1 = W - R, k = 24;
      g.push(`<path d="M${x0},${gy} L${x0},${deep - k} Q${x0},${deep} ${x0 + k},${deep} L${x1 - k},${deep} Q${x1},${deep} ${x1},${deep - k} L${x1},${gy} Z" fill="${C.roots}" fill-opacity=".3" stroke="${C.roots}" stroke-dasharray="4 3"/>`);
      g.push(`<rect x="${x0}" y="${gy}" width="${x1 - x0}" height="${act - gy}" fill="${C.active}" fill-opacity=".28"/>`);
      rows.forEach((m) => { for (let q = -1; q <= 1; q++) g.push(`<path d="M${X(m)},${gy} q${q * 10},${(deep - gy) * 0.4} ${q * 16},${(deep - gy) * (0.85 - Math.abs(q) * 0.1)}" stroke="#8d6e63" stroke-width="1" fill="none" opacity=".5"/>`); });
    }
    (along ? [] : rows).forEach((m) => {
      const w = half * pxm, deep = Z(r.maxCm) - gy, act = Z(r.activeCm) - gy;
      g.push(`<path d="M${X(m) - w},${gy} C${X(m) - w},${gy + deep * 0.6} ${X(m) - w * 0.35},${gy + deep} ${X(m)},${gy + deep} C${X(m) + w * 0.35},${gy + deep} ${X(m) + w},${gy + deep * 0.6} ${X(m) + w},${gy} Z" fill="${C.roots}" fill-opacity=".3" stroke="${C.roots}" stroke-dasharray="4 3"/>`);
      g.push(`<path d="M${X(m) - w * 0.85},${gy} C${X(m) - w * 0.85},${gy + act * 0.7} ${X(m) - w * 0.3},${gy + act} ${X(m)},${gy + act} C${X(m) + w * 0.3},${gy + act} ${X(m) + w * 0.85},${gy + act * 0.7} ${X(m) + w * 0.85},${gy} Z" fill="${C.active}" fill-opacity=".28"/>`);
      // A few root strands, for the look.
      for (let k = -2; k <= 2; k++) g.push(`<path d="M${X(m)},${gy} q${k * w * 0.18},${deep * 0.4} ${k * w * 0.3},${deep * (0.85 - Math.abs(k) * 0.12)}" stroke="#8d6e63" stroke-width="1" fill="none" opacity=".55"/>`);
    });
    if (r.nowCm != null && r.nowCm < r.maxCm) g.push(`<line x1="${L}" y1="${Z(r.nowCm)}" x2="${W - R}" y2="${Z(r.nowCm)}" stroke="${C.now}" stroke-width="1.5" stroke-dasharray="7 4"/>`);
  }
  out.push(`<g clip-path="url(#soilC${along ? 1 : 0})">${g.join("")}${wet.join("")}</g>`);
  if (r && r.nowCm != null && r.nowCm < r.maxCm) out.push(`<text x="${W - R + 6}" y="${Z(r.nowCm) + 4}" font-size="11" fill="${C.now}">roots now</text>`);
  if (r) out.push(`<text x="${W - R + 6}" y="${Z(r.maxCm) + 4}" font-size="11" fill="#33691e">deepest roots</text>`);
  // Plants above ground.
  const ph = AIR - 40;
  rows.forEach((m) => out.push(sectionPlant(D.fam, X(m), gy, ph, (along ? span / rows.length : D.row) * pxm)));
  // Irrigation equipment.
  const pipe = (cx) => `<circle cx="${cx}" cy="${gy - 4}" r="5" fill="${C.pipe}" stroke="#fff" stroke-width="1.5"/>`;
  if (D.kind === "drip") {
    if (along) {
      out.push(`<line x1="${L}" y1="${gy - 4}" x2="${W - R}" y2="${gy - 4}" stroke="${C.pipe}" stroke-width="6" stroke-linecap="round"/>`);
      for (let m = D.emitter / 2; m < span; m += D.emitter) out.push(`<circle cx="${X(m)}" cy="${gy - 4}" r="3.5" fill="#fff" stroke="${C.pipe}" stroke-width="1.5"/><path d="M${X(m)},${gy + 1} l0,6" stroke="${C.wet}" stroke-width="2"/>`);
    } else rows.forEach((m) => out.push(pipe(X(m)) + `<path d="M${X(m)},${gy + 1} l0,6" stroke="${C.wet}" stroke-width="2"/>`));
  } else if (D.kind === "micro") {
    const hs = (D.irr.spacing || 6) * pxm; for (let x = X(D.row); x < W - R; x += Math.max(hs, 60)) out.push(`<line x1="${x}" y1="${gy}" x2="${x}" y2="${gy - 22}" stroke="${C.pipe}" stroke-width="2.5"/><path d="M${x - 40},${gy - 4} Q${x},${gy - 50} ${x + 40},${gy - 4}" stroke="${C.wet}" stroke-width="1.5" fill="none" stroke-dasharray="3 3"/><circle cx="${x}" cy="${gy - 24}" r="4" fill="${C.pipe}"/>`);
  } else if (D.kind === "sprinkler") {
    const x = X(span * 0.12); out.push(`<line x1="${x}" y1="${gy}" x2="${x}" y2="${top + 30}" stroke="${C.pipe}" stroke-width="3"/><circle cx="${x}" cy="${top + 28}" r="5" fill="${C.pipe}"/><path d="M${x},${top + 28} Q${(x + W - R) / 2},${top - 10} ${W - R},${gy - 30}" stroke="${C.wet}" stroke-width="2" fill="none" stroke-dasharray="5 4"/>`);
  } else if (D.kind === "pivot" || D.kind === "linear") {
    out.push(`<line x1="${L}" y1="${top + 22}" x2="${W - R}" y2="${top + 22}" stroke="${C.pipe}" stroke-width="5"/>`);
    for (let x = L + 30; x < W - R; x += 60) out.push(`<line x1="${x}" y1="${top + 22}" x2="${x}" y2="${top + 70}" stroke="${C.pipe}" stroke-width="1.5"/><path d="M${x - 12},${top + 92} L${x},${top + 72} L${x + 12},${top + 92}" stroke="${C.wet}" stroke-width="1.5" fill="none" stroke-dasharray="3 3"/>`);
  } else if (D.kind === "furrow") {
    rows.slice(0, -1).forEach((m) => { const x = X(m + D.row / 2), w = Math.min(0.3 * D.row * pxm, 30); out.push(`<path d="M${x - w},${gy} L${x},${gy + 12} L${x + w},${gy} Z" fill="${C.wet}" stroke="${C.pipe}" stroke-width="1"/>`); });
  }
  // Ground line on top.
  out.push(`<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="#6d4c41" stroke-width="2"/>`);
  // The probe, in the row, in the wetted zone, a little to the side of the plant (or the drip line).
  if (p) {
    const px = along ? X(span / 2 + (D.emitter || 0.3) * 0.5) : X(mid + Math.min(0.15, D.row * 0.2));
    out.push(`<rect x="${px - 5}" y="${gy - 14}" width="10" height="14" rx="2" fill="${C.probe}"/><rect x="${px - 3}" y="${gy}" width="6" height="${Z(p.lengthCm) - gy}" fill="${C.probe}"/>`);
    p.depthsCm.forEach((d) => out.push(`<rect x="${px - 5}" y="${Z(d) - 3}" width="10" height="6" rx="1.5" fill="${C.sensor}"/><text x="${px + 9}" y="${Z(d) + 4}" font-size="10.5" fill="#1d2a22" stroke="#fff" stroke-width="3" paint-order="stroke">${d}</text>`));
    out.push(`<text x="${px}" y="${gy - 20}" font-size="11.5" font-weight="700" text-anchor="middle" fill="#1d2a22" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeHtml(p.code)}</text>`);
  }
  // Width scale.
  const nice = [0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((m) => m * pxm > 60) || 5;
  out.push(`<g transform="translate(${L},${gy + SOIL + 18})"><rect width="${nice * pxm}" height="4" fill="#1d2a22"/><text x="${nice * pxm + 8}" y="6" font-size="11" fill="#1d2a22">${nice < 1 ? `${nice * 100} cm` : `${nice} m`} (width)</text></g>`);
  if (!along && D.kind === "drip") out.push(`<g stroke="#5c6b61" fill="none"><path d="M${X(rows[0])},${top + 14} l0,6 M${X(rows[1] || rows[0])},${top + 14} l0,6 M${X(rows[0])},${top + 17} L${X(rows[1] || rows[0])},${top + 17}"/></g><text x="${(X(rows[0]) + X(rows[1] || rows[0])) / 2}" y="${top + 12}" font-size="11" text-anchor="middle" fill="#1d2a22">${fmt(D.row * 100, 0)} cm</text>`);
  if (along) out.push(`<g stroke="#5c6b61" fill="none"><path d="M${X(D.emitter / 2)},${gy + 14} L${X(D.emitter * 1.5)},${gy + 14}"/></g><text x="${X(D.emitter)}" y="${gy + 28}" font-size="11" text-anchor="middle" fill="#1d2a22" stroke="#fff" stroke-width="3" paint-order="stroke">${fmt(D.emitter * 100, 0)} cm</text>`);
  return { svg: out.join(""), h: AIR + SOIL + 34 };
}

// Whole drawing: across the rows, plus along the drip line for drip; key and notes underneath.
function sectionSvg(D, { title = "" } = {}) {
  const W = 760, C = SECTION_COLORS, parts = [];
  let y = title ? 34 : 6;
  const head = (t) => { parts.push(`<text x="16" y="${y + 14}" font-size="13" font-weight="600" fill="#1d2a22">${escapeHtml(t)}</text>`); y += 22; };
  head(D.kind === "drip" ? "Across the rows" : "Cut across the rows");
  const a = sectionPanel(D, { W, top: y }); parts.push(a.svg); y += a.h + 6;
  if (D.kind === "drip") { head("Along the drip line"); const b = sectionPanel(D, { W, top: y, along: true }); parts.push(b.svg); y += b.h + 6; }
  const key = [
    ...(D.roots ? [[`<rect width="22" height="12" fill="${C.roots}" fill-opacity=".35" stroke="${C.roots}" stroke-dasharray="4 3"/>`, "Root zone (deepest roots)"],
    [`<rect width="22" height="12" fill="${C.active}" fill-opacity=".4"/>`, "Top half: about 70% of the water taken"],
    [`<line x1="0" y1="6" x2="22" y2="6" stroke="${C.now}" stroke-width="1.5" stroke-dasharray="7 4"/>`, "Roots now"]] : []),
    ...(D.kind !== "none" ? [[`<rect width="22" height="12" fill="${C.wet}" fill-opacity=".45" stroke="#0288d1" stroke-dasharray="4 2"/>`, D.kind === "drip" ? "Wetted bulb under an emitter" : "Wetted soil after irrigation"]] : []),
    ...(D.probe ? [[`<rect x="8" y="0" width="6" height="12" fill="${C.probe}"/><rect x="6" y="3" width="10" height="6" rx="1.5" fill="${C.sensor}"/>`, "Probe and sensors (depth in cm)"]] : []),
    ...(D.kind === "drip" ? [[`<circle cx="11" cy="6" r="5" fill="${C.pipe}"/>`, "Drip line with emitters"]] : D.kind === "none" ? [] : [[`<rect y="4" width="22" height="4" fill="${C.pipe}"/>`, IRRIGATION_LABELS[D.kind]]]),
  ];
  key.forEach(([s, t], i) => parts.push(`<g transform="translate(${16 + (i % 2) * 360},${y + 8 + Math.floor(i / 2) * 20})">${s}<text x="30" y="10" font-size="12" fill="#1d2a22">${escapeHtml(t)}</text></g>`));
  y += 14 + Math.ceil(key.length / 2) * 20;
  const notes = [
    "Depth and width use different scales; above the ground is not to scale.",
    D.kind !== "none" ? "Wetted zones are drawn as typical shapes: their real size depends on the soil, the flow and how long the water runs." : "",
    !D.roots ? "Pick the crop under “Crop and root depth” to see the roots and the probe." : "",
    D.assumed.length ? `Not entered, so assumed: ${D.assumed.join(", ")}.` : "",
  ].filter(Boolean);
  notes.forEach((t) => { parts.push(`<text x="16" y="${y + 12}" font-size="11.5" fill="#5c6b61">${escapeHtml(t)}</text>`); y += 16; });
  y += 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" height="${y}" role="img" aria-label="Cross-section of the crop, roots, irrigation and probe" style="max-width:100%;height:auto;background:#fff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <rect width="${W}" height="${y}" fill="#fff"/>${title ? `<text x="16" y="22" font-size="16" font-weight="700" fill="#1d2a22">${escapeHtml(title)}</text>` : ""}${parts.join("")}</svg>`;
}
