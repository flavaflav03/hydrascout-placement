"use strict";
// Placement analysis: sampling grid, terrain derivatives, zoning (k-means) and spot selection.

function buildGrid(field) {
  const c = centroidLatLng(field), P = makeProj(c[0], c[1]);
  const poly = field.map(([a, b]) => P.fwd(a, b)), area = polyArea(poly);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const bx = [Math.min(...xs), Math.max(...xs)], by = [Math.min(...ys), Math.max(...ys)];
  let spacing = Math.max(8, Math.min(150, Math.sqrt(area / 220))), pts = [];
  for (let tries = 0; tries < 4; tries++) {
    pts = [];
    for (let y = by[0] + spacing / 2; y < by[1]; y += spacing) for (let x = bx[0] + spacing / 2; x < bx[1]; x += spacing) {
      if (!inPoly(x, y, poly)) continue;
      const [lat, lon] = P.inv(x, y); pts.push({ x, y, lat, lon, edge: edgeDist(x, y, poly) });
    }
    if (pts.length >= 40 || spacing <= 4) break;
    spacing /= 1.6;
  }
  return { P, poly, area, spacing, pts };
}

function neighbours(pts, r) { return pts.map((p) => pts.map((q, j) => [j, Math.hypot(p.x - q.x, p.y - q.y)]).filter(([, d]) => d <= r)); }

function solve3(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let mx = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[mx][i])) mx = k;
    [m[i], m[mx]] = [m[mx], m[i]]; if (Math.abs(m[i][i]) < 1e-9) return null;
    for (let k = 0; k < 3; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// Smoothed elevation, slope (%) from a local plane fit, and relative position (negative = hollow, positive = rise).
function terrain(G, elev) {
  const pts = G.pts, sp = G.spacing;
  const sig = Math.max(sp, 45), nS = neighbours(pts, 2 * sig);
  const es = pts.map((p, i) => { let s = 0, w = 0; for (const [j, d] of nS[i]) { if (elev[j] == null) continue; const k = Math.exp(-(d * d) / (2 * sig * sig)); s += k * elev[j]; w += k; } return w ? s / w : elev[i]; });
  const R = Math.max(2 * sp, 90), nR = neighbours(pts, R);
  const slope = pts.map((p, i) => {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const [j] of nR[i]) { const v = [pts[j].x - p.x, pts[j].y - p.y, 1]; for (let r = 0; r < 3; r++) { b[r] += v[r] * es[j]; for (let c = 0; c < 3; c++) A[r][c] += v[r] * v[c]; } }
    const s = nR[i].length >= 4 ? solve3(A, b) : null; return s ? 100 * Math.hypot(s[0], s[1]) : 0;
  });
  const nT = neighbours(pts, Math.max(3 * sp, 150));
  const tpi = pts.map((p, i) => es[i] - mean(nT[i].map(([j]) => es[j])));
  return { elev: es, slope, tpi };
}

function kmeans(X, k, seed) {
  const rng = mulberry32(seed), n = X.length, dim = X[0].length;
  const d2 = (a, b) => { let s = 0; for (let i = 0; i < dim; i++) s += (a[i] - b[i]) ** 2; return s; };
  const C = [X[Math.floor(rng() * n)].slice()];
  while (C.length < k) {
    const D = X.map((x) => Math.min(...C.map((c) => d2(x, c)))), tot = D.reduce((a, b) => a + b, 0);
    let r = rng() * tot, i = 0; while (i < n - 1 && (r -= D[i]) > 0) i++; C.push(X[i].slice());
  }
  const lab = new Array(n).fill(0);
  for (let it = 0; it < 50; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) { let best = 0, bd = Infinity; for (let c = 0; c < k; c++) { const d = d2(X[i], C[c]); if (d < bd) { bd = d; best = c; } } if (lab[i] !== best) { lab[i] = best; moved = true; } }
    for (let c = 0; c < k; c++) { const m = X.filter((_, i) => lab[i] === c); if (m.length) for (let j = 0; j < dim; j++) C[c][j] = mean(m.map((v) => v[j])); }
    if (!moved) break;
  }
  const inertia = X.reduce((s, x, i) => s + d2(x, C[lab[i]]), 0);
  return { lab, C, inertia };
}

