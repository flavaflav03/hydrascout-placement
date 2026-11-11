"use strict";
// Cross-section of a block: the crop and its roots, the irrigation and the soil it wets, and the HydraScout®
// probe with its sensors, in one drawing. For drip it is cut along the drip line, with the probe a quarter of
// the way between two emitters. Depths come from the crop step (FAO-56
// roots, suggested or chosen probe), widths from the irrigation spacings, the wetted shape from the soil texture.
// Above ground is not to scale.

// Usual row spacing (m) per crop family, used when the irrigation does not give it.
const SECTION_ROWS = { field: 0.75, veg: 0.75, berry: 1.2, tree: 4.5, vine: 2.2 };
const SECTION_COLORS = { soil: "#c9ab86", soilDeep: "#a88762", roots: "#7cb342", active: "#33691e", now: "#1b5e20", wet: "#4fc3f7", wetLine: "#0288d1", pipe: "#0d3c8c", probe: "#263238", sensor: "#ff8f00", plant: "#558b2f", trunk: "#6d4c41", root: "#7b5a43" };

// Wetted bulb under an emitter by soil weight: in sand water goes mostly down (narrow, deep); in loam and clay
// it spreads sideways too (onion shape), widest in clay. rx = half-width (m), depth (cm), belly = depth share
// where the bulb is widest, neck = half-width at the surface as a share of rx. Typical shapes for a 2–4 L/h
// emitter after a normal irrigation, not a model. In clay the water spreads near the surface first (wide, shallow).
const SOIL_BULB = {
  light: { name: "light, sandy", rx: 0.2, depth: 75, belly: 0.5, neck: 0.45 },
  medium: { name: "medium, loamy", rx: 0.35, depth: 60, belly: 0.38, neck: 0.6 },
  heavy: { name: "heavy, clayey", rx: 0.45, depth: 50, belly: 0.3, neck: 0.75 },
};
const LIGHT_SOILS = ["sand", "loamy sand", "sandy loam"], HEAVY_SOILS = ["clay", "silty clay", "sandy clay", "clay loam", "silty clay loam"];
// tex: { sand, silt, clay } in % (SoilGrids 0–60 cm), or null.
function soilWeight(tex) {
  if (!tex || tex.clay == null || tex.sand == null) return { cls: "medium", texture: null };
  const t = textureClass(tex.sand, tex.silt != null ? tex.silt : Math.max(0, 100 - tex.sand - tex.clay), tex.clay);
  return { cls: LIGHT_SOILS.includes(t) ? "light" : HEAVY_SOILS.includes(t) ? "heavy" : "medium", texture: t, clay: tex.clay, sand: tex.sand };
}

// Where a probe goes under drip (Flavien, HSTI): on the drip line, next to the plant's root zone, never under an
// emitter (wettest) and never halfway between two emitters (driest), but at a quarter of the distance between two
// emitters. E.g. emitters 300 cm apart: driest at 150 cm, probe about 75 cm from the emitter.
function dripProbeSpot(emitterCm, lineCm, cls = "medium") {
  const e = emitterCm || 30, d = Math.round(e / 4);
  return { along: d, side: 0, strip: false, text: `On the drip line, in the root zone next to a plant, about ${d} cm from an emitter: a quarter of the distance between two emitters (${Math.round(e)} cm). Not under the emitter (wettest spot) and not halfway between two emitters (driest spot, ${Math.round(e / 2)} cm).` };
}

// x: { roots, probe, cropKey } from the crop step (or null), irr: readIrrigation() output, tex: soil texture.
function sectionData(x, irr, tex, texSource) {
  const kind = irr && irr.type !== "none" ? irr.type : "none", fam = x && CROP_FAMILY[x.cropKey] ? CROP_FAMILY[x.cropKey] : "field";
  const assumed = [];
  let row;
  if (kind === "drip" && irr.lineSpacing) row = irr.lineSpacing / 100;
  else { row = SECTION_ROWS[fam]; assumed.push(kind === "drip" ? `drip lines ${fmt(row * 100, 0)} cm apart, one per row` : `crop rows ${fmt(row, 2)} m apart`); }
  const emitter = kind === "drip" ? (irr.emitter || 30) / 100 : null;
  if (kind === "drip" && !irr.emitter) assumed.push("emitters every 30 cm");
  const soil = soilWeight(tex);
  if (!soil.texture && kind !== "none") assumed.push("a medium (loamy) soil, as the soil texture is not loaded yet");
  const spot = kind === "drip" ? dripProbeSpot(emitter * 100, row * 100, soil.cls) : null;
  return { kind, fam, row, emitter, soil, texSource, spot, roots: x && x.roots, probe: x && x.probe, crop: x && x.roots ? x.roots.crop : null, assumed, irr };
}

