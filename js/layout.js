"use strict";
// Irrigation equipment layout, worked out from the irrigation inputs and the drawn blocks: drip or sprinkler
// laterals along the rows, the header pipe and valve of each block, sprinkler heads, the pivot's spans and wheel
// tracks, or the linear machine. It is a schematic: line positions follow the spacings entered, not a survey.

// Usual values, used (and flagged as assumed) when a spacing is left empty.
const LAYOUT_DEFAULTS = { emitter: 30, lineSpacing: 150, micro: 6, sprinkler: 18, span: 55, furrow: 80 };
const LAYOUT_COLORS = { lateral: "#4fc3f7", header: "#0d3c8c", valve: "#d84315", head: "#1565c0", wet: "#4fc3f7", machine: "#1565c0", furrow: "#a1887f" };

// Bearing (degrees clockwise from north, 0–180) of the long side of the smallest rectangle around the polygon.
// Rows, drip lines and sprinkler laterals usually run along it.
function longAxisBearing(xy) {
  let best = null;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const a = Math.atan2(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]), d = [Math.sin(a), Math.cos(a)], n = [d[1], -d[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of xy) { const u = x * d[0] + y * d[1], v = x * n[0] + y * n[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) best = { area, deg: (((a * 180) / Math.PI) + (u1 - u0 >= v1 - v0 ? 0 : 90) + 360) % 180 };
  }
  return best ? best.deg : 0;
}
const bearingName = (deg) => ["N–S", "NNE–SSW", "NE–SW", "ENE–WSW", "E–W", "ESE–WNW", "SE–NW", "SSE–NNW"][Math.round((((deg % 180) + 180) % 180) / 22.5) % 8];

// Row frame of a bearing: u runs along the rows, v across them.
function rowFrame(deg) {
  const b = (deg * Math.PI) / 180, d = [Math.sin(b), Math.cos(b)], n = [Math.cos(b), -Math.sin(b)];
  return { uv: ([x, y]) => [x * d[0] + y * d[1], x * n[0] + y * n[1]], xy: (u, v) => [u * d[0] + v * n[0], u * d[1] + v * n[1]] };
}
// Pieces of the line v = const inside a polygon given in (u, v), as [u0, u1] pairs.
function cutRow(uvRing, v) {
  const us = [];
  for (let i = 0, j = uvRing.length - 1; i < uvRing.length; j = i++) {
    const [ua, va] = uvRing[j], [ub, vb] = uvRing[i];
    if ((va > v) !== (vb > v)) us.push(ua + ((v - va) / (vb - va)) * (ub - ua));
  }
  us.sort((a, b) => a - b);
  const out = []; for (let k = 0; k + 1 < us.length; k += 2) if (us[k + 1] - us[k] > 0.5) out.push([us[k], us[k + 1]]);
  return out;
}