function autoCount(ha) { return ha < 3 ? 1 : ha < 8 ? 2 : ha < 20 ? 3 : ha < 40 ? 4 : ha < 80 ? 5 : 6; }

const IRRIGATION_LABELS = {
  none: "Not irrigated", drip: "Drip", micro: "Micro-sprinkler", sprinkler: "Sprinkler / reel gun", pivot: "Centre pivot", linear: "Linear move", furrow: "Furrow / flood",
};

// Pivot geometry for each grid point: distance to centre, whether it is under the pivot, and whether it is a poor spot
// (pivot centre, end of the span, or a tower wheel track).
// Pivot position of a point (local metres): distance to the centre, under the pivot or not, and spots to avoid.
function pivotAt(G, irr) {
  const pv = irr && irr.type === "pivot" && irr.pivot; if (!pv || !pv.radius) return null;
  const [cx, cy] = G.P.fwd(pv.lat, pv.lon), R = pv.radius, span = pv.span || 0;
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy), under = d <= R;
    let avoid = null;
    if (under && d < 0.15 * R) avoid = "centre";
    else if (under && R - d < 15) avoid = "end";
    else if (under && span > 0) { const k = Math.round(d / span); if (k >= 1 && Math.abs(d - k * span) < 5) avoid = "track"; }
    return { d, under, avoid, spanNo: span > 0 ? Math.floor(d / span) + 1 : null };
  };
}
function pivotInfo(G, irr) { const at = pivotAt(G, irr); return at && G.pts.map((p) => at(p.x, p.y)); }

