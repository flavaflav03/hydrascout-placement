"use strict";
// Data sources: elevation (Open-Meteo / Copernicus DEM), soil (SoilGrids),
// NDVI from an uploaded GeoTIFF, and NDVI computed from Sentinel-2 (Earth Search on AWS).

async function fetchElevation(pts, onProgress) {
  const out = [];
  for (let i = 0; i < pts.length; i += 100) {
    const chunk = pts.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((p) => p.lat.toFixed(6)).join(",")}&longitude=${chunk.map((p) => p.lon.toFixed(6)).join(",")}`;
    const r = await fetch(url); if (!r.ok) throw new Error(`elevation service answered ${r.status}`);
    const j = await r.json(); out.push(...j.elevation);
    onProgress && onProgress(Math.min(pts.length, i + 100));
  }
  return out;
}

async function fetchSoil(lat, lon) {
  const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&property=clay&property=sand&property=silt&property=soc&depth=0-5cm&depth=5-15cm&depth=15-30cm&depth=30-60cm&value=mean`;
  const r = await fetch(url); if (!r.ok) throw new Error(`soil service answered ${r.status}`);
  const j = await r.json(); const out = {};
  for (const layer of j.properties.layers) {
    const d = (layer.unit_measure && layer.unit_measure.d_factor) || 1; let s = 0, w = 0;
    for (const dp of layer.depths) { const v = dp.values.mean; if (v == null) continue; const th = dp.range.bottom_depth - dp.range.top_depth; s += (v / d) * th; w += th; }
    out[layer.name] = w ? s / w : null;
  }
  // clay/sand/silt come as g/kg ÷ 10 = %, soc as dg/kg ÷ 10 = g/kg
  return out.clay == null ? null : out;
}

function textureClass(sand, silt, clay) {
  const t = sand + silt + clay; sand *= 100 / t; silt *= 100 / t; clay *= 100 / t;
  if (silt + 1.5 * clay < 15) return "sand";
  if (silt + 2 * clay < 30) return "loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52) || (clay < 7 && silt < 50)) return "sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "loam";
  if (silt >= 80 && clay < 12) return "silt";
  if (silt >= 50 && clay < 27) return "silt loam";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20) return "clay loam";
  if (clay >= 27 && clay < 40) return "silty clay loam";
  if (clay >= 35 && sand > 45) return "sandy clay";
  if (clay >= 40 && silt >= 40) return "silty clay";
  return clay >= 40 ? "clay" : "loam";
}

// ---------- NDVI rasters ----------
// Every NDVI source returns the same shape:
// { w, h, bbox: [xmin, ymin, xmax, ymax] in the raster CRS, data, nodata, def (proj4 def or null for WGS84), label }

async function readNdviFile(file) {
  const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer());
  const img = await tiff.getImage();
  const keys = img.getGeoKeys() || {};
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326;
  const [raw] = await img.readRasters({ samples: [0] });
  const nodata = img.getGDALNoData();
  // Rescale common integer encodings to the -1..1 NDVI range.
  let mx = -Infinity; for (const v of raw) if (v !== nodata && !Number.isNaN(v) && v > mx) mx = v;
  const scale = mx > 255 ? (v) => v / 10000 : mx > 1.5 ? (v) => (v / 255) * 2 - 1 : (v) => v;
  const data = Float32Array.from(raw, (v) => (v === nodata || Number.isNaN(v) ? NaN : scale(v)));
  return { w: img.getWidth(), h: img.getHeight(), bbox: img.getBoundingBox(), data, nodata: null, def: crsDef(epsg), epsg,
    bands: img.getSamplesPerPixel(), label: `file ${file.name}`, source: "file", name: file.name };
}

