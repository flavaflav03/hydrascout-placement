"use strict";
// UI wiring: map, field drawing/import, NDVI, irrigation inputs, analysis run and results.

function setStatus(msg, err = false, id = "status") { const s = $(id); s.hidden = !msg; s.textContent = msg || ""; s.classList.toggle("err", err); }
const setNdviStatus = (msg, err) => setStatus(msg, err, "ndviStatus");

// ---------- map ----------
const map = L.map("map", { zoomControl: true }).setView([46.6, 2.4], 6);
const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }).addTo(map);
const places = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }).addTo(map);
const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" });

// Soil maps from ISRIC SoilGrids (public WMS, 250 m). The French "carte des sols" is not openly served as tiles,
// so the panel links to it on cartes.gouv.fr instead.
const SOIL_ATTR = "Soil © ISRIC SoilGrids 2.0 (CC-BY 4.0)";
const SOIL_MAPS = {
  wrb: { url: "https://maps.isric.org/mapserv/wrb", layer: "MostProbable" },
  clay: { url: "https://maps.isric.org/mapserv/clay", layer: "clay_15-30cm_mean" },
};
const soilLayers = Object.fromEntries(Object.entries(SOIL_MAPS).map(([k, m]) => [k, L.tileLayer.wms(m.url, { layers: m.layer, styles: "", format: "image/png", transparent: true, version: "1.3.0", opacity: 0.6, maxZoom: 19, attribution: SOIL_ATTR })]));
function showSoilMap(key) {
  Object.values(soilLayers).forEach((l) => map.removeLayer(l));
  const m = SOIL_MAPS[key], lg = $("soilLegend");
  lg.hidden = !m;
  if (!m) return;
  soilLayers[key].addTo(map);
  lg.src = `${m.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=${m.layer}&FORMAT=image/png&SLD_VERSION=1.1.0`;
}
$("soilMap").addEventListener("change", (e) => showSoilMap(e.target.value));

const ndviLayer = L.layerGroup().addTo(map);
L.control.layers({ Satellite: sat, Map: osm }, { "Place names": places, "Soil type (WRB)": soilLayers.wrb, "Clay content": soilLayers.clay, "NDVI image": ndviLayer }, { position: "topright" }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);
map.on("overlayadd overlayremove", () => { $("soilMap").value = Object.keys(soilLayers).find((k) => map.hasLayer(soilLayers[k])) || "off"; });

const fieldLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);
const pivotLayer = L.layerGroup().addTo(map);
const gridLayer = L.layerGroup().addTo(map);
const sensorLayer = L.layerGroup().addTo(map);

const S = { field: null, isExample: false, mode: null, draft: [], ndvi: null, scenes: [], result: null };

// Example field so the tool opens in a working state (farmland in the Beauce, France).
const EXAMPLE_FIELD = [[48.2862, 1.6043], [48.2871, 1.6121], [48.2832, 1.6139], [48.2808, 1.6098], [48.2817, 1.6038]];

function clearResult() { S.result = null; gridLayer.clearLayers(); sensorLayer.clearLayers(); $("results").hidden = true; }

