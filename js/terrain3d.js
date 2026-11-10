"use strict";
// Lidar relief: a hillshade layer for the map, and a 3D view of the field built from a lidar terrain model.
// Elevation for the 3D view comes, best first, from IGN LiDAR HD (France, 1 m), IGN RGE ALTI (France, 1–5 m) or the
// open AWS terrain tiles (worldwide, about 30 m in Europe). three.js is loaded only when the 3D view is first opened.

const IGN_WMS = "https://data.geopf.fr/wms-r";
// Hillshade layers, tried in order: the first one IGN serves is kept.
const IGN_SHADE = ["IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW", "ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW"];
// Raw elevation (32-bit float BIL), tried in order.
const IGN_DEM = [
  { layer: "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", label: "IGN LiDAR HD terrain model", res: 1 },
  { layer: "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", label: "IGN RGE ALTI terrain model", res: 1 },
];
const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
const ESRI_IMG = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

// ---------- map layer ----------
// Esri's world hillshade underneath (everywhere), IGN's lidar hillshade on top (France). The pane multiplies the
// shading into the satellite image, so the relief shows without hiding the field.
function makeReliefLayer(map) {
  const pane = map.createPane("relief"); pane.style.zIndex = 320; pane.style.mixBlendMode = "multiply"; pane.style.pointerEvents = "none";
  const world = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    { pane, maxZoom: 19, maxNativeZoom: 16, opacity: 0.55, attribution: "Hillshade © Esri" });
  const ign = L.tileLayer.wms(IGN_WMS, { pane, layers: IGN_SHADE[0], styles: "", format: "image/png", transparent: true, version: "1.3.0",
    maxZoom: 19, opacity: 0.85, attribution: "Relief © IGN LiDAR HD / RGE ALTI" });
  // A layer name IGN does not serve answers with an error: switch to the next one, and drop IGN after the last.
  let which = 0, errors = 0, loaded = 0;
  ign.on("tileload", () => { loaded++; });
  ign.on("tileerror", () => {
    if (loaded || ++errors < 3) return;
    errors = 0;
    if (++which < IGN_SHADE.length) ign.setParams({ layers: IGN_SHADE[which] });
    else group.removeLayer(ign);
  });
  const group = L.layerGroup([world, ign]);
  return group;
}

// ---------- elevation ----------
// Elevation grid over a lat/lon box: { w, h, data (row 0 = north), source, res (m) }.
async function fetchDem(box, w, h, resM) {
  for (const d of IGN_DEM) {
    try {
      const g = await fetchIgnDem(d.layer, box, w, h);
      if (g) return { w, h, data: g, source: d.label, res: Math.max(d.res, resM) };
    } catch (err) { console.warn(`3D: ${d.layer} failed`, err); }
  }
  return { w, h, data: await fetchTerrarium(box, w, h), source: "AWS terrain tiles (SRTM / EU-DEM)", res: Math.max(30, resM) };
}

async function fetchIgnDem(layer, [s, wst, n, e], w, h) {
  const url = `${IGN_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}&STYLES=&CRS=EPSG:4326`
    + `&BBOX=${s},${wst},${n},${e}&WIDTH=${w}&HEIGHT=${h}&FORMAT=${encodeURIComponent("image/x-bil;bits=32")}`;
  const r = await fetch(url);
  if (!r.ok || /xml|html|text/.test(r.headers.get("content-type") || "")) return null;
  const buf = await r.arrayBuffer();
  if (buf.byteLength !== w * h * 4) return null;
  const dv = new DataView(buf), out = new Float32Array(w * h);
  let ok = 0;
  for (let k = 0; k < w * h; k++) { const v = dv.getFloat32(k * 4, true); out[k] = v > -1000 && v < 9000 ? v : NaN; if (out[k] === out[k]) ok++; }
  // Mostly empty: the field is outside the coverage (abroad, or a gap in the lidar survey).
  return ok > 0.9 * w * h ? fillGaps(out, w, h) : null;
}

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error(`image ${url}`)); im.src = url; });
}