// Layout of every area. areas: [{ name, color, ring: [[lat, lon]…], valve: [lat, lon] | null }], irr: readIrrigation()
// output plus rowBearing (null = automatic). Coordinates are local metres of one projection P.
function buildLayout(areas, irr) {
  const kind = irr && irr.type;
  if (!kind || kind === "none" || !areas.length) return null;
  const all = areas.flatMap((a) => a.ring), c = centroidLatLng(all), P = makeProj(c[0], c[1]);
  const assumed = [], num = (v, def, label) => { if (v) return v; assumed.push(label); return def; };
  const L = { kind, P, areas: [], assumed, irr };
  if (kind === "pivot") {
    const pv = irr.pivot || {};
    L.areas = areas.map((a) => ({ ...a, xy: a.ring.map(([la, lo]) => P.fwd(la, lo)) }));
    if (!pv.radius || pv.lat == null) { L.missing = "Place the pivot centre and enter its radius to see the pivot."; return L; }
    const span = num(pv.span, LAYOUT_DEFAULTS.span, `span length ${LAYOUT_DEFAULTS.span} m`), ctr = P.fwd(pv.lat, pv.lon);
    const towers = []; for (let r = span; r < pv.radius - 1; r += span) towers.push(r); towers.push(pv.radius);
    // The arm is drawn towards the middle of the blocks, where it is easiest to see.
    const ang = Math.atan2(-ctr[0], -ctr[1]) || 0;
    L.pivot = { ctr, radius: pv.radius, span, towers, arm: [Math.sin(ang), Math.cos(ang)] };
    return L;
  }
  const spacingAcross = kind === "drip" ? num(irr.lineSpacing, LAYOUT_DEFAULTS.lineSpacing, `drip lines ${LAYOUT_DEFAULTS.lineSpacing} cm apart`) / 100
    : kind === "micro" || kind === "sprinkler" ? num(irr.spacing, LAYOUT_DEFAULTS[kind], `heads ${LAYOUT_DEFAULTS[kind]} m apart`)
    : kind === "furrow" ? LAYOUT_DEFAULTS.furrow / 100 : null;
  if (kind === "drip") num(irr.emitter, LAYOUT_DEFAULTS.emitter, `emitters every ${LAYOUT_DEFAULTS.emitter} cm`);
  const linSpan = kind === "linear" ? num(irr.pivot && irr.pivot.span, LAYOUT_DEFAULTS.span, `span length ${LAYOUT_DEFAULTS.span} m`) : null;
  if (kind === "furrow") assumed.push(`furrows ${LAYOUT_DEFAULTS.furrow} cm apart (drawn for direction only)`);
  for (const a of areas) {
    const xy = a.ring.map(([la, lo]) => P.fwd(la, lo)), auto = irr.rowBearing == null, deg = auto ? longAxisBearing(xy) : irr.rowBearing;
    const F = rowFrame(deg), uv = xy.map(F.uv), vs = uv.map((p) => p[1]), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const out = { ...a, xy, deg, auto, laterals: [], heads: [], header: [], valve: null, valveSet: false };
    if (kind === "linear") {
      // The machine spans across the rows and travels along them, fed from one end of its path.
      const us = uv.map((p) => p[0]), u0 = Math.min(...us), u1 = Math.max(...us), vm = (v0 + v1) / 2;
      const len = irr.pivot && irr.pivot.radius ? irr.pivot.radius : v1 - v0;
      if (!(irr.pivot && irr.pivot.radius)) assumed.push("machine as wide as the block");
      const towers = []; for (let t = 0; t <= len + 0.1; t += linSpan) towers.push(F.xy(u0 + 4, vm - len / 2 + Math.min(t, len)));
      if (towers.length < 2 || len - (towers.length - 1) * linSpan > 1) towers.push(F.xy(u0 + 4, vm + len / 2));
      out.machine = { line: [F.xy(u0 + 4, vm - len / 2), F.xy(u0 + 4, vm + len / 2)], towers, path: [F.xy(u0, vm - len / 2), F.xy(u1, vm - len / 2), F.xy(u1, vm + len / 2), F.xy(u0, vm + len / 2)],
        arrow: [F.xy(u0 + (u1 - u0) * 0.35, vm), F.xy(u0 + (u1 - u0) * 0.65, vm)], len };
      L.areas.push(out); continue;
    }
    const rows = [];
    for (let v = v0 + spacingAcross / 2; v < v1; v += spacingAcross) for (const [ua, ub] of cutRow(uv, v)) rows.push({ v, ua, ub });
    out.spacing = spacingAcross; out.rowsTotal = rows.length;
    // The header pipe (or head ditch) runs along the end of the rows nearest the valve; the first end by default.
    const valveUv = a.valve ? F.uv(P.fwd(a.valve[0], a.valve[1])) : null;
    const firsts = new Map(), lasts = new Map();
    for (const r of rows) { if (!firsts.has(r.v) || r.ua < firsts.get(r.v)) firsts.set(r.v, r.ua); if (!lasts.has(r.v) || r.ub > lasts.get(r.v)) lasts.set(r.v, r.ub); }
    const sideCost = (m) => (valveUv ? mean([...m].map(([v, u]) => Math.hypot(u - valveUv[0], v - valveUv[1]))) : 0);
    const useEnd = valveUv ? sideCost(lasts) < sideCost(firsts) : false;
    const ends = [...(useEnd ? lasts : firsts)].sort((p, q) => p[0] - q[0]);
    out.header = ends.map(([v, u]) => F.xy(u, v));
    if (out.header.length === 1) out.header.push(out.header[0]);
    out.laterals = rows.map((r) => ({ a: F.xy(r.ua, r.v), b: F.xy(r.ub, r.v), len: r.ub - r.ua, v: r.v }));
    if (kind === "micro" || kind === "sprinkler") {
      for (const r of rows) for (let u = r.ua + spacingAcross / 2; u <= r.ub - spacingAcross / 4; u += spacingAcross) out.heads.push(F.xy(u, r.v));
      out.headSpacing = spacingAcross;
    }
    if (kind !== "furrow") {
      if (a.valve) { out.valve = P.fwd(a.valve[0], a.valve[1]); out.valveSet = true; }
      else if (out.header.length) {
        // Middle of the header pipe, measured along it.
        const h = out.header, seg = h.slice(1).map((p, i) => Math.hypot(p[0] - h[i][0], p[1] - h[i][1])), half = seg.reduce((s, x) => s + x, 0) / 2;
        let acc = 0, k = 0; while (k < seg.length - 1 && acc + seg[k] < half) acc += seg[k++];
        const f = seg[k] ? (half - acc) / seg[k] : 0; out.valve = [h[k][0] + (h[k + 1][0] - h[k][0]) * f, h[k][1] + (h[k + 1][1] - h[k][1]) * f];
      }
      if (out.valveSet && out.header.length) {
        let best = null; out.header.forEach((p) => { const d = Math.hypot(p[0] - out.valve[0], p[1] - out.valve[1]); if (!best || d < best.d) best = { p, d }; });
        if (best.d > 1) out.feed = [out.valve, best.p];
      }
    }
    L.areas.push(out);
  }
  if (L.areas.some((a) => a.valve && !a.valveSet)) assumed.push("valve in the middle of the header pipe (place the real one on the map)");
  return L;
}