function setField(latlngs, { fit = true, example = false } = {}) {
  S.field = latlngs; S.isExample = example; clearResult();
  fieldLayer.clearLayers();
  hideTimeline(); S.scenes = [];
  if (S.ndvi && S.ndvi.source === "sentinel") clearNdvi("The field changed. Search satellite images again for the new boundary.");
  else if (S.ndvi) { S.ndvi.overlay = null; showNdvi(S.ndvi); }
  $("sceneBtn").disabled = !latlngs;
  if (!latlngs) { $("fieldInfo").textContent = "No field yet."; $("analyzeBtn").disabled = true; return; }
  const poly = L.polygon(latlngs, { color: "#ffffff", weight: 2.5, fill: false, dashArray: example ? "6 6" : null }).addTo(fieldLayer);
  if (fit) map.fitBounds(poly.getBounds(), { padding: [30, 30] });
  const c = centroidLatLng(latlngs);
  $("fieldInfo").textContent = `${example ? "Example field · " : ""}${fieldAreaHa(latlngs).toFixed(2)} ha · ${latlngs.length} corners · centre ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`;
  $("soilLink").href = `https://cartes.gouv.fr/explorer-les-cartes/?c=${c[1].toFixed(5)},${c[0].toFixed(5)}&z=15&l=INRA.CARTE.SOLS$GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;
  $("analyzeBtn").disabled = false;
  if (!example) store.set("hs.field", latlngs);
}

// ---------- search ----------
// Searched place or coordinates are marked with a pin (not clickable, so drawing on top of it still works).
const searchLayer = L.layerGroup().addTo(map);
const PIN_SVG = '<svg width="30" height="42" viewBox="0 0 30 42" aria-hidden="true"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 41 15 41s14-15.7 14-26.1C29 7.2 22.7 1 15 1z" fill="#d6452f" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>';
function showPin(lat, lon, label) {
  searchLayer.clearLayers();
  L.marker([lat, lon], { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "", html: PIN_SVG, iconSize: [30, 42], iconAnchor: [15, 41], tooltipAnchor: [0, -40] }) })
    .bindTooltip(escapeHtml(label), { permanent: true, direction: "top", className: "pin-label" }).addTo(searchLayer);
}
$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim(); if (!q) { searchLayer.clearLayers(); return; }
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { setStatus("Coordinates must be latitude, longitude in decimal degrees, e.g. 48.2840, 1.6090.", true); return; }
    setStatus(""); showPin(lat, lon, `${lat.toFixed(6)}, ${lon.toFixed(6)}`); map.setView([lat, lon], 17); return;
  }
  try {
    setStatus("Searching…");
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": navigator.language || "en" } });
    const j = await r.json();
    if (!j.length) { setStatus(`No place found for "${q}". Try a town name or coordinates.`, true); return; }
    setStatus("");
    const hit = j[0], lat = +hit.lat, lon = +hit.lon, b = hit.boundingbox.map(Number);
    showPin(lat, lon, hit.display_name.split(",").slice(0, 3).join(","));
    map.fitBounds([[b[0], b[2]], [b[1], b[3]]], { maxZoom: 17 });
  } catch (err) { setStatus("Search is unavailable right now. Pan the map by hand or type coordinates.", true); }
});

// ---------- drawing ----------
function drawbar(msg) { const d = $("drawbar"); d.hidden = !msg; d.textContent = msg || ""; }
function renderDraft() {
  draftLayer.clearLayers();
  const drawing = S.mode === "draw";
  if (S.draft.length > 1) L.polyline(S.draft, { color: "#ffd84a", weight: 3 }).addTo(draftLayer);
  if (S.draft.length > 2) L.polygon(S.draft, { color: "#ffd84a", weight: 0, fillOpacity: 0.15 }).addTo(draftLayer);
  S.draft.forEach((p, i) => {
    const mk = L.marker(p, { icon: L.divIcon({ className: "", html: '<div class="vertex-pin"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(draftLayer);
    if (i === 0) mk.on("click", (ev) => { L.DomEvent.stopPropagation(ev); finishDraw(); });
  });
  $("undoBtn").hidden = !drawing; $("finishBtn").hidden = !drawing; $("finishBtn").disabled = S.draft.length < 3;
  drawbar(drawing ? (S.draft.length < 3 ? `Tap the map to add corners (${S.draft.length} so far)` : "Tap the first corner or Finish to close the field") : "");
}
function setMode(mode) {
  S.mode = mode; S.draft = [];
  if (mode) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  map.getContainer().style.cursor = mode ? "crosshair" : "";
  $("drawBtn").classList.toggle("active", mode === "draw"); $("drawBtn").textContent = mode === "draw" ? "Cancel" : "Draw boundary";
  $("pivCentreBtn").classList.toggle("active", mode === "pivot"); $("pivCentreBtn").textContent = mode === "pivot" ? "Cancel" : "Place pivot centre on map";
  renderDraft();
  if (mode === "pivot") drawbar("Tap the pivot centre on the map");
}
function finishDraw() { if (S.draft.length < 3) return; const f = S.draft.slice(); setMode(null); setField(f, { fit: false }); }
$("drawBtn").addEventListener("click", () => setMode(S.mode === "draw" ? null : "draw"));
$("undoBtn").addEventListener("click", () => { S.draft.pop(); renderDraft(); });
$("finishBtn").addEventListener("click", finishDraw);
map.on("click", (e) => {
  if (S.mode === "draw") { S.draft.push([e.latlng.lat, e.latlng.lng]); renderDraft(); }
  else if (S.mode === "pivot") { irr.pivotCentre = [e.latlng.lat, e.latlng.lng]; setMode(null); updateIrrigation(); }
});

// ---------- import boundary ----------
$("importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const txt = await f.text(); let ring = null;
    if (/\.kml$/i.test(f.name) || txt.trim().startsWith("<")) {
      const doc = new DOMParser().parseFromString(txt, "application/xml");
      const c = doc.querySelector("Polygon outerBoundaryIs coordinates, Polygon coordinates, LineString coordinates");
      if (c) ring = c.textContent.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((a) => a.length >= 2).map(([lon, lat]) => [lat, lon]);
      const nm = doc.querySelector("Placemark > name"); if (nm && !$("fieldName").value) $("fieldName").value = nm.textContent.trim();
    } else {
      const g = JSON.parse(txt);
      const feat = g.type === "FeatureCollection" ? g.features.find((ft) => /Polygon/.test(ft.geometry && ft.geometry.type)) : g.type === "Feature" ? g : null;
      const geom = feat ? feat.geometry : g;
      if (geom && geom.type === "Polygon") ring = geom.coordinates[0];
      else if (geom && geom.type === "MultiPolygon") ring = geom.coordinates[0][0];
      if (ring) ring = ring.map(([lon, lat]) => [lat, lon]);
      const nm = feat && feat.properties && (feat.properties.name || feat.properties.nom); if (nm && !$("fieldName").value) $("fieldName").value = nm;
    }
    if (!ring || ring.length < 3) throw new Error("no polygon");
    const a = ring[0], b = ring[ring.length - 1]; if (a[0] === b[0] && a[1] === b[1]) ring.pop();
    setMode(null); setField(ring); setStatus("");
  } catch (err) { setStatus("Could not read a field boundary from that file. Use a GeoJSON or KML file containing one polygon in WGS84 (lat/lon).", true); }
});
$("fieldName").addEventListener("input", (e) => store.set("hs.fieldName", e.target.value));

// ---------- NDVI ----------
const NDVI_SCALE = [0, 0.9]; // fixed colour scale for satellite dates, so the timeline compares like with like
function showNdvi(nd) {
  ndviLayer.clearLayers();
  if (!nd.overlay && S.field) nd.overlay = ndviOverlay(nd, S.field, nd.source === "sentinel" ? NDVI_SCALE : null);
  const ov = nd.overlay;
  if (ov) L.imageOverlay(ov.url, ov.bounds, { opacity: 0.9, interactive: false }).addTo(ndviLayer);
  $("ndviMeta").hidden = false;
  $("ndviMeta").textContent = ov ? `${nd.label} · field NDVI ${fmt(ov.lo, 2)} to ${fmt(ov.hi, 2)}, average ${fmt(ov.mean, 2)}` : `${nd.label} · does not cover this field`;
  const [c0, c1] = nd.source === "sentinel" ? NDVI_SCALE : ov ? [ov.lo, ov.hi] : [0, 1];
  $("ndviLegend").hidden = !ov;
  $("ndviLegend").innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${Array.from({ length: 11 }, (_, i) => ndviRamp(i / 10)).join(",")})"></div><div class="ends"><span>${fmt(c0, 2)}</span><span>NDVI${nd.source === "sentinel" ? " (same scale for every date)" : ""}</span><span>${fmt(c1, 2)}</span></div>`;
}
function setNdvi(nd) { S.ndvi = nd; $("ndviClear").hidden = false; showNdvi(nd); if (S.result) setNdviStatus("NDVI updated. Run “Find sensor spots” again to use it."); }
function clearNdvi(msg) {
  S.ndvi = null; ndviLayer.clearLayers(); $("ndviClear").hidden = true; $("ndviMeta").hidden = true; $("ndviLegend").hidden = true;
  if (msg) setNdviStatus(msg);
}
function hideTimeline() { TL.playing = false; TL.token++; $("tPlay").textContent = "Play"; $("sceneRow").hidden = true; }
$("ndviClear").addEventListener("click", () => { hideTimeline(); clearNdvi("NDVI removed. The analysis will use terrain and soil only."); });

