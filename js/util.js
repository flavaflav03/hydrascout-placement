"use strict";
// Shared helpers: DOM, storage, maths, geometry and colour ramps.

const $ = (id) => document.getElementById(id);
const ZONE_COLORS = ["#2f7fbf", "#e0a02a", "#4f9e52", "#c4554d", "#8a6bbf", "#2fa39b", "#a8733a", "#d06fa8", "#6d8a1f", "#4a5fc1", "#c98a8a", "#3d3d3d"];
const zoneColor = (z) => (z < 0 ? "#9aa59d" : ZONE_COLORS[z % ZONE_COLORS.length]); // -1: outside every irrigation block
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function mean(a) { let s = 0, n = 0; for (const v of a) if (v != null && !Number.isNaN(v)) { s += v; n++; } return n ? s / n : null; }
function std(a) { const m = mean(a); if (m == null) return 0; let s = 0, n = 0; for (const v of a) if (v != null && !Number.isNaN(v)) { s += (v - m) ** 2; n++; } return Math.sqrt(s / Math.max(1, n)); }
function minMax(a) { let lo = Infinity, hi = -Infinity; for (const v of a) if (v != null && !Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; }

// Local metric projection around a reference point (accurate enough at field scale).
function makeProj(lat0, lon0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return { fwd: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky], inv: (x, y) => [lat0 + y / ky, lon0 + x / kx] };
}
function centroidLatLng(ll) { return [mean(ll.map((p) => p[0])), mean(ll.map((p) => p[1]))]; }
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
function edgeDist(x, y, p) {
  let m = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [x1, y1] = p[j], [x2, y2] = p[i], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    m = Math.min(m, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return m;
}
function fieldAreaHa(field) { const c = centroidLatLng(field), P = makeProj(c[0], c[1]); return polyArea(field.map(([a, b]) => P.fwd(a, b))) / 10000; }

// Projection definitions for rasters (NDVI files and Sentinel-2 tiles).
function crsDef(epsg) {
  if (epsg === 4326) return null;
  if (epsg === 3857 || epsg === 900913) return "EPSG:3857";
  if (epsg === 2154) return "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  throw new Error(`Unsupported projection EPSG:${epsg}`);
}
const toCrs = (def, lat, lon) => (def ? proj4("EPSG:4326", def, [lon, lat]) : [lon, lat]);
const fromCrs = (def, x, y) => { const [lon, lat] = def ? proj4(def, "EPSG:4326", [x, y]) : [x, y]; return [lat, lon]; };

// Blue → teal → yellow → brown ramp; t in [0,1].
function ramp(t) {
  const stops = [[0, [43, 92, 158]], [0.35, [77, 163, 137]], [0.65, [222, 205, 92]], [1, [156, 84, 40]]];
  return rampRgb(stops, t);
}
// Brown → yellow → green ramp for NDVI.
const NDVI_STOPS = [[0, [150, 90, 50]], [0.4, [225, 200, 90]], [0.7, [110, 175, 80]], [1, [25, 105, 45]]];
const ndviRamp = (t, asArray = false) => rampRgb(NDVI_STOPS, t, asArray);
function rampRgb(stops, t, asArray = false) {
  t = Math.max(0, Math.min(1, t)); let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[i + 1], f = (t - t0) / (t1 - t0 || 1);
  const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
  return asArray ? c : `rgb(${c.join(",")})`;
}