// Mapzen/AWS "terrarium" tiles: height = R·256 + G + B/256 − 32768 (zoom 15 at most).
async function fetchTerrarium([s, wst, n, e], w, h) {
  const z = 15, x0 = Math.floor(lon2x(wst, z)), x1 = Math.floor(lon2x(e, z)), y0 = Math.floor(lat2y(n, z)), y1 = Math.floor(lat2y(s, z));
  const tiles = new Map();
  await Promise.all([...Array(x1 - x0 + 1)].flatMap((_, i) => [...Array(y1 - y0 + 1)].map(async (_, j) => {
    const im = await loadImage(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x0 + i}/${y0 + j}.png`);
    const cv = document.createElement("canvas"); cv.width = cv.height = 256; const ctx = cv.getContext("2d"); ctx.drawImage(im, 0, 0);
    tiles.set(`${x0 + i}/${y0 + j}`, ctx.getImageData(0, 0, 256, 256).data);
  })));
  const px = (X, Y) => {
    const t = tiles.get(`${Math.floor(X / 256)}/${Math.floor(Y / 256)}`); if (!t) return NaN;
    const k = ((Y % 256) * 256 + (X % 256)) * 4; return t[k] * 256 + t[k + 1] + t[k + 2] / 256 - 32768;
  };
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const lat = n - ((n - s) * j) / (h - 1), lon = wst + ((e - wst) * i) / (w - 1);
    const X = lon2x(lon, z) * 256 - 0.5, Y = lat2y(lat, z) * 256 - 0.5, xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
    out[j * w + i] = (px(xi, yi) * (1 - fx) + px(xi + 1, yi) * fx) * (1 - fy) + (px(xi, yi + 1) * (1 - fx) + px(xi + 1, yi + 1) * fx) * fy;
  }
  return fillGaps(out, w, h);
}

// Small holes (water, missing pixels) take the mean of their neighbours, repeated until none are left.
function fillGaps(a, w, h) {
  for (let pass = 0; pass < 50; pass++) {
    let left = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (a[k] === a[k]) continue;
      let s = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue; const v = a[jj * w + ii]; if (v === v) { s += v; c++; } }
      if (c) a[k] = s / c; else left++;
    }
    if (!left) return a;
  }
  for (let k = 0; k < a.length; k++) if (a[k] !== a[k]) a[k] = 0;
  return a;
}

// Terrain around a set of [lat, lon] points (the blocks or the field), cached so the analysis, the 3D view and the
// report share one download: { box, P, W, H, dem }.
const DEM_CACHE = new Map();
function demForPoints(pts) {
  const box = View3D.box(pts), key = box.map((v) => v.toFixed(6)).join(",");
  if (!DEM_CACHE.has(key)) DEM_CACHE.set(key, (async () => {
    const P = makeProj((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    const [wm] = P.fwd(box[0], box[3]), [, hm] = P.fwd(box[2], box[1]);
    const W = 2 * Math.abs(wm), H = 2 * Math.abs(hm);
    // About 1 m per cell for small fields, at most 320 cells a side.
    const res = Math.max(1, Math.max(W, H) / 320), gw = Math.max(16, Math.round(W / res) + 1), gh = Math.max(16, Math.round(H / res) + 1);
    return { box, P, W, H, dem: await fetchDem(box, gw, gh, res) };
  })().catch((err) => { DEM_CACHE.delete(key); throw err; }));
  return DEM_CACHE.get(key);
}

// Ground height at a point: mean of the cells within about 2 m, so a single noisy cell does not count.
function demSample(T, lat, lon) {
  const { box: [s, w, n, e], dem } = T, fi = ((lon - w) / (e - w)) * (dem.w - 1), fj = ((n - lat) / (n - s)) * (dem.h - 1);
  const r = Math.max(0, Math.round(2 / dem.res)), ci = Math.round(fi), cj = Math.round(fj); let sum = 0, c = 0;
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 0 || j < 0 || i >= dem.w || j >= dem.h) continue; const v = dem.data[j * dem.w + i]; if (v === v) { sum += v; c++; }
  }
  return c ? sum / c : null;
}

// Lowest and highest ground in each ring, from every terrain cell inside it: [{ lo, hi }].
function ringRelief(T, rings) {
  const { box: [s, w, n, e], dem } = T;
  return rings.map((ring) => {
    const xy = ring.map((p) => [p[1], p[0]]), [x0, x1] = minMax(xy.map((p) => p[0])), [y0, y1] = minMax(xy.map((p) => p[1]));
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < dem.h; j++) {
      const lat = n - ((n - s) * j) / (dem.h - 1); if (lat < y0 || lat > y1) continue;
      for (let i = 0; i < dem.w; i++) {
        const lon = w + ((e - w) * i) / (dem.w - 1); if (lon < x0 || lon > x1 || !inPoly(lon, lat, xy)) continue;
        const v = dem.data[j * dem.w + i]; if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    return lo <= hi ? { lo, hi } : null;
  });
}
const demLabel = (dem) => `${dem.source}, ${dem.res < 2 ? "about 1 m" : `about ${Math.round(dem.res)} m`} per point`;

// ---------- 3D view ----------
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load the 3D engine")); document.head.appendChild(s); });
}

const View3D = {
  el: null, built: null, token: 0,

  // opts: { rings: [{ name, color, ring }], spots: [{ label, color, lat, lon }], ndvi: overlay | null, title }
  async open(opts) {
    this.opts = opts;
    this.ui();
    this.el.hidden = false;
    const tok = ++this.token;
    this.say("Loading the terrain…");
    try {
      if (!window.THREE) await (this.engine = this.engine || loadScript(THREE_URL).catch((err) => { this.engine = null; throw err; }));
      const T = await demForPoints(opts.rings.flatMap((r) => r.ring));
      if (tok !== this.token) return;
      this.say("Loading the satellite image…");
      const sat = await this.imagery(T.box).catch((err) => { console.warn("3D imagery", err); return null; });
      if (tok !== this.token) return;
      this.build({ ...T, sat });
      this.say("");
      return true;
    } catch (err) {
      console.error(err);
      if (tok === this.token) this.say(`The 3D view could not load (${err.message}). Check the connection and try again.`, true);
    }
  },

  // Field box plus a margin, so the surroundings (a slope above, a ditch below) show too.
  box(pts) {
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
    let [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    const mlat = Math.max((n - s) * 0.18, 0.0004), mlon = Math.max((e - w) * 0.18, 0.0004 / Math.cos((s * Math.PI) / 180));
    return [s - mlat, w - mlon, n + mlat, e + mlon];
  },

  // Esri imagery stitched over the box (canvas in Web Mercator; over one farm the difference with lat/lon is negligible).
  async imagery([s, w, n, e]) {
    const span = Math.max(lon2x(e, 0) - lon2x(w, 0), lat2y(s, 0) - lat2y(n, 0));
    const z = Math.max(1, Math.min(19, Math.floor(Math.log2(2048 / 256 / span))));
    const X0 = lon2x(w, z) * 256, X1 = lon2x(e, z) * 256, Y0 = lat2y(n, z) * 256, Y1 = lat2y(s, z) * 256;
    const cv = document.createElement("canvas"); cv.width = Math.round(X1 - X0); cv.height = Math.round(Y1 - Y0);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#6b6b5e"; ctx.fillRect(0, 0, cv.width, cv.height);
    const jobs = [];
    for (let tx = Math.floor(X0 / 256); tx <= Math.floor(X1 / 256); tx++) for (let ty = Math.floor(Y0 / 256); ty <= Math.floor(Y1 / 256); ty++)
      jobs.push(loadImage(`${ESRI_IMG}/${z}/${ty}/${tx}`).then((im) => ctx.drawImage(im, tx * 256 - X0, ty * 256 - Y0)).catch(() => {}));
    await Promise.all(jobs);
    ctx.getImageData(0, 0, 1, 1); // throws if a tile came without CORS, so the view falls back to colours
    return cv;
  },

  // Texture: satellite, NDVI on satellite, or height colours, with the block borders drawn on it.
  texture(mode) {
    const { box: [s, w, n, e], sat, dem, lo, hi } = this.built, o = this.opts;
    const cv = document.createElement("canvas"); cv.width = sat ? sat.width : 1024; cv.height = sat ? sat.height : 1024;
    const ctx = cv.getContext("2d"), X = (lon) => ((lon - w) / (e - w)) * cv.width, Y = (lat) => ((n - lat) / (n - s)) * cv.height;
    if (mode === "height" || !sat) {
      const im = ctx.createImageData(dem.w, dem.h);
      for (let k = 0; k < dem.w * dem.h; k++) { const c = rampRgb(HEIGHT_STOPS, (dem.data[k] - lo) / (hi - lo || 1), true); im.data.set([c[0], c[1], c[2], 255], k * 4); }
      const tmp = document.createElement("canvas"); tmp.width = dem.w; tmp.height = dem.h; tmp.getContext("2d").putImageData(im, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
    } else ctx.drawImage(sat, 0, 0);
    if (mode === "ndvi" && o.ndvi && this.ndviImg) {
      const [[a, b], [c, d]] = o.ndvi.bounds; ctx.globalAlpha = 0.9; ctx.drawImage(this.ndviImg, X(b), Y(c), X(d) - X(b), Y(a) - Y(c)); ctx.globalAlpha = 1;
    }
    // Dim what is outside the blocks, then outline each block.
    const lw = Math.max(2, cv.width / 400);
    ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height);
    for (const r of o.rings) { r.ring.forEach(([la, lo2], i) => (i ? ctx.lineTo(X(lo2), Y(la)) : ctx.moveTo(X(lo2), Y(la)))); ctx.closePath(); }
    ctx.fillStyle = "rgba(10,14,12,0.38)"; ctx.fill("evenodd");
    for (const r of o.rings) {
      ctx.beginPath(); r.ring.forEach(([la, lo2], i) => (i ? ctx.lineTo(X(lo2), Y(la)) : ctx.moveTo(X(lo2), Y(la)))); ctx.closePath();
      ctx.lineWidth = lw * 2; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = r.color; ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return t;
  },

  build({ box, P, W, H, dem, sat }) {
    this.dispose();
    const [lo, hi] = minMax(dem.data);
    const o = this.opts, cv = this.el.querySelector("canvas");
    const B = this.built = { box, P, W, H, dem, sat, lo, hi };
    const renderer = B.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = B.scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe6e0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5040, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-W, Math.max(W, H) * 0.8, -H * 0.6); scene.add(sun);

    // Terrain mesh: x east, z south, y up (metres above the lowest point).
    const { w: gw, h: gh, data } = dem, base = lo, pos = new Float32Array(gw * gh * 3), uv = new Float32Array(gw * gh * 2);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      pos.set([(i / (gw - 1) - 0.5) * W, data[k] - base, (j / (gh - 1) - 0.5) * H], k * 3);
      uv.set([i / (gw - 1), 1 - j / (gh - 1)], k * 2);
    }
    const idx = []; for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) { const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    B.mat = new THREE.MeshLambertMaterial({ map: null });
    B.terrain = new THREE.Mesh(geo, B.mat);
    // Sides down to a flat base, so the block reads as a slab of ground.
    const depth = Math.max(4, (hi - lo) * 0.6), sides = [];
    const edge = (list) => { for (let q = 0; q < list.length - 1; q++) { const [a, b] = [list[q], list[q + 1]]; const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], Bp = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]]; sides.push(...A, ...Bp, Bp[0], -depth, Bp[2], ...A, Bp[0], -depth, Bp[2], A[0], -depth, A[2]); } };
    const range = (n2, f) => [...Array(n2)].map((_, q) => f(q));
    edge(range(gw, (i) => i)); edge(range(gh, (j) => j * gw + gw - 1)); edge(range(gw, (i) => (gh - 1) * gw + gw - 1 - i)); edge(range(gh, (j) => (gh - 1 - j) * gw));
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sides), 3));
    B.sides = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x7a5a3c, side: THREE.DoubleSide }));
    B.ground = new THREE.Group(); B.ground.add(B.terrain, B.sides); scene.add(B.ground);

    // Probe pins: a post and a numbered head that keeps facing the camera.
    B.pins = new THREE.Group(); scene.add(B.pins);
    const post = Math.max(W, H) * 0.035;
    B.pinList = (o.spots || []).map((sp) => {
      const [x, z] = P.fwd(sp.lat, sp.lon), g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(post * 0.04, post * 0.04, post, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stick.position.y = post / 2; g.add(stick);
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.badge(sp.label, sp.color), depthTest: false }));
      head.scale.set(post * 0.8, post * 0.8, 1); head.position.y = post; head.renderOrder = 2; g.add(head);
      g.position.set(x, 0, -z); B.pins.add(g);
      return { g, x, z: -z };
    });

    // Camera looking down from the south-west.
    const fit = Math.max(W, H);
    B.camera = new THREE.PerspectiveCamera(40, 1, fit / 200, fit * 20);
    B.orbit = { theta: -0.6, phi: 0.95, dist: fit * 1.25, tx: 0, ty: 0, tz: 0, fit };
    if (o.ndvi) { this.ndviImg = null; loadImage(o.ndvi.url).then((im) => { this.ndviImg = im; if (this.drape() === "ndvi") this.setDrape("ndvi"); }).catch(() => {}); }
    this.el.querySelector('[data-k="ndvi"]').disabled = !o.ndvi;
    this.el.querySelector('[data-k="sat"]').disabled = !sat;
    this.setDrape(!sat ? "height" : this.drape() === "ndvi" && !o.ndvi ? "sat" : this.drape());
    this.setExag(+this.el.querySelector(".v3-exag").value);
    this.stats();
    this.resize();
  },

  badge(text, color) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fillStyle = color; x.fill(); x.lineWidth = 12; x.strokeStyle = "#fff"; x.stroke();
    x.fillStyle = "#fff"; x.font = "700 60px Barlow, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 64, 68);
    const t = new THREE.CanvasTexture(c); if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  },

  // Height at a point (bilinear), in metres above the lowest point of the grid.
  heightAt(x, z) {
    const { W, H, dem: { w, h, data }, lo } = this.built;
    const fx = Math.max(0, Math.min(w - 1.001, (x / W + 0.5) * (w - 1))), fz = Math.max(0, Math.min(h - 1.001, (z / H + 0.5) * (h - 1)));
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, v = (ii, jj) => data[jj * w + ii];
    return (v(i, j) * (1 - a) + v(i + 1, j) * a) * (1 - b) + (v(i, j + 1) * (1 - a) + v(i + 1, j + 1) * a) * b - lo;
  },

  drape() { const b = this.el.querySelector(".v3-drape button.active"); return b ? b.dataset.k : "sat"; },
  setDrape(k) {
    const B = this.built; if (!B) return;
    this.el.querySelectorAll(".v3-drape button").forEach((b) => b.classList.toggle("active", b.dataset.k === k));
    if (B.mat.map) B.mat.map.dispose();
    B.mat.map = this.texture(k); B.mat.needsUpdate = true;
    this.el.querySelector(".v3-scale").hidden = k !== "height";
    this.render();
  },
  setExag(ex) {
    const B = this.built; if (!B) return;
    B.exag = ex; B.ground.scale.y = ex;
    for (const p of B.pinList) p.g.position.y = this.heightAt(p.x, p.z) * ex;
    this.render();
  },

  // Elevation and relief of each block, from the lidar grid.
  stats() {
    const B = this.built, o = this.opts, rel = ringRelief(B, o.rings.map((r) => r.ring));
    this.el.querySelector(".v3-stats").innerHTML = o.rings.map((r, k) => rel[k]
      ? `<span><i style="background:${r.color}"></i>${escapeHtml(r.name)}: ${fmt(rel[k].lo, 1)}–${fmt(rel[k].hi, 1)} m <b>(${fmt(rel[k].hi - rel[k].lo, 1)} m difference)</b></span>` : "").join("");
    this.el.querySelector(".v3-src").textContent = `Terrain: ${demLabel(B.dem)} · imagery Esri`;
    this.el.querySelector(".v3-scale").innerHTML = `<span>${fmt(B.lo, 0)} m</span><i style="background:linear-gradient(90deg,${HEIGHT_STOPS.map(([t, c]) => `rgb(${c}) ${t * 100}%`).join(",")})"></i><span>${fmt(B.hi, 0)} m</span>`;
  },

  // A still picture of the blocks in 3D for the report (satellite, relief ×3, seen from the south-west), as a PNG
  // data URL, or null when the terrain or imagery cannot be loaded.
  async snapshot(opts) {
    this.ui();
    const el = this.el, wasHidden = el.hidden;
    el.style.visibility = "hidden"; el.hidden = false;
    try {
      el.querySelector(".v3-exag").value = "3";
      el.querySelectorAll(".v3-drape button").forEach((b) => b.classList.toggle("active", b.dataset.k === "sat"));
      if (!(await this.open(opts)) || !this.built) return null;
      const B = this.built; if (!B.sat) return null;
      this.reset(); cancelAnimationFrame(this.frame); this.frame = 0;
      B.renderer.setPixelRatio(1); B.renderer.setSize(1200, 760, false); B.camera.aspect = 1200 / 760; B.camera.updateProjectionMatrix();
      this.camera(); B.renderer.render(B.scene, B.camera);
      return B.renderer.domElement.toDataURL("image/jpeg", 0.85);
    } catch (err) { console.warn("3D snapshot", err); return null; }
    finally { this.close(); el.style.visibility = ""; el.hidden = wasHidden; }
  },

  camera() {
    const B = this.built, O = B.orbit, sp = Math.sin(O.phi);
    B.camera.position.set(O.tx + O.dist * sp * Math.sin(O.theta), O.ty + O.dist * Math.cos(O.phi), O.tz + O.dist * sp * Math.cos(O.theta));
    B.camera.lookAt(O.tx, O.ty, O.tz);
  },
  render() {
    const B = this.built; if (!B || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.camera(); B.renderer.render(B.scene, B.camera); });
  },
  resize() {
    const B = this.built; if (!B) return;
    const box = this.el.querySelector(".v3-stage"), w = box.clientWidth, h = box.clientHeight;
    B.renderer.setSize(w, h, false); B.camera.aspect = w / Math.max(1, h); B.camera.updateProjectionMatrix(); this.render();
  },
  reset() { const O = this.built && this.built.orbit; if (!O) return; Object.assign(O, { theta: -0.6, phi: 0.95, dist: O.fit * 1.25, tx: 0, ty: 0, tz: 0 }); this.render(); },

  // Drag to turn, two fingers or right-drag / shift-drag to move, wheel or pinch to zoom.
  controls(stage) {
    const ptrs = new Map(); let last = null;
    const pan = (dx, dy) => {
      const O = this.built.orbit, k = (O.dist / stage.clientHeight) * 0.75, c = Math.cos(O.theta), s = Math.sin(O.theta);
      // The ground follows the pointer: right = (cos θ, 0, −sin θ), away from the camera = (−sin θ, 0, −cos θ).
      O.tx += (-dx * c - dy * s) * k; O.tz += (dx * s - dy * c) * k;
      const lim = O.fit; O.tx = Math.max(-lim, Math.min(lim, O.tx)); O.tz = Math.max(-lim, Math.min(lim, O.tz));
    };
    const zoom = (f) => { const O = this.built.orbit; O.dist = Math.max(O.fit * 0.08, Math.min(O.fit * 4, O.dist * f)); };
    stage.addEventListener("contextmenu", (e) => e.preventDefault());
    stage.addEventListener("pointerdown", (e) => { if (!this.built) return; stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
    stage.addEventListener("pointermove", (e) => {
      if (!this.built) return;
      if (!ptrs.has(e.pointerId)) { this.hover(e); return; }
      const prev = ptrs.get(e.pointerId), dx = e.clientX - prev[0], dy = e.clientY - prev[1]; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const O = this.built.orbit;
      if (ptrs.size === 1) {
        if (e.buttons === 2 || e.shiftKey) pan(dx, dy);
        else { O.theta -= dx * 0.006; O.phi = Math.max(0.12, Math.min(1.45, O.phi - dy * 0.005)); }
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (last) { zoom(last.d / d); pan(mid[0] - last.mid[0], mid[1] - last.mid[1]); }
        last = { d, mid };
      }
      this.render();
    });
    const up = (e) => { ptrs.delete(e.pointerId); last = null; };
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", (e) => { if (!this.built) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); this.render(); }, { passive: false });
    stage.addEventListener("dblclick", () => this.reset());
  },

  // Height under the pointer.
  hover(e) {
    const B = this.built, r = e.currentTarget.getBoundingClientRect();
    if (!this.ray) this.ray = new THREE.Raycaster();
    this.ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, B.camera);
    const hit = this.ray.intersectObject(B.terrain)[0], out = this.el.querySelector(".v3-here");
    if (!hit) { out.textContent = ""; return; }
    const p = hit.point, [lat, lon] = B.P.inv(p.x, -p.z);
    out.textContent = `Here: ${fmt(this.heightAt(p.x, p.z) + B.lo, 1)} m · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  },

  say(msg, err) { const s = this.el.querySelector(".v3-msg"); s.hidden = !msg; s.textContent = msg || ""; s.classList.toggle("err", !!err); },

  close() { this.token++; this.el.hidden = true; this.dispose(); },
  dispose() {
    const B = this.built; if (!B) return;
    B.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    B.renderer.dispose(); this.built = null;
  },

  ui() {
    if (this.el) return;
    const el = this.el = document.createElement("div"); el.className = "view3d"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "3D view of the blocks");
    el.innerHTML = `<div class="v3-bar">
        <b class="v3-title">3D view</b>
        <span class="v3-drape seg" role="group" aria-label="Show on the ground"><button type="button" data-k="sat" class="active">Satellite</button><button type="button" data-k="ndvi">NDVI</button><button type="button" data-k="height">Height</button></span>
        <label class="v3-ex">Relief ×<select class="v3-exag" aria-label="Relief exaggeration"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select></label>
        <button type="button" class="v3-reset" data-icon="arrowLeft">Reset view</button>
        <button type="button" class="v3-close" data-icon="cross">Close</button>
      </div>
      <div class="v3-stage"><canvas></canvas><div class="v3-msg status" hidden></div><div class="v3-here"></div><div class="v3-scale" hidden></div></div>
      <div class="v3-foot"><div class="v3-stats"></div><div class="hint"><span class="v3-src"></span> · Drag to turn, right-drag or two fingers to move, scroll or pinch to zoom.</div></div>`;
    decorateIcons(el);
    $("mapwrap").appendChild(el);
    el.querySelector(".v3-close").onclick = () => this.close();
    el.querySelector(".v3-reset").onclick = () => this.reset();
    el.querySelectorAll(".v3-drape button").forEach((b) => (b.onclick = () => this.setDrape(b.dataset.k)));
    el.querySelector(".v3-exag").onchange = (e) => this.setExag(+e.target.value);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) this.close(); });
    this.controls(el.querySelector(".v3-stage"));
    new ResizeObserver(() => this.resize()).observe(el.querySelector(".v3-stage"));
  },
};
// Green lowlands → ochre → brown → white tops.
const HEIGHT_STOPS = [[0, [46, 110, 78]], [0.35, [140, 170, 90]], [0.65, [214, 180, 100]], [0.85, [160, 105, 60]], [1, [245, 240, 230]]];