$("ndviFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    setNdviStatus("Reading NDVI image…");
    const nd = await readNdviFile(f);
    hideTimeline(); setNdviStatus(nd.bands > 1 ? "The file has several bands: band 1 is used as NDVI." : "");
    setNdvi(nd);
  } catch (err) {
    setNdviStatus(`Could not read that NDVI image: ${err.message}. Export a single-band GeoTIFF in WGS84 (EPSG:4326), Web Mercator, UTM or Lambert-93.`, true);
  }
});

// Timeline of clear Sentinel-2 dates (oldest → newest). Each date's NDVI is computed once and kept.
const TL = { idx: 0, playing: false, token: 0, debounce: null };
async function sceneNdvi(sc) {
  if (!sc.nd) { sc.nd = await Sentinel.ndvi(sc, S.field); sc.nd.overlay = ndviOverlay(sc.nd, S.field, NDVI_SCALE); sc.mean = sc.nd.overlay ? sc.nd.overlay.mean : null; }
  return sc.nd;
}
function timelineLabel() {
  const sc = S.scenes[TL.idx];
  $("tDate").innerHTML = `${sc.date} · ${fmt(sc.veg * 100, 0)}% green cover${sc.mean != null ? ` · NDVI ${fmt(sc.mean, 2)}` : ""}${sc.best ? '<span class="tag">recommended</span>' : ""}`;
}
async function showScene(i) {
  TL.idx = i; $("tRange").value = i; timelineLabel(); drawTimeline();
  const sc = S.scenes[i], tok = ++TL.token;
  if (!sc.nd) setNdviStatus(`Loading NDVI for ${sc.date}…`);
  try { await sceneNdvi(sc); }
  catch (err) { console.error(err); if (tok === TL.token) setNdviStatus(`Could not load the ${sc.date} image (${err.message}). Pick another date.`, true); return; }
  if (tok !== TL.token) return; // a newer date was picked meanwhile
  setNdvi(sc.nd); if (!S.result) setNdviStatus(""); timelineLabel(); drawTimeline();
}
function drawTimeline() {
  const sv = $("tChart"), sc = S.scenes; if (!sc.length) return;
  const W = 320, H = 110, l = 30, r = 8, t = 8, b = 20;
  const t0 = Date.parse(sc[0].date), t1 = Date.parse(sc[sc.length - 1].date), span = t1 - t0 || 1;
  const X = (d) => l + ((Date.parse(d) - t0) / span) * (W - l - r), Y = (v) => t + (1 - Math.max(0, Math.min(1, v))) * (H - t - b);
  let g = [0, 0.5, 1].map((v) => `<line class="grid" x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${l - 4}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`).join("");
  const done = sc.filter((s) => s.mean != null);
  if (done.length > 1) g += `<polyline class="line" points="${done.map((s) => `${X(s.date).toFixed(1)},${Y(s.mean).toFixed(1)}`).join(" ")}"/>`;
  g += `<line class="cur" x1="${X(sc[TL.idx].date)}" x2="${X(sc[TL.idx].date)}" y1="${t}" y2="${H - b}"/>`;
  g += sc.map((s, i) => s.mean != null
    ? `<circle class="pt${i === TL.idx ? " sel" : ""}" data-i="${i}" cx="${X(s.date).toFixed(1)}" cy="${Y(s.mean).toFixed(1)}" r="${i === TL.idx ? 5 : 3.5}"><title>${s.date}: NDVI ${fmt(s.mean, 2)}</title></circle>`
    : `<circle class="todo${i === TL.idx ? " sel" : ""}" data-i="${i}" cx="${X(s.date).toFixed(1)}" cy="${H - b}" r="${i === TL.idx ? 4.5 : 3}"><title>${s.date}: not loaded yet</title></circle>`).join("");
  const month = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  g += `<text x="${l}" y="${H - 5}">${month(sc[0].date)}</text><text x="${W - r}" y="${H - 5}" text-anchor="end">${month(sc[sc.length - 1].date)}</text>`;
  sv.innerHTML = g;
}
$("tChart").addEventListener("click", (e) => { const i = e.target.getAttribute && e.target.getAttribute("data-i"); if (i != null) { stopPlay(); showScene(+i); } });
$("tRange").addEventListener("input", (e) => {
  stopPlay(); TL.idx = +e.target.value; timelineLabel(); drawTimeline();
  clearTimeout(TL.debounce); TL.debounce = setTimeout(() => showScene(TL.idx), 250);
});
$("tPrev").addEventListener("click", () => { stopPlay(); if (TL.idx > 0) showScene(TL.idx - 1); });
$("tNext").addEventListener("click", () => { stopPlay(); if (TL.idx < S.scenes.length - 1) showScene(TL.idx + 1); });
function stopPlay() { TL.playing = false; $("tPlay").textContent = "Play"; }
$("tPlay").addEventListener("click", async () => {
  if (TL.playing) return stopPlay();
  TL.playing = true; $("tPlay").textContent = "Pause";
  if (TL.idx >= S.scenes.length - 1) await showScene(0);
  while (TL.playing && TL.idx < S.scenes.length - 1) { await sleep(1100); if (!TL.playing) break; await showScene(TL.idx + 1); }
  stopPlay();
});
$("tAll").addEventListener("click", async () => {
  const btn = $("tAll"); btn.disabled = true;
  const todo = S.scenes.filter((s) => !s.nd); let n = 0;
  const one = async (s) => { try { await sceneNdvi(s); } catch (err) { console.warn(err); } $("tHint").textContent = `Loading dates… ${++n}/${todo.length}`; drawTimeline(); };
  for (let i = 0; i < todo.length; i += 2) await Promise.all(todo.slice(i, i + 2).map(one));
  $("tHint").textContent = "The spots use the date shown."; timelineLabel(); btn.disabled = false;
});