// Plant drawn above ground at (cx, gy): h = height in px (symbolic).
function sectionPlant(fam, cx, gy, h, w) {
  const C = SECTION_COLORS;
  if (fam === "tree") return `<path d="M${cx - 5},${gy} L${cx - 3},${gy - h * 0.45} L${cx + 3},${gy - h * 0.45} L${cx + 5},${gy} Z" fill="${C.trunk}"/><ellipse cx="${cx}" cy="${gy - h * 0.7}" rx="${Math.min(w * 0.42, h * 0.5)}" ry="${h * 0.32}" fill="${C.plant}" opacity=".92"/>`;
  if (fam === "vine") return `<path d="M${cx},${gy} C${cx - 3},${gy - h * 0.2} ${cx + 3},${gy - h * 0.4} ${cx},${gy - h * 0.55}" stroke="${C.trunk}" stroke-width="5" fill="none"/><line x1="${cx - w * 0.4}" y1="${gy - h * 0.55}" x2="${cx + w * 0.4}" y2="${gy - h * 0.55}" stroke="#9e9e9e" stroke-width="1.5"/><ellipse cx="${cx}" cy="${gy - h * 0.72}" rx="${Math.min(w * 0.35, h * 0.3)}" ry="${h * 0.2}" fill="${C.plant}" opacity=".92"/>`;
  if (fam === "berry") return `<ellipse cx="${cx}" cy="${gy - h * 0.16}" rx="${Math.min(w * 0.3, 26)}" ry="${h * 0.16}" fill="${C.plant}"/>`;
  // Annual: a stem with leaves.
  const s = h * (fam === "veg" ? 0.45 : 0.9);
  return `<path d="M${cx},${gy} L${cx},${gy - s}" stroke="${C.plant}" stroke-width="3"/>` +
    [0.3, 0.5, 0.7].map((t, i) => { const d = i % 2 ? -1 : 1; return `<path d="M${cx},${gy - s * t} q${d * 8},-2 ${d * 16},-10" stroke="${C.plant}" stroke-width="3" fill="none"/>`; }).join("") +
    `<ellipse cx="${cx}" cy="${gy - s}" rx="5" ry="9" fill="${C.plant}"/>`;
}

// Root system of one plant, as tapering, branching roots. Drawn in a box: hw = half-width (px), dp = depth (px)
// of the deepest roots. Seeded, so the same plant always looks the same.
function sectionRoots(fam, cx, gy, hw, dp, seed = 1, light = false) {
  const rnd = mulberry32(seed), out = [], C = SECTION_COLORS;
  const woody = fam === "tree" || fam === "vine";
  const base = fam === "tree" ? 6 : fam === "vine" ? 4.5 : 2.4;
  // u: -1..1 across the box, v: 0..1 down to the deepest roots.
  const P = (u, v) => [cx + u * hw, gy + v * dp];
  function grow(u, v, ang, len, w, lvl) {
    const n = 4; let a = ang, pu = u, pv = v;
    const pts = [[u, v]];
    for (let i = 0; i < n; i++) {
      a += (rnd() - 0.5) * 0.55;
      // Roots bend downwards as they grow (gravitropism).
      a *= 0.9;
      pu = Math.max(-1, Math.min(1, pu + Math.sin(a) * (len / n)));
      pv = Math.max(0, Math.min(1, pv + Math.cos(a) * (len / n)));
      pts.push([pu, pv]);
    }
    for (let i = 0; i < n; i++) {
      const [a0, a1] = [P(...pts[i]), P(...pts[i + 1])], wi = Math.max(0.5, w * (1 - (i / n) * 0.75));
      const mx = (a0[0] + a1[0]) / 2 + (rnd() - 0.5) * 4, my = (a0[1] + a1[1]) / 2 + (rnd() - 0.5) * 3;
      out.push(`<path d="M${a0[0].toFixed(1)},${a0[1].toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${a1[0].toFixed(1)},${a1[1].toFixed(1)}" stroke-width="${wi.toFixed(2)}"/>`);
    }
    if (lvl <= 0) return;
    const nb = lvl >= 2 ? 2 : 1;
    for (let b = 0; b < nb; b++) {
      const k = 1 + Math.floor(rnd() * (n - 1)), side = rnd() < 0.5 ? -1 : 1;
      grow(pts[k][0], pts[k][1], ang + side * (0.5 + rnd() * 0.7), len * (0.35 + rnd() * 0.25), w * 0.5, lvl - 1);
    }
  }
  const lvl = light ? 1 : 2;
  if (woody) {
    grow(0, 0, 0, 1.0, base, lvl);
    [-1.0, 1.0].forEach((a) => grow(0, 0.03, a, 0.7 + rnd() * 0.2, base * 0.7, 1));
  } else {
    const k = light ? 3 : 4;
    for (let i = 0; i < k; i++) grow(0, 0, -0.9 + (1.8 * i) / (k - 1) + (rnd() - 0.5) * 0.15, 0.75 + rnd() * 0.25, base, 1);
  }
  return `<g stroke="${C.root}" fill="none" stroke-linecap="round" opacity=".75">${out.join("")}</g>`;
}

