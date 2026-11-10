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