$("sceneBtn").addEventListener("click", async () => {
  if (!S.field) return;
  const btn = $("sceneBtn"); btn.disabled = true; hideTimeline();
  try {
    setNdviStatus("Searching Sentinel-2 images of the last 14 months…");
    const scenes = await Sentinel.search(S.field);
    if (!scenes.length) { setNdviStatus("No usable Sentinel-2 image found for this field. Upload an NDVI GeoTIFF instead.", true); return; }
    // Check the clouds over the field itself for the least cloudy scenes, a few at a time.
    const cands = scenes.slice().sort((a, b) => a.cloud - b.cloud).slice(0, 30);
    let done = 0;
    const check = async (sc) => { try { Object.assign(sc, await Sentinel.checkScene(sc, S.field)); } catch (err) { sc.clear = null; console.warn(err); } setNdviStatus(`Checking clouds over the field… ${++done}/${cands.length}`); };
    for (let i = 0; i < cands.length; i += 4) await Promise.all(cands.slice(i, i + 4).map(check));
    const clear = cands.filter((c) => c.clear >= 0.9);
    if (!clear.length) { setNdviStatus("All recent images are cloudy over this field. Upload an NDVI GeoTIFF instead, or try again later.", true); return; }
    // Recommended date: fully clear, full crop cover, most recent.
    const pool = clear.filter((c) => c.clear >= 0.97).length ? clear.filter((c) => c.clear >= 0.97) : clear;
    const maxVeg = Math.max(...pool.map((c) => c.veg));
    const best = pool.filter((c) => c.veg >= maxVeg - 0.05).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    best.best = true;
    S.scenes = clear.sort((a, b) => (a.date < b.date ? -1 : 1));
    $("tRange").max = S.scenes.length - 1; $("sceneRow").hidden = false; $("tHint").textContent = "The spots use the date shown.";
    await showScene(S.scenes.indexOf(best));
  } catch (err) {
    console.error(err); setNdviStatus("Could not reach the Sentinel-2 catalogue. Check your connection and try again, or upload an NDVI GeoTIFF.", true);
  } finally { btn.disabled = false; }
});