// Wetted bulb (onion shape) under a point source at (cx, gy): rx and depth in px.
function bulbPath(cx, gy, rx, dz, b) {
  const n = rx * b.neck, yb = gy + dz * b.belly, yd = gy + dz;
  return `M${cx - n},${gy} C${cx - n - (rx - n) * 0.7},${gy + dz * b.belly * 0.15} ${cx - rx},${yb - dz * b.belly * 0.45} ${cx - rx},${yb}`
    + ` C${cx - rx},${yb + (yd - yb) * 0.55} ${cx - rx * 0.45},${yd} ${cx},${yd}`
    + ` C${cx + rx * 0.45},${yd} ${cx + rx},${yb + (yd - yb) * 0.55} ${cx + rx},${yb}`
    + ` C${cx + rx},${yb - dz * b.belly * 0.45} ${cx + n + (rx - n) * 0.7},${gy + dz * b.belly * 0.15} ${cx + n},${gy} Z`;
}

// The one panel: along the drip line for drip, across the rows otherwise.
function sectionPanel(D, { W = 760, top = 0 } = {}) {
  const C = SECTION_COLORS, r = D.roots, p = D.probe, drip = D.kind === "drip", B = SOIL_BULB[D.soil.cls];
  const maxCm = Math.max(60, r ? r.maxCm : 0, p ? p.lengthCm : 0, drip ? B.depth : 0) + 20, AIR = 160, SOIL = 320, L = 60, PR = W - 110, gy = top + AIR;
  const span = drip ? Math.max(3 * D.emitter, 1.2) : D.row * (D.row >= 1.5 ? 3 : D.row >= 0.6 ? 4 : 6);
  const pxm = (PR - L) / span, X = (m) => L + m * pxm, Z = (cm) => gy + (cm / maxCm) * SOIL;
  const out = [], g = [], wet = [], plants = [];
  out.push(`<defs><linearGradient id="soilG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.soil}"/><stop offset="1" stop-color="${C.soilDeep}"/></linearGradient>
    <clipPath id="soilC"><rect x="${L}" y="${gy}" width="${PR - L}" height="${SOIL}"/></clipPath></defs>`);
  out.push(`<rect x="${L}" y="${top + 8}" width="${PR - L}" height="${AIR - 8}" fill="#eef6fb"/><rect x="${L}" y="${gy}" width="${PR - L}" height="${SOIL}" fill="url(#soilG)"/>`);
  for (let cm = 0; cm <= maxCm; cm += maxCm > 120 ? 20 : 10) out.push(`<line x1="${L - 5}" y1="${Z(cm)}" x2="${L}" y2="${Z(cm)}" stroke="#5c6b61"/><text x="${L - 8}" y="${Z(cm) + 4}" font-size="11" text-anchor="end" fill="#5c6b61">${cm}</text>`);
  out.push(`<text x="12" y="${gy + SOIL / 2}" font-size="11" fill="#5c6b61" transform="rotate(-90 12 ${gy + SOIL / 2})" text-anchor="middle">Depth (cm)</text>`);
  // Plant positions: along the line (drip) or the rows across.
  // Emitters along the line; the probe sits a quarter of the way from one emitter to the next, by a plant.
  const ems = []; if (drip) for (let m = D.emitter / 2; m < span; m += D.emitter) ems.push(m);
  const e0 = drip ? ems[Math.floor((ems.length - 1) / 2)] : null, e1 = drip ? e0 + D.emitter : null;
  const pmDrip = drip ? e0 + D.spot.along / 100 : null;
  if (drip) {
    const step = D.fam === "tree" ? span * 2 : D.fam === "vine" ? 1 : Math.max(0.2, span / 4);
    // A plant right next to the probe, the others at the planting distance.
    const a = pmDrip + Math.min(step * 0.2, 0.2);
    for (let m = a - Math.floor(a / step) * step; m < span; m += step) if (m > span * 0.04 && m < span * 0.96) plants.push(m);
    if (!plants.length) plants.push(a);
  } else for (let m = D.row / 2; m < span; m += D.row) plants.push(m);
  // Wetted soil (typical shapes from the soil weight).
  const bulb = (m, opa = 0.32) => wet.push(`<path d="${bulbPath(X(m), gy, B.rx * pxm, Z(B.depth) - gy, B)}" fill="${C.wet}" fill-opacity="${opa}" stroke="${C.wetLine}" stroke-width="1.2" stroke-dasharray="5 3"/>`);
  // Drip: neighbouring bulbs that touch merge into one wet strip with a scalloped bottom (one outline, even colour).
  if (drip) {
    const ds = ems.map((m) => bulbPath(X(m), gy, B.rx * pxm, Z(B.depth) - gy, B));
    wet.push(`<g opacity=".34">${ds.map((d) => `<path d="${d}" fill="none" stroke="${C.wetLine}" stroke-width="3"/>`).join("")}${ds.map((d) => `<path d="${d}" fill="${C.wet}"/>`).join("")}</g>`);
  }
  else if (D.kind === "furrow") plants.slice(0, -1).forEach((m) => bulb(m + D.row / 2));
  else if (D.kind === "micro") { const hs = Math.max(D.irr.spacing || 6, D.row); for (let m = D.row; m < span; m += hs) wet.push(`<path d="${bulbPath(X(m), gy, Math.min(1.5 * pxm, 80), Z(B.depth * 0.9) - gy, { ...B, neck: 0.85 })}" fill="${C.wet}" fill-opacity=".3" stroke="${C.wetLine}" stroke-width="1.2" stroke-dasharray="5 3"/>`); }
  else if (D.kind !== "none") { const d = D.soil.cls === "light" ? 45 : D.soil.cls === "heavy" ? 25 : 35; wet.push(`<rect x="${L}" y="${gy}" width="${PR - L}" height="${Z(d) - gy}" fill="${C.wet}" fill-opacity=".28"/><line x1="${L}" y1="${Z(d)}" x2="${PR}" y2="${Z(d)}" stroke="${C.wetLine}" stroke-width="1.2" stroke-dasharray="5 3"/>`); }
  // Root zone (light shading) and real-looking roots.
  if (r) {
    const deep = Z(r.maxCm), act = Z(r.activeCm), k = 24;
    if (drip || D.fam !== "tree") {
      g.push(`<path d="M${L},${gy} L${L},${deep - k} Q${L},${deep} ${L + k},${deep} L${PR - k},${deep} Q${PR},${deep} ${PR},${deep - k} L${PR},${gy} Z" fill="${C.roots}" fill-opacity=".18" stroke="${C.roots}" stroke-dasharray="4 3"/>`);
      g.push(`<rect x="${L}" y="${gy}" width="${PR - L}" height="${act - gy}" fill="${C.active}" fill-opacity=".14"/>`);
    }
    const many = plants.length > 3;
    plants.forEach((m, i) => {
      const hw = Math.min(drip ? span / Math.max(plants.length, 1) * 0.9 : D.row * 0.55, D.fam === "tree" ? 2.4 : 1.2) * pxm;
      if (!drip && D.fam === "tree") {
        const w = hw, dp = deep - gy, a = act - gy;
        g.push(`<path d="M${X(m) - w},${gy} C${X(m) - w},${gy + dp * 0.6} ${X(m) - w * 0.35},${gy + dp} ${X(m)},${gy + dp} C${X(m) + w * 0.35},${gy + dp} ${X(m) + w},${gy + dp * 0.6} ${X(m) + w},${gy} Z" fill="${C.roots}" fill-opacity=".18" stroke="${C.roots}" stroke-dasharray="4 3"/>`);
        g.push(`<path d="M${X(m) - w * 0.85},${gy} C${X(m) - w * 0.85},${gy + a * 0.7} ${X(m) - w * 0.3},${gy + a} ${X(m)},${gy + a} C${X(m) + w * 0.3},${gy + a} ${X(m) + w * 0.85},${gy + a * 0.7} ${X(m) + w * 0.85},${gy} Z" fill="${C.active}" fill-opacity=".14"/>`);
      }
      g.push(sectionRoots(D.fam, X(m), gy, hw, (Z(r.nowCm != null ? r.nowCm : r.maxCm) - gy) * 0.97, 7 + i * 13, many));
    });
    if (r.nowCm != null && r.nowCm < r.maxCm) g.push(`<line x1="${L}" y1="${Z(r.nowCm)}" x2="${PR}" y2="${Z(r.nowCm)}" stroke="${C.now}" stroke-width="1.5" stroke-dasharray="7 4"/>`);
  }
  out.push(`<g clip-path="url(#soilC)">${g.join("")}${wet.join("")}</g>`);
  if (r && r.nowCm != null && r.nowCm < r.maxCm) out.push(`<text x="${PR + 6}" y="${Z(r.nowCm) + 4}" font-size="11" fill="${C.now}">roots now</text>`);
  if (r) out.push(`<text x="${PR + 6}" y="${Z(r.maxCm) + 4}" font-size="11" fill="#33691e">deepest roots</text>`);
  if (D.kind !== "none") { const d = drip || D.kind === "furrow" ? B.depth : D.kind === "micro" ? B.depth * 0.9 : D.soil.cls === "light" ? 45 : D.soil.cls === "heavy" ? 25 : 35; let wy = Z(d) + 4; if (r && Math.abs(wy - Z(r.maxCm) - 4) < 14) wy = Z(r.maxCm) + 4 + (d > r.maxCm ? 14 : -14); out.push(`<text x="${PR + 6}" y="${wy}" font-size="11" fill="${C.wetLine}">wetted</text>`); }
  // Plants above ground.
  plants.forEach((m) => out.push(sectionPlant(D.fam, X(m), gy, AIR - 50, (drip ? span / plants.length : D.row) * pxm)));
  // Irrigation equipment.
  if (drip) {
    out.push(`<line x1="${L}" y1="${gy - 4}" x2="${PR}" y2="${gy - 4}" stroke="${C.pipe}" stroke-width="6" stroke-linecap="round"/>`);
    ems.forEach((m) => out.push(`<circle cx="${X(m)}" cy="${gy - 4}" r="3.5" fill="#fff" stroke="${C.pipe}" stroke-width="1.5"/><path d="M${X(m)},${gy + 1} l0,6" stroke="${C.wet}" stroke-width="2"/>`));
    const dim = (a, b, yy, t) => `<g stroke="#5c6b61" fill="none"><path d="M${X(a)},${yy - 3} l0,6 M${X(b)},${yy - 3} l0,6 M${X(a)},${yy} L${X(b)},${yy}"/></g><text x="${(X(a) + X(b)) / 2}" y="${yy - 5}" font-size="11" text-anchor="middle" fill="#1d2a22" stroke="#eef6fb" stroke-width="3" paint-order="stroke">${t}</text>`;
    out.push(dim(e0, e1, gy - 18, `${fmt(D.emitter * 100, 0)} cm between emitters`));
    if (p) out.push(dim(e0, pmDrip, gy - 36, `${D.spot.along} cm (¼)`));
    // Wettest (under the emitter) and driest (halfway) spots, just under the surface.
    const tag = (x, t, c) => `<text x="${x}" y="${gy + 16}" font-size="10.5" font-weight="600" text-anchor="middle" fill="${c}" stroke="#fff" stroke-width="3" paint-order="stroke">${t}</text>`;
    out.push(tag(X(e0), "wettest", C.wetLine), tag(X(e0 + D.emitter / 2), "driest", "#a1662f"));
  } else if (D.kind === "micro") {
    const hs = Math.max(D.irr.spacing || 6, D.row); for (let m = D.row; m < span; m += hs) { const x = X(m); out.push(`<line x1="${x}" y1="${gy}" x2="${x}" y2="${gy - 22}" stroke="${C.pipe}" stroke-width="2.5"/><path d="M${x - 40},${gy - 4} Q${x},${gy - 50} ${x + 40},${gy - 4}" stroke="${C.wet}" stroke-width="1.5" fill="none" stroke-dasharray="3 3"/><circle cx="${x}" cy="${gy - 24}" r="4" fill="${C.pipe}"/>`); }
  } else if (D.kind === "sprinkler") {
    const x = X(span * 0.12); out.push(`<line x1="${x}" y1="${gy}" x2="${x}" y2="${top + 30}" stroke="${C.pipe}" stroke-width="3"/><circle cx="${x}" cy="${top + 28}" r="5" fill="${C.pipe}"/><path d="M${x},${top + 28} Q${(x + PR) / 2},${top - 10} ${PR},${gy - 30}" stroke="${C.wet}" stroke-width="2" fill="none" stroke-dasharray="5 4"/>`);
  } else if (D.kind === "pivot" || D.kind === "linear") {
    out.push(`<line x1="${L}" y1="${top + 22}" x2="${PR}" y2="${top + 22}" stroke="${C.pipe}" stroke-width="5"/>`);
    for (let x = L + 30; x < PR; x += 60) out.push(`<line x1="${x}" y1="${top + 22}" x2="${x}" y2="${top + 70}" stroke="${C.pipe}" stroke-width="1.5"/><path d="M${x - 12},${top + 92} L${x},${top + 72} L${x + 12},${top + 92}" stroke="${C.wet}" stroke-width="1.5" fill="none" stroke-dasharray="3 3"/>`);
  } else if (D.kind === "furrow") {
    plants.slice(0, -1).forEach((m) => { const x = X(m + D.row / 2), w = Math.min(0.3 * D.row * pxm, 30); out.push(`<path d="M${x - w},${gy} L${x},${gy + 12} L${x + w},${gy} Z" fill="${C.wet}" stroke="${C.pipe}" stroke-width="1"/>`); });
  }
  out.push(`<line x1="${L}" y1="${gy}" x2="${PR}" y2="${gy}" stroke="#6d4c41" stroke-width="2"/>`);
  // The probe. Drip: a quarter of the way from the emitter to the driest point (along the line, or to the side).
  if (p) {
    const pm = drip ? pmDrip : plants[Math.floor((plants.length - 1) / 2)] + Math.min(0.15, D.row * 0.2);
    const px = X(pm), side = drip && D.spot.side;
    out.push(`<g${side ? ' opacity=".92"' : ""}><rect x="${px - 5}" y="${gy - 14}" width="10" height="14" rx="2" fill="${C.probe}"/><rect x="${px - 3}" y="${gy}" width="6" height="${Z(p.lengthCm) - gy}" fill="${C.probe}"${side ? ` stroke="#fff" stroke-dasharray="3 2"` : ""}/></g>`);
    p.depthsCm.forEach((d) => out.push(`<rect x="${px - 5}" y="${Z(d) - 3}" width="10" height="6" rx="1.5" fill="${C.sensor}"/><text x="${px + 9}" y="${Z(d) + 4}" font-size="10.5" fill="#1d2a22" stroke="#fff" stroke-width="3" paint-order="stroke">${d}</text>`));
    out.push(`<text x="${px}" y="${drip ? Z(p.lengthCm) + 18 : gy - 32}" font-size="11.5" font-weight="700" text-anchor="middle" fill="#1d2a22" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeHtml(p.code)}</text>`);
  }
  // Width scale.
  const nice = [0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((m) => m * pxm > 60) || 5;
  out.push(`<g transform="translate(${L},${gy + SOIL + 18})"><rect width="${nice * pxm}" height="4" fill="#1d2a22"/><text x="${nice * pxm + 8}" y="6" font-size="11" fill="#1d2a22">${nice < 1 ? `${nice * 100} cm` : `${nice} m`} (width)</text></g>`);
  return { svg: out.join(""), h: AIR + SOIL + 34 };
}

// Whole drawing: the panel, its key and notes underneath.
function sectionSvg(D, { title = "" } = {}) {
  const W = 760, C = SECTION_COLORS, parts = [];
  let y = title ? 34 : 6;
  parts.push(`<text x="16" y="${y + 14}" font-size="13" font-weight="600" fill="#1d2a22">${D.kind === "drip" ? "Cut along the drip line" : "Cut across the rows"}</text>`); y += 22;
  const a = sectionPanel(D, { W, top: y }); parts.push(a.svg); y += a.h + 6;
  const key = [
    ...(D.roots ? [[`<path d="M2,1 Q8,6 11,12 M11,1 Q12,6 14,12 M20,1 Q16,6 15,12" stroke="${C.root}" stroke-width="1.6" fill="none"/>`, "Roots, down to today's depth"],
      [`<rect width="22" height="12" fill="${C.roots}" fill-opacity=".25" stroke="${C.roots}" stroke-dasharray="4 3"/>`, "Root zone (deepest roots of the season)"],
      [`<rect width="22" height="12" fill="${C.active}" fill-opacity=".25"/>`, "Top half: about 70% of the water taken"]] : []),
    ...(D.kind !== "none" ? [[`<rect width="22" height="12" fill="${C.wet}" fill-opacity=".45" stroke="${C.wetLine}" stroke-dasharray="4 2"/>`, D.kind === "drip" ? "Wetted bulb under an emitter" : "Wetted soil after irrigation"]] : []),
    ...(D.probe ? [[`<rect x="8" y="0" width="6" height="12" fill="${C.probe}"/><rect x="6" y="3" width="10" height="6" rx="1.5" fill="${C.sensor}"/>`, "Probe and sensors (depth in cm)"]] : []),
    ...(D.kind === "drip" ? [[`<line x1="0" y1="6" x2="22" y2="6" stroke="${C.pipe}" stroke-width="5"/><circle cx="11" cy="6" r="3" fill="#fff" stroke="${C.pipe}"/>`, "Drip line and emitter"]] : D.kind === "none" ? [] : [[`<rect y="4" width="22" height="4" fill="${C.pipe}"/>`, IRRIGATION_LABELS[D.kind]]]),
  ];
  key.forEach(([s, t], i) => parts.push(`<g transform="translate(${16 + (i % 2) * 360},${y + 8 + Math.floor(i / 2) * 20})">${s}<text x="30" y="10" font-size="12" fill="#1d2a22">${escapeHtml(t)}</text></g>`));
  y += 14 + Math.ceil(key.length / 2) * 20;
  const so = D.soil, B = SOIL_BULB[so.cls];
  const soilLine = D.kind === "none" ? "" : so.texture
    ? `Soil: ${so.texture} (about ${fmt(so.clay, 0)}% clay, ${fmt(so.sand, 0)}% sand${D.texSource ? `, ${D.texSource}` : ""}), a ${B.name} soil: ${so.cls === "light" ? "water goes mostly down, so the bulbs are narrow and deep" : so.cls === "heavy" ? "water spreads sideways near the surface first, so the bulbs are wide and onion-shaped" : "water spreads sideways too, so the bulbs are onion-shaped"}${D.kind === "drip" && D.emitter < 2 * B.rx ? ", and with these emitters they join into one wet strip along the line." : "."}`
    : "";
  const notes = [
    soilLine,
    D.spot && D.probe ? `Probe: ${D.spot.text}` : "",
    "Depth and width use different scales; above the ground is not to scale. Wetted shapes are typical: their real size also depends on the flow and how long the water runs.",
    !D.roots ? "Pick the crop under “Crop and root depth” to see the roots and the probe." : "",
    D.assumed.length ? `Not entered, so assumed: ${D.assumed.join(", ")}.` : "",
  ].filter(Boolean);
  // Wrap long notes at about 115 characters.
  notes.forEach((t) => {
    const words = t.split(" "), lines = [""];
    words.forEach((wd) => { if ((lines[lines.length - 1] + " " + wd).length > 118) lines.push(wd); else lines[lines.length - 1] = (lines[lines.length - 1] + " " + wd).trim(); });
    lines.forEach((ln) => { parts.push(`<text x="16" y="${y + 12}" font-size="11.5" fill="#5c6b61">${escapeHtml(ln)}</text>`); y += 15; });
    y += 3;
  });
  y += 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" height="${y}" role="img" aria-label="Cross-section of the crop, roots, irrigation and probe" style="max-width:100%;height:auto;background:#fff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <rect width="${W}" height="${y}" fill="#fff"/>${title ? `<text x="16" y="22" font-size="16" font-weight="700" fill="#1d2a22">${escapeHtml(title)}</text>` : ""}${parts.join("")}</svg>`;
}