// inputs: { G, elev, soilSamples, ndvi, irrigation, request ("auto" or number), buffer }
function computePlacement(inp) {
  const { G } = inp, pts = G.pts, ha = G.area / 10000, notes = [];
  const T = terrain(G, inp.elev);

  let soil = null;
  if (inp.soilSamples && inp.soilSamples.length) {
    soil = {};
    for (const key of ["clay", "sand", "silt", "soc"]) soil[key] = pts.map((p) => { let s = 0, w = 0; for (const sm of inp.soilSamples) { if (sm.v[key] == null) continue; const d = Math.hypot(p.x - sm.p.x, p.y - sm.p.y); const k = 1 / Math.max(1, d) ** 2; s += k * sm.v[key]; w += k; } return w ? s / w : null; });
  } else notes.push("Soil data (SoilGrids) could not be loaded, so zones were built without soil. Try again in a minute: the service limits how often it can be called.");

  let ndvi = null;
  if (inp.ndvi) {
    const raw = pts.map((p) => sampleRaster(inp.ndvi, p.lat, p.lon)), cov = raw.filter((v) => v != null).length / pts.length;
    if (cov < 0.5) notes.push(`The NDVI image covers only ${(cov * 100).toFixed(0)}% of the field, so it was not used. Check that it covers this field.`);
    else { const m = mean(raw); ndvi = raw.map((v) => (v == null ? m : v)); }
  }

  const piv = pivotInfo(G, inp.irrigation);
  const irrShare = piv ? piv.filter((q) => q.under).length / pts.length : null;
  if (piv && irrShare === 0) notes.push("The pivot circle does not overlap the field. Check the pivot centre and radius.");

  // Feature matrix. Each variable is standardised, with a floor on its spread so that tiny
  // differences on a uniform field do not create artificial zones.
  const layers = { x: pts.map((p) => p.x), y: pts.map((p) => p.y), elev: T.elev, slope: T.slope, tpi: T.tpi };
  const spec = [["elev", 1.0, 0.6], ["slope", 0.6, 0.6], ["tpi", 0.8, 0.3], ["x", 0.55, 0], ["y", 0.55, 0]];
  if (soil) { layers.clay = soil.clay; layers.sand = soil.sand; spec.push(["clay", 1.0, 3], ["sand", 0.6, 4]); }
  if (ndvi) { layers.ndvi = ndvi; spec.push(["ndvi", 1.6, 0.04]); }
  if (piv && irrShare > 0.05 && irrShare < 0.95) { layers.irr = piv.map((q) => (q.under ? 1 : 0)); spec.push(["irr", 2.5, 0]); }
  const X = pts.map((_, i) => spec.map(([key, w, floor]) => { const a = layers[key], m = mean(a), s = Math.max(std(a), floor, 1e-6); return ((a[i] - m) / s) * w; }));

  const k = Math.min(pts.length, inp.request === "auto" ? autoCount(ha) : +inp.request);
  let best = null; for (let s = 1; s <= 12; s++) { const r = kmeans(X, k, s * 7919); if (!best || r.inertia < best.inertia) best = r; }
  // Majority filter for tidier, more contiguous zones.
  const nb = neighbours(pts, G.spacing * 1.5);
  let lab = best.lab.map((l, i) => { const cnt = {}; for (const [j] of nb[i]) cnt[best.lab[j]] = (cnt[best.lab[j]] || 0) + 1; const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; return top && top[1] > nb[i].length / 2 ? +top[0] : l; });

  // Order zones by size, then pick the most representative interior point of each one.
  const buffer = inp.buffer;
  const zones = [...new Set(lab)].map((z) => ({ z, idx: lab.map((l, i) => (l === z ? i : -1)).filter((i) => i >= 0) })).sort((a, b) => b.idx.length - a.idx.length);
  const remap = new Map(zones.map((zo, i) => [zo.z, i])); lab = lab.map((l) => remap.get(l));
  const featDims = spec.map(([key], d) => (key === "x" || key === "y" ? -1 : d)).filter((d) => d >= 0);
  const sensors = zones.map((zo, zi) => {
    const centre = spec.map((_, d) => mean(zo.idx.map((i) => X[i][d])));
    const core = (i) => nb[i].filter(([j]) => lab[j] === zi).length / nb[i].length;
    const okPivot = (i) => !piv || !piv[i].avoid;
    const tiers = [
      (i) => pts[i].edge >= buffer && core(i) >= 0.75 && okPivot(i),
      (i) => pts[i].edge >= buffer && okPivot(i),
      (i) => pts[i].edge >= buffer,
    ];
    let cand = [], tier = 0;
    for (; tier < tiers.length && !cand.length; tier++) cand = zo.idx.filter(tiers[tier]);
    if (!cand.length) { const me = Math.max(...zo.idx.map((i) => pts[i].edge)); cand = zo.idx.filter((i) => pts[i].edge >= me - 1e-6); tier = 4; }
    const score = (i) => Math.sqrt(featDims.reduce((s, d) => s + (X[i][d] - centre[d]) ** 2, 0)) + 0.5 * (1 - core(i));
    const pick = cand.reduce((b, i) => (score(i) < score(b) ? i : b), cand[0]);
    return { zone: zi, i: pick, share: zo.idx.length / pts.length, idx: zo.idx, tier };
  });

  const R = { G, pts, lab, T, soil, ndvi, ndviInfo: ndvi ? inp.ndvi : null, piv, irrigation: inp.irrigation, sensors, ha, notes, buffer, k };
  describe(R);
  return R;
}

function irrigationTip(irr) {
  if (!irr || irr.type === "none") return null;
  if (irr.type === "drip") {
    const e = irr.emitter, l = irr.lineSpacing;
    let t = e && e <= 40 ? `Emitters every ${e} cm form a continuous wet strip: install on the drip line, in the row.`
      : `Install along the drip line about 10–15 cm from an emitter${e ? ` (emitters every ${e} cm)` : ""}, inside the wetted bulb but not directly under the dripper.`;
    if (l) t += ` Lines are ${l} cm apart: stay on a line, not between two lines.`;
    return t;
  }
  if (irr.type === "micro" || irr.type === "sprinkler") {
    const s = irr.spacing;
    return s ? `Sprinklers are ${s} m apart: install about ${Math.max(1, Math.round(s / 4))} m from the nearest head, inside its pattern, away from risers and the outer edge of the throw.`
      : "Install inside a sprinkler pattern, away from risers and the outer edge of the throw.";
  }
  if (irr.type === "pivot") return "Keep the sensor and its cable clear of the tower wheel tracks, and note the span number for the irrigation team.";
  if (irr.type === "linear") return "Keep clear of the tower wheel tracks and the cart lane, and note which span the sensor is under.";
  if (irr.type === "furrow") return "Install in the bed (not the furrow), around the middle of the run.";
  return null;
}