// ---------- irrigation ----------
const irr = { pivotCentre: null };
function readIrrigation() {
  const type = $("irrType").value, num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v > 0 ? v : null; };
  const out = { type, notes: $("irrNotes").value.trim() || null };
  if (type === "drip") Object.assign(out, { emitter: num("dripEmitter"), lineSpacing: num("dripLine"), flow: num("dripFlow") });
  if (type === "micro" || type === "sprinkler") out.spacing = num("sprSpacing");
  if (type === "pivot" || type === "linear") out.pivot = { radius: num("pivRadius"), span: num("pivSpan"), lat: irr.pivotCentre && type === "pivot" ? irr.pivotCentre[0] : null, lon: irr.pivotCentre && type === "pivot" ? irr.pivotCentre[1] : null };
  return out;
}
function updateIrrigation() {
  const t = $("irrType").value;
  $("irrDrip").hidden = t !== "drip"; $("irrSprinkler").hidden = !(t === "micro" || t === "sprinkler");
  $("irrPivot").hidden = !(t === "pivot" || t === "linear"); $("pivCentreRow").hidden = t !== "pivot";
  $("pivRadiusLbl").textContent = t === "pivot" ? "Pivot radius (length)" : "Machine length";
  $("irrNotes").hidden = t === "none";
  pivotLayer.clearLayers();
  const R = parseFloat($("pivRadius").value);
  if (t === "pivot" && irr.pivotCentre) {
    const mk = L.marker(irr.pivotCentre, { draggable: true, icon: L.divIcon({ className: "", html: '<div class="vertex-pin" style="border-color:#2f7fbf"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(pivotLayer);
    mk.on("dragend", () => { const p = mk.getLatLng(); irr.pivotCentre = [p.lat, p.lng]; updateIrrigation(); });
    if (R > 0) L.circle(irr.pivotCentre, { radius: R, color: "#2f7fbf", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(pivotLayer);
    $("pivCentreInfo").textContent = `Centre ${irr.pivotCentre[0].toFixed(5)}, ${irr.pivotCentre[1].toFixed(5)}${R > 0 ? "" : " · enter the radius"}`;
  } else if (t === "pivot") $("pivCentreInfo").textContent = "Not placed yet.";
  if (S.mode === "pivot" && t !== "pivot") setMode(null);
  store.set("hs.irrigation", { ...readIrrigation(), pivotCentre: irr.pivotCentre });
}
["irrType", "dripEmitter", "dripLine", "dripFlow", "sprSpacing", "pivRadius", "pivSpan", "irrNotes"].forEach((id) => $(id).addEventListener(id === "irrType" ? "change" : "input", updateIrrigation));
$("pivCentreBtn").addEventListener("click", () => setMode(S.mode === "pivot" ? null : "pivot"));

// ---------- analysis ----------
async function analyze() {
  if (!S.field) return;
  const btn = $("analyzeBtn"); btn.disabled = true;
  try {
    const G = buildGrid(S.field), ha = G.area / 10000, pts = G.pts;
    if (pts.length < 3) throw new Error("The field is too small to analyse. Draw a larger boundary.");
    const irrigation = readIrrigation();
    if (irrigation.type === "pivot" && (!irrigation.pivot.radius || irrigation.pivot.lat == null)) setStatus("Pivot centre or radius missing: the pivot is ignored for placement.");

    setStatus(`Loading elevation for ${pts.length} points…`);
    const elev = await fetchElevation(pts, (n) => setStatus(`Loading elevation… ${n}/${pts.length}`));

    // Soil: SoilGrids has a 250 m grid and a low rate limit, so sample a few spread-out points and interpolate.
    const soilIdx = [pts.reduce((bi, p, i) => (Math.hypot(p.x, p.y) < Math.hypot(pts[bi].x, pts[bi].y) ? i : bi), 0)];
    const extra = ha > 40 ? 3 : ha > 12 ? 2 : 0;
    while (soilIdx.length < 1 + extra) { let bi = 0, bd = -1; pts.forEach((p, i) => { const d = Math.min(...soilIdx.map((j) => Math.hypot(p.x - pts[j].x, p.y - pts[j].y))) * Math.min(1, p.edge / 30); if (d > bd) { bd = d; bi = i; } }); soilIdx.push(bi); }
    const soilSamples = [];
    for (let s = 0; s < soilIdx.length; s++) {
      setStatus(`Loading soil data… ${s + 1}/${soilIdx.length}`);
      try { const v = await fetchSoil(pts[soilIdx[s]].lat, pts[soilIdx[s]].lon); if (v) soilSamples.push({ p: pts[soilIdx[s]], v }); } catch (err) { console.warn(err); }
      if (s < soilIdx.length - 1) await sleep(1200);
    }

    S.result = computePlacement({ G, elev, soilSamples, ndvi: S.ndvi, irrigation, request: $("nSensors").value, buffer: Math.max(0, +$("buffer").value || 0) });
    renderResult();
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(/fetch|network|Failed/i.test(err.message) ? "Could not reach the elevation service. Check your internet connection and try again." : err.message, true);
  } finally { btn.disabled = false; }
}
$("analyzeBtn").addEventListener("click", analyze);

// ---------- rendering ----------
const VIEWS = {
  zones: { label: "Zones" },
  elev: { label: "Elevation (m)", get: (R) => R.T.elev, d: 1 },
  slope: { label: "Slope (%)", get: (R) => R.T.slope, d: 1 },
  tpi: { label: "Hollows ↔ rises (m)", get: (R) => R.T.tpi, d: 2, invert: true },
  clay: { label: "Clay (%)", get: (R) => R.soil && R.soil.clay, d: 0 },
  ndvi: { label: "NDVI", get: (R) => R.ndvi, d: 2, ndvi: true },
};
function renderResult() {
  const R = S.result; if (!R) return;
  $("results").hidden = false;
  const sm = R.summary;
  $("summary").innerHTML = [
    ["Area", `${fmt(R.ha, 2)} ha`], ["Sensors", `${R.sensors.length}`],
    ["Elevation", `${fmt(sm.eMin, 0)}–${fmt(sm.eMax, 0)} m`], ["Mean slope", `${fmt(sm.fSlope, 1)} %`],
    ["Soil", R.soil ? `${fmt(sm.fClay, 0)} % clay` : "not loaded"], ["NDVI", R.ndvi ? `${fmt(sm.fNdvi, 2)}${R.ndviInfo.date ? ` (${R.ndviInfo.date})` : ""}` : "not used"],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  const sel = $("view"), cur = sel.value || "zones";
  sel.innerHTML = Object.entries(VIEWS).filter(([k, v]) => k === "zones" || v.get(R)).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "zones";
  renderGrid();
  sensorLayer.clearLayers();
  const list = $("sensorList"); list.innerHTML = "";
  R.sensors.forEach((s, n) => {
    const col = zoneColor(s.zone);
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "sensor-pin", html: `<span style="background:${col}">${n + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
      .bindPopup(`<b>${s.name}</b><br>${s.why.map(escapeHtml).join("<br>")}${s.tip ? `<br><i>${escapeHtml(s.tip)}</i>` : ""}`).addTo(sensorLayer);
    const card = document.createElement("article"); card.className = "sensor";
    const coords = `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`;
    card.innerHTML = `<h3><span class="badge" style="background:${col}">${n + 1}</span>${s.name}</h3>
      <div class="coords">${coords}</div>
      <ul>${s.why.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      ${s.tip ? `<p class="hint">Installation: ${escapeHtml(s.tip)}</p>` : ""}
      <div class="row"><button type="button" data-act="zoom">Show</button><button type="button" data-act="copy">Copy coordinates</button>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lon.toFixed(6)}">Navigate</a></div>`;
    card.querySelector('[data-act="zoom"]').onclick = () => { map.setView([s.lat, s.lon], Math.max(map.getZoom(), 17)); if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" }); };
    card.querySelector('[data-act="copy"]').onclick = async (ev) => { try { await navigator.clipboard.writeText(coords); ev.target.textContent = "Copied"; } catch (e) { ev.target.textContent = coords; } };
    list.appendChild(card);
  });
  $("notes").innerHTML = R.notes.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
}
function renderGrid() {
  const R = S.result; gridLayer.clearLayers(); if (!R) return;
  const v = $("view").value || "zones", h = R.G.spacing / 2, lg = $("legend");
  let color;
  if (v === "zones") {
    color = (i) => zoneColor(R.lab[i]);
    lg.innerHTML = `<div class="row">${R.sensors.map((s) => `<span class="row" style="gap:4px"><span class="badge" style="background:${zoneColor(s.zone)};width:14px;min-width:14px;height:14px;border-width:1px"></span>Zone ${s.zone + 1} · ${fmt(s.share * 100, 0)}%</span>`).join("")}</div>`;
  } else {
    const V = VIEWS[v], a = V.get(R), [lo, hi] = minMax(a), span = hi - lo || 1;
    const f = V.ndvi ? (t) => ndviRamp(t) : (t) => ramp(V.invert ? 1 - t : t);
    color = (i) => f((a[i] - lo) / span);
    const grad = Array.from({ length: 11 }, (_, i) => f(i / 10)).join(",");
    lg.innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${grad})"></div><div class="ends"><span>${fmt(lo, V.d)}</span><span>${V.label}</span><span>${fmt(hi, V.d)}</span></div>`;
  }
  R.pts.forEach((p, i) => {
    const a = R.G.P.inv(p.x - h, p.y - h), b = R.G.P.inv(p.x + h, p.y + h);
    L.rectangle([a, b], { stroke: false, fillColor: color(i), fillOpacity: 0.5, interactive: false }).addTo(gridLayer);
  });
}
$("view").addEventListener("change", renderGrid);

// ---------- exports ----------
const exportCtx = () => ({ field: S.field, fieldName: $("fieldName").value.trim() });
$("dlReport").onclick = () => S.result && openReport(S.result, exportCtx());
$("dlGpx").onclick = () => S.result && exportGpx(S.result, exportCtx());
$("dlCsv").onclick = () => S.result && exportCsv(S.result, exportCtx());
$("dlGeo").onclick = () => S.result && exportGeoJson(S.result, exportCtx());

// ---------- start ----------
(function start() {
  const saved = store.get("hs.field");
  if (Array.isArray(saved) && saved.length >= 3) setField(saved); else setField(EXAMPLE_FIELD, { example: true });
  $("fieldName").value = store.get("hs.fieldName") || "";
  const si = store.get("hs.irrigation");
  if (si && si.type) {
    $("irrType").value = si.type; $("irrNotes").value = si.notes || "";
    if (si.emitter) $("dripEmitter").value = si.emitter; if (si.lineSpacing) $("dripLine").value = si.lineSpacing; if (si.flow) $("dripFlow").value = si.flow;
    if (si.spacing) $("sprSpacing").value = si.spacing;
    if (si.pivot) { if (si.pivot.radius) $("pivRadius").value = si.pivot.radius; if (si.pivot.span) $("pivSpan").value = si.pivot.span; }
    irr.pivotCentre = si.pivotCentre || null;
  }
  updateIrrigation();
})();