// Every k-th line, so lines stay at least minGap apart (same unit as gap).
const thinStep = (gap, minGap) => Math.max(1, Math.ceil(minGap / Math.max(gap, 1e-6)));

// Short sentence on what the layout shows, per area.
function layoutAreaText(a, L) {
  if (L.kind === "linear") return `machine ${fmt(a.machine.len, 0)} m wide, travelling ${bearingName(a.deg)}`;
  const dir = `${bearingName(a.deg)}${a.auto ? " (long side)" : ""}`;
  if (L.kind === "furrow") return `furrows ${dir}`;
  const what = L.kind === "drip" ? "drip lines" : "laterals";
  return `${a.rowsTotal} ${what} ${dir}, ${fmt(a.laterals.reduce((s, l) => s + l.len, 0) / 1000, 1)} km${a.heads.length ? `, ${a.heads.length} heads` : ""}`;
}

// 2D plan of the layout (SVG, local metres, north up) with a key and a close-up of the spacing.
// probes: [{ label, color, lat, lon }]
function layoutSvg(L, { title = "", probes = [] } = {}) {
  if (!L) return "";
  const P = L.P, pts = L.areas.flatMap((a) => a.xy);
  if (L.pivot) { const { ctr, radius } = L.pivot; pts.push([ctr[0] - radius, ctr[1] - radius], [ctr[0] + radius, ctr[1] + radius]); }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), pad = Math.max(8, 0.04 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const W = 760, H = Math.round(Math.max(300, Math.min(820, (W * (y1 - y0)) / (x1 - x0)))), sc = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
  const X = (x) => (ox + (x - x0) * sc).toFixed(1), Y = (y) => (H - oy - (y - y0) * sc).toFixed(1), pt = (p) => `${X(p[0])},${Y(p[1])}`;
  const C = LAYOUT_COLORS, parts = [], top = [], notes = [];
  for (const a of L.areas) parts.push(`<polygon points="${a.xy.map(pt).join(" ")}" fill="${a.color}" fill-opacity="0.1" stroke="none"/>`);
  if (L.pivot) {
    const { ctr, radius, towers, arm, span } = L.pivot;
    towers.forEach((r, i) => parts.push(`<circle cx="${X(ctr[0])}" cy="${Y(ctr[1])}" r="${(r * sc).toFixed(1)}" fill="${i === towers.length - 1 ? C.wet : "none"}" fill-opacity="0.12" stroke="${C.furrow}" stroke-width="${i === towers.length - 1 ? 1.6 : 1}" stroke-dasharray="${i === towers.length - 1 ? "" : "4 3"}"/>`));
    const tip = [ctr[0] + arm[0] * radius, ctr[1] + arm[1] * radius];
    parts.push(`<line x1="${X(ctr[0])}" y1="${Y(ctr[1])}" x2="${X(tip[0])}" y2="${Y(tip[1])}" stroke="${C.machine}" stroke-width="3"/>`);
    towers.forEach((r) => parts.push(`<circle cx="${X(ctr[0] + arm[0] * r)}" cy="${Y(ctr[1] + arm[1] * r)}" r="4" fill="#fff" stroke="${C.machine}" stroke-width="2"/>`));
    parts.push(`<circle cx="${X(ctr[0])}" cy="${Y(ctr[1])}" r="6" fill="${C.machine}" stroke="#fff" stroke-width="2"/>`);
    notes.push(`Pivot ${fmt(radius, 0)} m, ${towers.length} span${towers.length > 1 ? "s" : ""} of about ${fmt(span, 0)} m; dashed rings are the tower wheel tracks.`);
  }
  for (const a of L.areas) {
    if (a.machine) {
      const m = a.machine;
      parts.push(`<polygon points="${m.path.map(pt).join(" ")}" fill="${C.wet}" fill-opacity="0.12" stroke="${C.machine}" stroke-width="1" stroke-dasharray="5 4"/>`);
      parts.push(`<line x1="${X(m.arrow[0][0])}" y1="${Y(m.arrow[0][1])}" x2="${X(m.arrow[1][0])}" y2="${Y(m.arrow[1][1])}" stroke="${C.machine}" stroke-width="2" marker-end="url(#lyArrow)"/>`);
      parts.push(`<line x1="${X(m.line[0][0])}" y1="${Y(m.line[0][1])}" x2="${X(m.line[1][0])}" y2="${Y(m.line[1][1])}" stroke="${C.machine}" stroke-width="3"/>`);
      m.towers.forEach((p) => parts.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.5" fill="#fff" stroke="${C.machine}" stroke-width="2"/>`));
      continue;
    }
    if (!a.laterals) continue;
    const k = thinStep(a.spacing * sc, L.kind === "furrow" ? 6 : 4);
    if (L.kind === "micro" || L.kind === "sprinkler") {
      const kh = thinStep(a.headSpacing * sc, 7);
      if (a.headSpacing * sc >= 10) a.heads.forEach((h) => parts.push(`<circle cx="${X(h[0])}" cy="${Y(h[1])}" r="${(a.headSpacing * sc).toFixed(1)}" fill="${C.wet}" fill-opacity="0.06" stroke="none"/>`));
      a.laterals.forEach((l, i) => { if (i % kh === 0) parts.push(`<line x1="${X(l.a[0])}" y1="${Y(l.a[1])}" x2="${X(l.b[0])}" y2="${Y(l.b[1])}" stroke="${C.lateral}" stroke-width="1.2"/>`); });
      if (a.headSpacing * sc >= 5) a.heads.forEach((h) => parts.push(`<circle cx="${X(h[0])}" cy="${Y(h[1])}" r="2.2" fill="#fff" stroke="${C.head}" stroke-width="1.2"/>`));
      if (kh > 1) notes.push(`Block ${a.name}: 1 lateral in ${kh} drawn so the plan stays readable.`);
    } else {
      const col = L.kind === "furrow" ? C.furrow : C.lateral;
      a.laterals.forEach((l, i) => { if (i % k === 0) parts.push(`<line x1="${X(l.a[0])}" y1="${Y(l.a[1])}" x2="${X(l.b[0])}" y2="${Y(l.b[1])}" stroke="${col}" stroke-width="1"/>`); });
      if (k > 1) notes.push(`${a.name === "Field" ? "Field" : `Block ${a.name}`}: 1 ${L.kind === "furrow" ? "furrow" : "drip line"} in ${k} drawn so the plan stays readable (${a.rowsTotal} in all).`);
    }
    if (a.header.length > 1) top.push(`<polyline points="${a.header.map(pt).join(" ")}" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${a.header.map(pt).join(" ")}" fill="none" stroke="${L.kind === "furrow" ? "#8d6e63" : C.header}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (a.feed) top.push(`<line x1="${X(a.feed[0][0])}" y1="${Y(a.feed[0][1])}" x2="${X(a.feed[1][0])}" y2="${Y(a.feed[1][1])}" stroke="${C.header}" stroke-width="2.5" stroke-dasharray="6 3"/>`);
    if (a.valve) top.push(`<g transform="translate(${X(a.valve[0])},${Y(a.valve[1])})"><rect x="-7" y="-7" width="14" height="14" rx="2" fill="${C.valve}" stroke="#fff" stroke-width="2"/><path d="M-4,-4 L4,4 M-4,4 L4,-4" stroke="#fff" stroke-width="1.6"/></g>`);
  }
  for (const a of L.areas) parts.push(`<polygon points="${a.xy.map(pt).join(" ")}" fill="none" stroke="${a.color === "#ffffff" ? "#1e2d40" : a.color}" stroke-width="2"/>`);
  parts.push(...top);
  if (L.areas.length > 1 || L.areas[0].name !== "Field") for (const a of L.areas) { const m = [mean(a.xy.map((p) => p[0])), mean(a.xy.map((p) => p[1]))]; parts.push(`<text x="${X(m[0])}" y="${Y(m[1])}" text-anchor="middle" font-size="15" font-weight="700" fill="#1e2d40" stroke="#fff" stroke-width="4" paint-order="stroke">${escapeHtml(a.name)}</text>`); }
  probes.forEach((p) => { const [px, py] = P.fwd(p.lat, p.lon); parts.push(`<g><circle cx="${X(px)}" cy="${Y(py)}" r="10" fill="${p.color}" stroke="#fff" stroke-width="2.5"/><text x="${X(px)}" y="${(+Y(py) + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${escapeHtml(p.label)}</text></g>`); });
  const nice = [5, 10, 20, 50, 100, 200, 500, 1000].find((m) => m * sc > 70) || 1000;
  const plan = `<g>${parts.join("")}</g>
    <g transform="translate(${W - 26},30)"><path d="M0,-16 L7,6 L0,1 L-7,6 Z" fill="#1e2d40"/><text y="20" text-anchor="middle" font-size="12" fill="#1e2d40">N</text></g>
    <g transform="translate(14,${H - 14})"><rect width="${(nice * sc).toFixed(1)}" height="4" fill="#1e2d40"/><text y="-6" font-size="11" fill="#1e2d40">${nice} m</text></g>`;
  // Key and close-up under the plan.
  const keyItems = layoutKeyItems(L).map(([sym, txt], i) => `<g transform="translate(${16 + (i % 2) * 300},${22 + Math.floor(i / 2) * 22})">${sym}<text x="30" y="4" font-size="12" fill="#1e2d40">${escapeHtml(txt)}</text></g>`).join("");
  const keyH = 22 * Math.ceil(layoutKeyItems(L).length / 2) + 26, detail = layoutDetail(L), DH = detail ? 170 : 0, NH = 16 * (notes.length + (L.assumed.length ? 1 : 0)) + (notes.length || L.assumed.length ? 10 : 0);
  const txt = [...notes, ...(L.assumed.length ? [`Not entered, so assumed: ${L.assumed.join(", ")}.`] : [])].map((t, i) => `<text x="16" y="${16 + i * 16}" font-size="11.5" fill="#5a6f86">${escapeHtml(t)}</text>`).join("");
  const total = H + keyH + DH + NH + (title ? 30 : 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" width="${W}" height="${total}" role="img" aria-label="Plan of the irrigation equipment" style="max-width:100%;height:auto;background:#fff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <defs><marker id="lyArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${C.machine}"/></marker></defs>
    <rect width="${W}" height="${total}" fill="#fff"/>
    ${title ? `<text x="16" y="22" font-size="16" font-weight="700" fill="#1e2d40">${escapeHtml(title)}</text>` : ""}
    <g transform="translate(0,${title ? 30 : 0})"><rect width="${W}" height="${H}" fill="#f3f5f1"/>${plan}</g>
    <g transform="translate(0,${H + (title ? 30 : 0)})">${keyItems}</g>
    ${detail ? `<g transform="translate(16,${H + keyH + (title ? 30 : 0)})">${detail}</g>` : ""}
    <g transform="translate(0,${H + keyH + DH + (title ? 30 : 0)})">${txt}</g></svg>`;
}

// Legend entries: [svg symbol (about 24×10, centred on y = 0), label].
function layoutKeyItems(L) {
  const C = LAYOUT_COLORS, line = (c, w, dash = "") => `<line x1="0" y1="0" x2="24" y2="0" stroke="${c}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
  const valve = `<rect x="5" y="-7" width="14" height="14" rx="2" fill="${C.valve}" stroke="#fff" stroke-width="1.5"/>`, irr = L.irr, out = [];
  if (L.kind === "drip") {
    out.push([line(C.lateral, 2), `Drip line${irr.lineSpacing ? `s ${irr.lineSpacing} cm apart` : "s"}${irr.emitter ? `, emitters every ${irr.emitter} cm` : ""}`]);
    out.push([line(C.header, 4), "Header pipe (submain)"], [valve, "Block valve"]);
  } else if (L.kind === "micro" || L.kind === "sprinkler") {
    out.push([line(C.lateral, 2), "Lateral pipe"], [`<circle cx="12" cy="0" r="4" fill="#fff" stroke="${C.head}" stroke-width="1.5"/>`, `${L.kind === "micro" ? "Micro-sprinkler" : "Sprinkler"}${irr.spacing ? `, ${irr.spacing} m × ${irr.spacing} m` : ""}`]);
    out.push([line(C.header, 4), "Header pipe (submain)"], [valve, "Block valve"]);
  } else if (L.kind === "pivot") {
    out.push([line(C.machine, 3), "Pivot arm"], [`<circle cx="12" cy="0" r="4" fill="#fff" stroke="${C.machine}" stroke-width="2"/>`, "Tower"], [line(C.furrow, 1.5, "4 3"), "Wheel track"], [`<circle cx="12" cy="0" r="5" fill="${C.machine}"/>`, "Pivot centre"]);
  } else if (L.kind === "linear") {
    out.push([line(C.machine, 3), "Linear machine"], [`<circle cx="12" cy="0" r="4" fill="#fff" stroke="${C.machine}" stroke-width="2"/>`, "Tower"], [`<rect x="0" y="-5" width="24" height="10" fill="${C.wet}" fill-opacity=".25" stroke="${C.machine}" stroke-dasharray="4 3"/>`, "Area it travels over"]);
  } else if (L.kind === "furrow") {
    out.push([line(C.furrow, 1.5), "Furrow direction"], [line(C.furrow, 4), "Head ditch / gated pipe"]);
  }
  if (L.missing) out.push(["", L.missing]);
  return out;
}

// Close-up of a few metres at true scale, with the spacings marked.
function layoutDetail(L) {
  const irr = L.irr, C = LAYOUT_COLORS;
  const dim = (x1, y1, x2, y2, label, vertical = false) => `<g stroke="#5a6f86" stroke-width="1" fill="#5a6f86"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#lyDim)" marker-end="url(#lyDim)"/></g><text x="${vertical ? x1 + 6 : (x1 + x2) / 2}" y="${vertical ? (y1 + y2) / 2 + 4 : y1 - 5}" ${vertical ? "" : 'text-anchor="middle"'} font-size="11" fill="#1e2d40">${label}</text>`;
  const defs = `<defs><marker id="lyDim" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 Z" fill="#5a6f86"/></marker></defs>`;
  if (L.kind === "drip") {
    const e = (irr.emitter || LAYOUT_DEFAULTS.emitter) / 100, s = (irr.lineSpacing || LAYOUT_DEFAULTS.lineSpacing) / 100;
    const s2 = Math.min(55 / s, 360 / Math.max(e * 6, 1.5)), w = Math.min(440, Math.max(160, e * 8 * s2)), lines = [0, 1, 2];
    const g = lines.map((i) => { const y = 34 + i * s * s2; let dots = ""; for (let x = (e * s2) / 2; x < w; x += e * s2) dots += `<circle cx="${(20 + x).toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${C.header}"/>`; return `<line x1="20" y1="${y.toFixed(1)}" x2="${20 + w}" y2="${y.toFixed(1)}" stroke="${C.lateral}" stroke-width="3"/>${dots}`; }).join("");
    const ex = 20 + (e * s2) / 2;
    return `${defs}<text y="0" font-size="12" font-weight="600" fill="#1e2d40">Close-up, true scale</text>${g}
      ${dim(ex, 22, ex + e * s2, 22, `${fmt(e * 100, 0)} cm`)}${dim(w + 34, 34, w + 34, 34 + s * s2, `${fmt(s * 100, 0)} cm`, true)}
      <text x="${w + 90}" y="56" font-size="11.5" fill="#5a6f86">Each dot is an emitter${irr.flow ? ` (${irr.flow} L/h)` : ""}.</text>
      <text x="${w + 90}" y="74" font-size="11.5" fill="#5a6f86">Probes usually go in the row, in the</text><text x="${w + 90}" y="90" font-size="11.5" fill="#5a6f86">wetted zone of an emitter.</text>`;
  }
  if (L.kind === "micro" || L.kind === "sprinkler") {
    const s = irr.spacing || LAYOUT_DEFAULTS[L.kind], s2 = 50 / s;
    let g = ""; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const cx = 40 + i * s * s2, cy = 60 + j * s * s2; g += `<circle cx="${cx}" cy="${cy}" r="${s * s2}" fill="${C.wet}" fill-opacity="0.12" stroke="${C.wet}" stroke-width=".8"/>`; }
    for (let j = 0; j < 2; j++) g += `<line x1="20" y1="${60 + j * s * s2}" x2="${60 + 2 * s * s2}" y2="${60 + j * s * s2}" stroke="${C.lateral}" stroke-width="3"/>`;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g += `<circle cx="${40 + i * s * s2}" cy="${60 + j * s * s2}" r="4" fill="#fff" stroke="${C.head}" stroke-width="2"/>`;
    return `${defs}<text y="0" font-size="12" font-weight="600" fill="#1e2d40">Close-up</text>${g}${dim(40, 30, 40 + s * s2, 30, `${fmt(s, 0)} m`)}${dim(40 + 2 * s * s2 + 34, 60, 40 + 2 * s * s2 + 34, 60 + s * s2, `${fmt(s, 0)} m`, true)}
      <text x="${150 + 2 * s * s2}" y="70" font-size="11.5" fill="#5a6f86">Heads ${fmt(s, 0)} m apart, each one wetting up to its</text><text x="${150 + 2 * s * s2}" y="86" font-size="11.5" fill="#5a6f86">neighbours (head-to-head). A probe goes between</text><text x="${150 + 2 * s * s2}" y="102" font-size="11.5" fill="#5a6f86">heads, away from the pipe and the head itself.</text>`;
  }
  return "";
}