function describe(R) {
  const all = R.pts.map((_, i) => i);
  const stat = (arr, idx) => mean(idx.map((i) => arr[i]));
  const E = R.T.elev, [eMin, eMax] = minMax(E), eRange = eMax - eMin;
  const fSlope = stat(R.T.slope, all), fClay = R.soil ? stat(R.soil.clay, all) : null, fNdvi = R.ndvi ? stat(R.ndvi, all) : null;
  const flat = eRange < 1.5 && fSlope < 1;
  R.summary = { eMin, eMax, fSlope, fClay, fNdvi, flat };
  const tip = irrigationTip(R.irrigation);
  for (const s of R.sensors) {
    const p = R.pts[s.i], why = [];
    const zE = stat(E, s.idx), zS = stat(R.T.slope, s.idx), zT = stat(R.T.tpi, s.idx);
    if (!flat) {
      const rel = eRange > 0 ? (zE - eMin) / eRange : 0.5;
      why.push(`${rel > 0.66 ? "Higher" : rel < 0.33 ? "Lower" : "Middle"} part of the field (around ${fmt(zE, 0)} m), slope ${fmt(zS, 1)}%.`);
      if (zT < -0.25) why.push("Slight hollow: water tends to collect here, so soil stays wetter for longer.");
      else if (zT > 0.25) why.push("Slight rise: this area drains and dries out faster.");
    } else why.push(`Flat terrain (slope ${fmt(zS, 1)}%), so terrain plays little role here.`);
    if (R.soil) {
      const cl = R.soil.clay[s.i], sa = R.soil.sand[s.i], si = R.soil.silt[s.i];
      const diff = cl - R.summary.fClay;
      why.push(`Soil: ${textureClass(sa, si, cl)} (about ${fmt(cl, 0)}% clay, ${fmt(sa, 0)}% sand)${Math.abs(diff) >= 2 ? `, ${diff > 0 ? "heavier" : "lighter"} than the field average` : ""}.`);
    }
    if (R.ndvi) {
      const zN = stat(R.ndvi, s.idx), d = zN - R.summary.fNdvi;
      why.push(`Vegetation (NDVI ${fmt(zN, 2)}) ${Math.abs(d) < 0.03 ? "close to the field average" : d > 0 ? "stronger than the field average" : "weaker than the field average"}.`);
    }
    if (R.piv) {
      const q = R.piv[s.i];
      if (q.under) why.push(`Under the pivot, ${fmt(q.d, 0)} m from the centre${q.spanNo ? ` (span ${q.spanNo})` : ""}${q.avoid ? "" : ", away from the centre, the end of the pivot and the wheel tracks"}.`);
      else why.push("Outside the pivot circle (not irrigated): useful to compare with the irrigated part.");
    }
    why.push(`Represents zone ${s.zone + 1}, about ${fmt(s.share * 100, 0)}% of the field (${fmt(s.share * R.ha, 1)} ha). This is the point that best matches the zone's typical conditions${s.tier <= 2 ? `, at least ${R.buffer} m from the edge` : ""}.`);
    s.lat = p.lat; s.lon = p.lon; s.why = why; s.tip = R.piv && !R.piv[s.i].under ? null : tip; s.edge = p.edge; s.name = `HS-${R.sensors.indexOf(s) + 1}`;
  }
  if (R.summary.flat && R.sensors.length > 1 && !R.soil && !R.ndvi) R.notes.push("This field looks uniform with the available data, so the spots are mainly spread out to cover it. Adding NDVI usually reveals more useful differences.");
  R.notes.push("Elevation comes from a 90 m model and soil from 250 m estimates. They show broad patterns, not plot-level detail. NDVI (10 m) sharpens the result.");
  R.notes.push("On site: install in the crop row away from wheel tracks, headlands, trees and drains, and note the exact position once installed.");
}