function sampleRaster(n, lat, lon, radius = 1) {
  const [X, Y] = toCrs(n.def, lat, lon);
  const [x0, y0, x1, y1] = n.bbox;
  const px = Math.floor(((X - x0) / (x1 - x0)) * n.w), py = Math.floor(((y1 - Y) / (y1 - y0)) * n.h);
  let s = 0, c = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= n.w || yy >= n.h) continue;
    const v = n.data[yy * n.w + xx];
    if (v == null || Number.isNaN(v) || (n.nodata != null && v === n.nodata)) continue;
    s += v; c++;
  }
  return c ? s / c : null;
}

// Colour image of an NDVI raster clipped to the field, for display as a map overlay.
function ndviOverlay(n, field) {
  const ring = field.map(([lat, lon]) => toCrs(n.def, lat, lon));
  const [x0, y0, x1, y1] = n.bbox, rx = (x1 - x0) / n.w, ry = (y1 - y0) / n.h;
  const inside = []; for (let j = 0; j < n.h; j++) for (let i = 0; i < n.w; i++) { const v = n.data[j * n.w + i]; if (!Number.isNaN(v) && inPoly(x0 + (i + 0.5) * rx, y1 - (j + 0.5) * ry, ring)) inside.push(j * n.w + i); }
  if (!inside.length) return null;
  const vals = inside.map((k) => n.data[k]).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1], span = hi - lo || 0.01;
  const cv = document.createElement("canvas"); cv.width = n.w; cv.height = n.h;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(n.w, n.h);
  for (const k of inside) { const c = ndviRamp((n.data[k] - lo) / span, true); im.data.set([c[0], c[1], c[2], 235], k * 4); }
  ctx.putImageData(im, 0, 0);
  const corners = [[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map(([x, y]) => fromCrs(n.def, x, y));
  const lats = corners.map((c) => c[0]), lons = corners.map((c) => c[1]);
  return { url: cv.toDataURL(), bounds: [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], lo, hi, mean: mean(vals) };
}

// ---------- Sentinel-2 via Earth Search (public STAC + cloud-optimised GeoTIFFs, no account needed) ----------
const Sentinel = {
  STAC: "https://earth-search.aws.element84.com/v1/search",
  CLEAR: new Set([4, 5, 7]), // SCL: vegetation, bare soil, unclassified
  VEG: 4,

  async search(field, months = 14) {
    const lats = field.map((p) => p[0]), lons = field.map((p) => p[1]);
    const bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    const end = new Date(), start = new Date(end); start.setMonth(start.getMonth() - months);
    const datetime = `${start.toISOString()}/${end.toISOString()}`;
    let feats;
    try {
      const r = await fetch(this.STAC, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collections: ["sentinel-2-l2a"], bbox, datetime, limit: 200, query: { "eo:cloud_cover": { lt: 50 } } }) });
      if (!r.ok) throw new Error(`STAC ${r.status}`);
      feats = (await r.json()).features;
    } catch (err) {
      const r = await fetch(`${this.STAC}?collections=sentinel-2-l2a&bbox=${bbox.join(",")}&datetime=${encodeURIComponent(datetime)}&limit=200`);
      if (!r.ok) throw new Error(`satellite catalogue answered ${r.status}`);
      feats = (await r.json()).features.filter((f) => f.properties["eo:cloud_cover"] < 50);
    }
    // One scene per day (neighbouring tiles overlap): keep the least cloudy one.
    const byDay = new Map();
    for (const f of feats) {
      const p = f.properties, a = f.assets; if (!a.red || !a.nir || !a.scl) continue;
      const code = p["proj:epsg"] || (p["proj:code"] && +String(p["proj:code"]).split(":")[1]);
      const band = (a.red["raster:bands"] || [])[0] || {};
      const baseline = parseFloat(p["s2:processing_baseline"] || "0");
      const scene = { id: f.id, date: p.datetime.slice(0, 10), cloud: p["eo:cloud_cover"], epsg: code,
        red: a.red.href, nir: a.nir.href, scl: a.scl.href,
        scale: band.scale != null ? band.scale : 0.0001, offset: band.offset != null ? band.offset : baseline >= 4 ? -0.1 : 0 };
      const prev = byDay.get(scene.date); if (!prev || scene.cloud < prev.cloud) byDay.set(scene.date, scene);
    }
    return [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async readWindow(href, ring, margin) {
    const tiff = await GeoTIFF.fromUrl(href, { allowFullFile: false });
    const img = await tiff.getImage();
    const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(), W = img.getWidth(), H = img.getHeight();
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - margin - ox) / rx)), c1 = Math.min(W, Math.ceil((Math.max(...xs) + margin - ox) / rx));
    const r0 = Math.max(0, Math.floor((oy - (Math.max(...ys) + margin)) / -ry)), r1 = Math.min(H, Math.ceil((oy - (Math.min(...ys) - margin)) / -ry));
    if (c1 <= c0 || r1 <= r0) return null;
    const [data] = await img.readRasters({ window: [c0, r0, c1, r1], samples: [0] });
    return { data, w: c1 - c0, h: r1 - r0, bbox: [ox + c0 * rx, oy + r1 * ry, ox + c1 * rx, oy + r0 * ry] };
  },

  // Share of the field that is clear (no cloud, shadow, snow or missing data), and share that is green vegetation.
  async checkScene(scene, field) {
    const def = crsDef(scene.epsg), ring = field.map(([lat, lon]) => toCrs(def, lat, lon));
    const win = await this.readWindow(scene.scl, ring, 20); if (!win) return { clear: 0, veg: 0 };
    const [x0, , , y1] = win.bbox, res = (win.bbox[2] - x0) / win.w;
    let n = 0, clear = 0, veg = 0, all = 0, allClear = 0;
    for (let j = 0; j < win.h; j++) for (let i = 0; i < win.w; i++) {
      const v = win.data[j * win.w + i], ok = this.CLEAR.has(v);
      all++; if (ok) allClear++;
      if (!inPoly(x0 + (i + 0.5) * res, y1 - (j + 0.5) * res, ring)) continue;
      n++; if (ok) clear++; if (v === this.VEG) veg++;
    }
    scene.sclWin = win; scene.def = def;
    return n ? { clear: clear / n, veg: veg / n } : { clear: allClear / Math.max(1, all), veg: 0 };
  },

  async ndvi(scene, field) {
    const def = scene.def || crsDef(scene.epsg), ring = field.map(([lat, lon]) => toCrs(def, lat, lon));
    const [red, nir] = await Promise.all([this.readWindow(scene.red, ring, 30), this.readWindow(scene.nir, ring, 30)]);
    if (!red || !nir) throw new Error("This image does not cover the field.");
    const scl = scene.sclWin, data = new Float32Array(red.w * red.h);
    const [x0, , , y1] = red.bbox, res = (red.bbox[2] - x0) / red.w;
    for (let j = 0; j < red.h; j++) for (let i = 0; i < red.w; i++) {
      const k = j * red.w + i, dr = red.data[k], dn = nir.data[k];
      let bad = !dr || !dn;
      if (!bad && scl) { // mask cloudy pixels using the 20 m scene classification
        const si = Math.floor((x0 + (i + 0.5) * res - scl.bbox[0]) / ((scl.bbox[2] - scl.bbox[0]) / scl.w));
        const sj = Math.floor((scl.bbox[3] - (y1 - (j + 0.5) * res)) / ((scl.bbox[3] - scl.bbox[1]) / scl.h));
        if (si >= 0 && sj >= 0 && si < scl.w && sj < scl.h && !this.CLEAR.has(scl.data[sj * scl.w + si])) bad = true;
      }
      const r = dr * scene.scale + scene.offset, n = dn * scene.scale + scene.offset;
      data[k] = bad || n + r <= 0 ? NaN : (n - r) / (n + r);
    }
    return { w: red.w, h: red.h, bbox: red.bbox, data, nodata: null, def, epsg: scene.epsg,
      label: `Sentinel-2 image of ${scene.date}`, source: "sentinel", date: scene.date, cloud: scene.cloud };
  },
};