// A spot moved by hand: describe the point where it now is (nearest grid cell) and warn where it departs
// from the recommendation. The recommended spot is kept so it can be restored.
const AVOID_TEXT = { centre: "close to the pivot centre", end: "near the end of the pivot", track: "on or next to a tower wheel track" };
function moveSensor(R, s, lat, lon) {
  if (!s.orig) s.orig = { i: s.i, lat: s.lat, lon: s.lon, why: s.why, tip: s.tip, edge: s.edge };
  const P = R.G.P, [x, y] = P.fwd(lat, lon), [ox, oy] = P.fwd(s.orig.lat, s.orig.lon);
  const j = R.pts.reduce((b, p, k) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(R.pts[b].x - x, R.pts[b].y - y) ? k : b), 0);
  const sm = R.summary, E = R.T.elev, eRange = sm.eMax - sm.eMin, edge = edgeDist(x, y, R.G.poly);
  const why = [`Moved by hand, ${fmt(Math.hypot(x - ox, y - oy), 0)} m from the recommended spot.`];
  if (!sm.flat) {
    const rel = eRange > 0 ? (E[j] - sm.eMin) / eRange : 0.5;
    why.push(`${rel > 0.66 ? "Higher" : rel < 0.33 ? "Lower" : "Middle"} part of the field (around ${fmt(E[j], 0)} m), slope ${fmt(R.T.slope[j], 1)}%.`);
    if (R.T.tpi[j] < -0.25) why.push("Slight hollow: water tends to collect here, so soil stays wetter for longer.");
    else if (R.T.tpi[j] > 0.25) why.push("Slight rise: this area drains and dries out faster.");
  } else why.push(`Flat terrain (slope ${fmt(R.T.slope[j], 1)}%).`);
  if (R.soil) {
    const cl = R.soil.clay[j], diff = cl - sm.fClay;
    why.push(`Soil: ${textureClass(R.soil.sand[j], R.soil.silt[j], cl)} (about ${fmt(cl, 0)}% clay, ${fmt(R.soil.sand[j], 0)}% sand)${Math.abs(diff) >= 2 ? `, ${diff > 0 ? "heavier" : "lighter"} than the field average` : ""}.`);
  }
  if (R.ndvi) { const n = R.ndvi[j], d = n - sm.fNdvi; why.push(`Vegetation (NDVI ${fmt(n, 2)}) ${Math.abs(d) < 0.03 ? "close to the field average" : d > 0 ? "stronger than the field average" : "weaker than the field average"}.`); }
  const q = R.piv ? pivotAt(R.G, R.irrigation)(x, y) : null;
  if (q) {
    if (!q.under) why.push("Outside the pivot circle (not irrigated).");
    else if (q.avoid) why.push(`Warning: ${AVOID_TEXT[q.avoid]} (${fmt(q.d, 0)} m from the centre). Readings or the cable may suffer here.`);
    else why.push(`Under the pivot, ${fmt(q.d, 0)} m from the centre${q.spanNo ? ` (span ${q.spanNo})` : ""}.`);
  }
  why.push(R.lab[j] === s.zone ? `Still in zone ${s.zone + 1}, which it represents (about ${fmt(s.share * 100, 0)}% of the field).`
    : `Warning: this point is in zone ${R.lab[j] + 1}, so it no longer represents zone ${s.zone + 1} (about ${fmt(s.share * 100, 0)}% of the field).`);
  if (edge < R.buffer) why.push(`Warning: only ${fmt(edge, 0)} m from the field edge (${R.buffer} m recommended).`);
  Object.assign(s, { i: j, lat, lon, x, y, edge, why, moved: true, tip: q && !q.under ? null : irrigationTip(R.irrigation) });
}
function resetSensor(s) {
  if (!s.orig) return;
  Object.assign(s, s.orig, { moved: false });
  delete s.orig; delete s.x; delete s.y;
}
