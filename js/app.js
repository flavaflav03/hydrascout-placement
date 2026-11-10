"use strict";
// UI wiring: map, field drawing/import, NDVI, irrigation inputs, analysis run and results.

decorateIcons();

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
// The soil maps sit in their own pane, clipped to the drawn blocks (or the whole field) so they show only there.
const soilPane = map.createPane("soil"); soilPane.style.zIndex = 350;
const soilLayers = Object.fromEntries(Object.entries(SOIL_MAPS).map(([k, m]) => [k, L.tileLayer.wms(m.url, { layers: m.layer, styles: "", format: "image/png", transparent: true, version: "1.3.0", opacity: 0.6, maxZoom: 19, attribution: SOIL_ATTR, pane: "soil" })]));
// Pane coordinates are Leaflet layer points, which change on every zoom, so the clip is rebuilt then.
function clipSoil() {
  const rings = S.field && !S.isExample ? fieldRings() : [];
  soilPane.style.clipPath = rings.length ? `path("${rings.map((r) => r.map((ll, i) => { const p = map.latLngToLayerPoint(ll); return `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(" ") + " Z").join(" ")}")` : "";
}
map.on("zoomend viewreset", clipSoil);
function showSoilMap(key) {
  Object.values(soilLayers).forEach((l) => map.removeLayer(l));
  if (SOIL_MAPS[key]) soilLayers[key].addTo(map);
  renderKey();
}
$("soilMap").addEventListener("change", (e) => showSoilMap(e.target.value));
const soilOn = () => Object.keys(soilLayers).find((k) => map.hasLayer(soilLayers[k])) || null;

// ---------- map key ----------
// One legend box on the map for whatever is shown (soil map, NDVI), large enough to read on a phone.
// It can be folded away; tapping the map (when not drawing) shows the soil group and NDVI at that spot.
const NDVI_BANDS = [
  [-1, 0.2, "Bare soil, stubble or residue"],
  [0.2, 0.4, "Sparse or emerging crop, or stressed"],
  [0.4, 0.6, "Moderate vegetation"],
  [0.6, 0.8, "Dense, healthy crop"],
  [0.8, 1, "Very dense canopy"],
];
const ndviBand = (v) => NDVI_BANDS.find(([a, b]) => v < b) || NDVI_BANDS[NDVI_BANDS.length - 1];
// Starts folded on phones, where the map is small; the choice is remembered.
const KEY = { open: store.get("hs.keyOpen") ?? !matchMedia("(max-width: 760px)").matches, allSoils: false, here: null, hereFor: null, hereErr: null };
const keyBox = L.DomUtil.create("div", "map-key");
L.DomEvent.disableClickPropagation(keyBox); L.DomEvent.disableScrollPropagation(keyBox);
const KeyControl = L.Control.extend({ onAdd: () => keyBox });
new KeyControl({ position: "bottomleft" }).addTo(map);
keyBox.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  e.stopPropagation(); // the button is replaced below, so Leaflet would no longer see it came from the key and treat it as a map tap
  if (b.dataset.act === "fold") { KEY.open = !KEY.open; store.set("hs.keyOpen", KEY.open); }
  if (b.dataset.act === "allsoils") KEY.allSoils = !KEY.allSoils;
  renderKey();
});

function ndviScale() { const nd = S.ndvi, ov = nd && nd.overlay; return nd && nd.source === "sentinel" ? NDVI_SCALE : ov ? [ov.lo, ov.hi] : [0, 1]; }
const ndviColour = (v) => { const [c0, c1] = ndviScale(); return ndviRamp((v - c0) / (c1 - c0 || 1)); };
const swatch = (c) => `<i class="sw" style="background:${c}"></i>`;

function ndviKey() {
  const nd = S.ndvi, ov = nd && nd.overlay; if (!ov) return "";
  const [c0, c1] = ndviScale(), pos = (v) => `${(Math.max(0, Math.min(1, (v - c0) / (c1 - c0 || 1))) * 100).toFixed(1)}%`;
  const bands = NDVI_BANDS.map(([a, b, txt]) => {
    const lo = Math.max(a, c0 > 0 ? -1 : a), mid = a < 0 ? Math.min(0.1, b) : (a + b) / 2;
    const range = a < 0 ? `below ${fmt(b, 1)}` : b >= 1 ? `above ${fmt(a, 1)}` : `${fmt(lo, 1)}–${fmt(b, 1)}`;
    const cur = ov.mean >= a && ov.mean < b ? " cur" : "";
    return `<li class="${cur}">${swatch(ndviColour(mid))}<span class="rng">${range}</span><span>${txt}</span></li>`;
  }).join("");
  return `<section><h3>Crop vigour (NDVI)</h3>
    <div class="bar" style="background:linear-gradient(90deg,${Array.from({ length: 11 }, (_, i) => ndviRamp(i / 10)).join(",")})">
      <span class="mark" style="left:${pos(ov.mean)}" title="Field average"></span></div>
    <div class="ends"><span>${fmt(c0, 1)}</span><span>${fmt(c1, 1)}</span></div>
    <ul>${bands}</ul>
    <p class="note">This field: average <b>${fmt(ov.mean, 2)}</b> (${fmt(ov.lo, 2)} to ${fmt(ov.hi, 2)}). ${nd.source === "sentinel" ? "Same colours for every date, so dates compare directly." : "Colours stretched to this file's range."}</p></section>`;
}

function soilKey() {
  const k = soilOn(); if (!k) return "";
  if (k === "clay") {
    const m = SOIL_MAPS.clay;
    return `<section><h3>Clay content, 15–30 cm</h3><img class="wms-legend" alt="Clay content legend" src="${m.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=${m.layer}&FORMAT=image/png&SLD_VERSION=1.1.0">
      <p class="note">More clay holds more water but drains slowly. Tap the map to read the value at a spot.</p></section>`;
  }
  loadSoilHere();
  const here = KEY.here || [], names = new Set(here.map((c) => c.name));
  const row = (name, p) => `<li>${swatch((WRB[name] || ["#ccc"])[0])}<span><b>${escapeHtml(name)}</b>${p != null ? ` <span class="pct">${p} %</span>` : ""}<br><span class="desc">${escapeHtml((WRB[name] || [, ""])[1])}</span></span></li>`;
  const top = here.length ? `<p class="note">Most likely at ${S.field ? "the field" : "the map centre"}:</p><ul class="soils">${here.map((c) => row(c.name, c.p)).join("")}</ul>`
    : `<p class="note">${KEY.hereErr ? escapeHtml(KEY.hereErr) : "Looking up the soil here…"}</p>`;
  const all = KEY.allSoils ? `<ul class="soils all">${Object.keys(WRB).filter((n) => !names.has(n)).map((n) => row(n, null)).join("")}</ul>` : "";
  return `<section><h3>Soil type (WRB)</h3>${top}
    <button type="button" class="link" data-act="allsoils">${KEY.allSoils ? "Hide other soil groups" : `Show all ${Object.keys(WRB).length} soil groups`}</button>${all}
    <p class="note">Tap the map to see the soil at any spot.</p></section>`;
}

// Soil groups at the field centre (or map centre): one SoilGrids call per place, kept until the place changes.
async function loadSoilHere() {
  const c = S.field ? centroidLatLng(S.field) : [map.getCenter().lat, map.getCenter().lng];
  const id = `${c[0].toFixed(3)},${c[1].toFixed(3)}`;
  if (KEY.hereFor === id) return;
  KEY.hereFor = id; KEY.here = null; KEY.hereErr = null;
  try { const r = await fetchWrb(c[0], c[1]); if (KEY.hereFor !== id) return; KEY.here = r; if (!r.length) KEY.hereErr = "No soil data here (water, town or outside the map)."; }
  catch (err) { if (KEY.hereFor !== id) return; KEY.hereErr = err.message; KEY.hereFor = null; }
  renderKey();
}

function renderKey() {
  const body = soilKey() + ndviKey();
  keyBox.hidden = !body;
  if (body) keyBox.innerHTML = `<button type="button" class="fold" data-act="fold" aria-expanded="${KEY.open}">Map key${icon(KEY.open ? "chevronDown" : "chevronRight")}</button>${KEY.open ? `<div class="key-body">${body}</div>` : ""}`;
  liftKey();
}
// On a narrow map the attribution wraps across the full width: lift the bottom-left controls above it.
function liftKey() {
  const a = map.attributionControl.getContainer(), corner = keyBox.parentNode;
  corner.style.bottom = a.offsetWidth > map.getSize().x / 2 ? `${a.offsetHeight}px` : "";
}
map.on("layeradd layerremove resize", liftKey);

// Tap the map: NDVI (when an image is shown) and the soil at that spot, whatever map layer is on.
// SoilGrids is a 250 m grid and allows about 5 calls a minute, so answers are kept per ~200 m cell.
const soilCache = new Map();
function soilAt(latlng) {
  const key = `${latlng.lat.toFixed(3)},${latlng.lng.toFixed(3)}`;
  if (!soilCache.has(key)) {
    const p = Promise.allSettled([fetchWrb(latlng.lat, latlng.lng, 3), fetchSoil(latlng.lat, latlng.lng)]);
    soilCache.set(key, p);
    p.then((r) => { if (r.some((x) => x.status === "rejected")) soilCache.delete(key); });
  }
  return soilCache.get(key);
}
async function identify(latlng) {
  const nd = S.ndvi && S.ndvi.overlay ? S.ndvi : null;
  const lines = [];
  if (nd) {
    const v = sampleRaster(nd, latlng.lat, latlng.lng, 0);
    lines.push(v == null ? "NDVI: no value here (outside the field or under cloud)" : `${swatch(ndviColour(v))} NDVI <b>${fmt(v, 2)}</b>: ${ndviBand(v)[2].toLowerCase()}`);
  }
  const pop = L.popup({ maxWidth: 280 }).setLatLng(latlng).setContent(`<div class="ident">${[...lines, "Soil: loading…"].join("<br>")}</div>`).openOn(map);
  const [wrb, tex] = await soilAt(latlng);
  const soil = [];
  if (wrb.status === "fulfilled") {
    const r = wrb.value;
    soil.push(r.length ? r.map((c, i) => `${swatch((WRB[c.name] || ["#ccc"])[0])} ${i ? "" : "Soil type <b>"}${escapeHtml(c.name)}${i ? "" : "</b>"}${c.p != null ? ` ${c.p} %` : ""}${i ? "" : `<br><span class="desc">${escapeHtml((WRB[c.name] || [, ""])[1])}</span>`}`).join("<br>") : "Soil type: no data here");
  }
  if (tex.status === "fulfilled") {
    const v = tex.value;
    soil.push(v ? `Clay <b>${fmt(v.clay, 0)} %</b>, sand ${fmt(v.sand, 0)} %, silt ${fmt(v.silt, 0)} % (0–60 cm, ${textureClass(v.sand, v.silt, v.clay)})` : "Texture: no data here");
  }
  if (!soil.length) soil.push(escapeHtml(wrb.reason.message));
  else if (soil.length < 2) soil.push("<span class=\"desc\">Part of the soil data did not load: the service is busy, tap again in a minute.</span>");
  pop.setContent(`<div class="ident">${[...lines, ...soil].join("<br>")}</div>`);
}

const ndviLayer = L.layerGroup().addTo(map);
const reliefLayer = makeReliefLayer(map);
L.control.layers({ Satellite: sat, Map: osm }, { "Place names": places, "Relief (lidar)": reliefLayer, "Soil type (WRB)": soilLayers.wrb, "Clay content": soilLayers.clay, "NDVI image": ndviLayer }, { position: "topright" }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);
map.on("overlayadd overlayremove", () => { $("soilMap").value = soilOn() || "off"; renderKey(); });
map.on("moveend", () => { if (!S.field && soilOn() === "wrb") renderKey(); });

const fieldLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);
const pivotLayer = L.layerGroup().addTo(map);
const gridLayer = L.layerGroup().addTo(map);
const sensorLayer = L.layerGroup().addTo(map);

const S = { field: null, isExample: false, fieldFromBlocks: false, mode: null, redraw: null, draft: [], ndvi: null, scenes: [], result: null };

// Example field so the tool opens in a working state (farmland in the Beauce, France).
const EXAMPLE_FIELD = [[48.2862, 1.6043], [48.2871, 1.6121], [48.2832, 1.6139], [48.2808, 1.6098], [48.2817, 1.6038]];

function clearResult() {
  const had = S.result; S.result = null; gridLayer.clearLayers(); sensorLayer.clearLayers(); $("results").hidden = true;
  if (S.check) { S.check = null; $("checkResults").hidden = true; renderProbes(); }
  if (had) roiDefaults();
}

function setField(latlngs, { fit = true, example = false, fromBlocks = false, keepNdvi = false } = {}) {
  S.field = latlngs; S.isExample = example; S.fieldFromBlocks = fromBlocks; clearResult(); renderKey();
  fieldLayer.clearLayers();
  if (!keepNdvi) {
    hideTimeline(); S.scenes = [];
    if (S.ndvi && S.ndvi.source === "sentinel") clearNdvi("The blocks changed. Search satellite images again so they cover the new blocks.");
    else if (S.ndvi) { S.ndvi.overlay = null; showNdvi(S.ndvi); }
  } else if (S.ndvi) { S.ndvi.overlay = null; showNdvi(S.ndvi); }
  $("sceneBtn").disabled = !latlngs; $("view3d").disabled = !latlngs;
  if (!latlngs) { $("fieldInfo").textContent = "No field yet."; $("analyzeBtn").disabled = true; return; }
  // Blocks are drawn on their own, so the outline around them is not drawn again.
  const poly = L.polygon(latlngs, { color: "#ffffff", weight: fromBlocks ? 0 : 2.5, fill: false, dashArray: example ? "6 6" : null, interactive: false });
  if (!fromBlocks) poly.addTo(fieldLayer);
  if (fit) map.fitBounds(poly.getBounds(), { padding: [30, 30] });
  const c = centroidLatLng(latlngs);
  $("fieldInfo").textContent = example ? "Example field shown: draw your blocks (or the whole field) to replace it."
    : fromBlocks ? `Field = the ${S.blocks.filter((b) => b.ring).length} drawn block${S.blocks.filter((b) => b.ring).length > 1 ? "s" : ""}, ${fmt(S.blocks.filter((b) => b.ring).reduce((a, b) => a + fieldAreaHa(b.ring), 0), 2)} ha · centre ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`
    : `Whole field, ${fieldAreaHa(latlngs).toFixed(2)} ha · ${latlngs.length} corners · centre ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`;
  $("soilLink").href = `https://cartes.gouv.fr/explorer-les-cartes/?c=${c[1].toFixed(5)},${c[0].toFixed(5)}&z=15&l=INRA.CARTE.SOLS$GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;
  $("analyzeBtn").disabled = false;
  if (!example) { store.set("hs.field", latlngs); store.set("hs.fieldFromBlocks", fromBlocks); }
  roiDefaults(); clipSoil();
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
// Address suggestions while typing come from the French national geocoder (IGN Géoplateforme, Base Adresse
// Nationale: addresses, streets, towns and named places). Nominatim (OpenStreetMap) is the fallback for other countries.
const setSearchStatus = (msg, err) => setStatus(msg, err, "searchStatus");
const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/;
const SUG = { items: [], active: -1, ctrl: null, timer: null };
const KIND = { housenumber: "Address", street: "Street", locality: "Place", municipality: "Town" };

async function geocodeFrance(q, signal) {
  const c = map.getCenter();
  const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&autocomplete=1&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`;
  const r = await fetch(url, { signal }); if (!r.ok) throw new Error(`geocoder answered ${r.status}`);
  const j = await r.json();
  return (j.features || []).map((f) => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const zoom = p.type === "municipality" ? 13 : p.type === "locality" ? 15 : 17;
    return { lat, lon, zoom, label: p.label, detail: [KIND[p.type], p.context].filter(Boolean).join(" · ") };
  });
}
async function geocodeWorld(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`Nominatim answered ${r.status}`);
  return (await r.json()).map((h) => ({ lat: +h.lat, lon: +h.lon, bbox: h.boundingbox.map(Number), label: h.display_name.split(",").slice(0, 3).join(","), detail: "" }));
}
function goTo(hit) {
  closeSuggest(); setSearchStatus("");
  showPin(hit.lat, hit.lon, hit.label);
  if (hit.bbox) map.fitBounds([[hit.bbox[0], hit.bbox[2]], [hit.bbox[1], hit.bbox[3]]], { maxZoom: 17 });
  else map.setView([hit.lat, hit.lon], hit.zoom || 16);
}
function closeSuggest() { $("suggest").hidden = true; $("q").setAttribute("aria-expanded", "false"); SUG.items = []; SUG.active = -1; }
function renderSuggest() {
  const ul = $("suggest");
  if (!SUG.items.length) return closeSuggest();
  ul.innerHTML = SUG.items.map((h, i) => `<li role="option" id="sug${i}" data-i="${i}" aria-selected="${i === SUG.active}"><b>${escapeHtml(h.label)}</b>${h.detail ? `<span>${escapeHtml(h.detail)}</span>` : ""}</li>`).join("");
  ul.hidden = false; $("q").setAttribute("aria-expanded", "true");
  if (SUG.active >= 0) $("q").setAttribute("aria-activedescendant", `sug${SUG.active}`); else $("q").removeAttribute("aria-activedescendant");
}
$("q").addEventListener("input", () => {
  const q = $("q").value.trim(); clearTimeout(SUG.timer);
  if (q.length < 3 || COORDS_RE.test(q)) return closeSuggest();
  SUG.timer = setTimeout(async () => {
    if (SUG.ctrl) SUG.ctrl.abort(); SUG.ctrl = new AbortController();
    try { SUG.items = await geocodeFrance(q, SUG.ctrl.signal); SUG.q = q; SUG.active = -1; renderSuggest(); }
    catch (err) { if (err.name !== "AbortError") { console.warn(err); closeSuggest(); } }
  }, 250);
});
$("q").addEventListener("keydown", (e) => {
  if ($("suggest").hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = SUG.items.length; SUG.active = e.key === "ArrowDown" ? (SUG.active + 1) % n : SUG.active <= 0 ? n - 1 : SUG.active - 1; renderSuggest(); }
  else if (e.key === "Escape") closeSuggest();
  else if (e.key === "Enter" && SUG.active >= 0) { e.preventDefault(); const h = SUG.items[SUG.active]; $("q").value = h.label; goTo(h); }
});
// mousedown (not click) so the choice lands before the input loses focus
$("suggest").addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (!li) return; e.preventDefault(); const h = SUG.items[+li.dataset.i]; $("q").value = h.label; goTo(h); });
$("q").addEventListener("blur", () => setTimeout(closeSuggest, 150));

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim(); if (!q) { searchLayer.clearLayers(); closeSuggest(); return; }
  const m = q.match(COORDS_RE);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { setSearchStatus("Coordinates must be latitude, longitude in decimal degrees, e.g. 48.2840, 1.6090.", true); return; }
    goTo({ lat, lon, zoom: 17, label: `${lat.toFixed(6)}, ${lon.toFixed(6)}` }); return;
  }
  if (SUG.items.length && SUG.q === q) return goTo(SUG.items[Math.max(0, SUG.active)]);
  setSearchStatus("Searching…"); closeSuggest();
  let hits = [];
  try { hits = await geocodeFrance(q); } catch (err) { console.warn(err); }
  if (!hits.length) { try { hits = await geocodeWorld(q); } catch (err) { console.warn(err); } }
  if (hits.length) goTo(hits[0]);
  else setSearchStatus(`No place found for "${q}". Try another spelling, a town name, or coordinates.`, true);
});

// ---------- Digital Matter device position ----------
// The Device Manager API key stays on the HSTI Logger Overview server, behind its login. This page opens its
// locate.html in a small window; that page looks the device up and posts the last GPS fix back to this page
// (only this origin can receive it). If pop-ups are blocked, it opens in this tab and comes back with the
// position in the URL hash: #device=<serial>&lat=…&lng=…&seen=…&product=… (or &error=notfound|nogps).
// HSTI Logger Overview. On placement.coccinelia.com the VPS also passes the logger's login and /api/devices
// through the same address, so the lookup stays on this origin and uses the logger's login cookie.
const LOGGER_HOSTS = ["placement.coccinelia.com", "logger.coccinelia.com"];
const LOGGER_URL = LOGGER_HOSTS.includes(location.hostname) ? location.origin : "https://logger.coccinelia.com";
const loggerUrl = () => (LOGGER_URL || store.get("hs.loggerUrl") || "").replace(/\/+$/, "");
$("loggerCfg").hidden = !!loggerUrl();
// Device lookup is only for "Check probes already installed" (a new customer has no device yet): a list of serials,
// one probe on the map per device.
const DEV = { queue: [], forProbe: false, found: 0, failed: [], total: 0 };
const devStatus = (msg, err) => setStatus(msg, err, "probeStatus");
function loggerReady() {
  if (LOGGER_URL) return true;
  const u = $("loggerUrl").value.trim() || store.get("hs.loggerUrl") || "";
  if (!/^https?:\/\/[^\s/]+/.test(u)) { $("loggerCfg").hidden = false; devStatus("Enter the HSTI Logger Overview address first (ask your admin), then try again.", true); return false; }
  store.set("hs.loggerUrl", u.replace(/\/+$/, ""));
  return true;
}
function lookupDevice(serial) {
  // Hosted on the same server as Logger Overview: read its device list directly with the logger's login cookie.
  if (sameOriginLogger()) { lookupDeviceDirect(serial); return; }
  const url = `${loggerUrl()}/locate.html?serial=${serial}`;
  const w = window.open(url, "hs-locate", "popup,width=480,height=640");
  if (!w) { store.set("hs.devQueue", DEV.forProbe ? { rest: DEV.queue, found: DEV.found, failed: DEV.failed, total: DEV.total } : null); location.href = url; return; }
  devStatus(`Looking up device ${serial} in HSTI Logger Overview… If it asks you to log in, log in there, then try again.`);
}
function sameOriginLogger() {
  try { return new URL(loggerUrl()).origin === location.origin; } catch (err) { return false; }
}
async function lookupDeviceDirect(serial) {
  devStatus(`Looking up device ${serial} in HSTI Logger Overview…${DEV.forProbe && DEV.total > 1 ? ` (${DEV.found + DEV.failed.length + 1} of ${DEV.total})` : ""}`);
  const find = async (refresh) => {
    const r = await fetch(`${loggerUrl()}/api/devices${refresh ? "?refresh=1" : ""}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const type = r.headers.get("content-type") || "";
    if (r.status === 401 || r.status === 403 || r.redirected || !type.includes("json")) throw new Error("login");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const rows = Array.isArray(data) ? data : (data.devices || data.rows || []);
    // Accept the Device Manager serial, the IMEI, the SIM ICCID or the device name, as Logger Overview does.
    const norm = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();
    const want = norm(serial), wantNum = /^\d+$/.test(want) ? String(+want) : null;
    const hit = (row) => [row.serial, row.imei, row.iccid, row.name].some((v) => {
      const n = norm(v); return n && (n === want || (wantNum && /^\d+$/.test(n) && String(+n) === wantNum));
    });
    return rows.find((row) => row && hit(row));
  };
  try {
    const row = (await find(false)) || (await find(true));
    if (!row) { showDevice({ device: serial, error: "notfound" }); return; }
    if (!row.dm) { showDevice({ device: serial, error: "nodm" }); return; }
    const { lat, lng, lastConnected, product } = row.dm;
    if (typeof lat !== "number" || typeof lng !== "number" || (lat === 0 && lng === 0)) { showDevice({ device: serial, error: "nogps" }); return; }
    showDevice({ device: serial, lat, lng, seen: lastConnected || "", product: product || "" });
  } catch (err) {
    if (err.message === "login") {
      window.open(`${loggerUrl()}/login`, "_blank");
      devStatus(`Log in to HSTI Logger Overview in the tab that just opened, then come back and press Find again.`, true);
    } else devStatus(`Could not look up device ${serial}: ${err.message}`, true);
  }
}
window.addEventListener("message", (e) => {
  let origin = null; try { origin = new URL(loggerUrl()).origin; } catch (err) { return; }
  if (e.origin !== origin || !e.data || e.data.type !== "hydrascout-device") return;
  showDevice(e.data);
});
const DEV_ERR = { nogps: "no GPS position yet", notfound: "not found in HSTI Logger Overview", nodm: "known only as a SIM card, not in Device Manager" };
function showDevice(d) {
  const serial = String(d.device || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!serial) return;
  const lat = +d.lat, lon = +d.lng;
  const bad = d.error ? DEV_ERR[d.error] || d.error
    : d.lat === "" || d.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 ? "the position received is not valid" : null;
  if (!DEV.forProbe) return; // no lookup running
  if (bad) DEV.failed.push(`${serial} (${bad})`);
  else { addProbe({ serial, name: `#${serial}`, lat, lon, how: "gps", seen: d.seen || null, product: d.product || null }, { fit: false }); DEV.found++; }
  nextDevice();
}
// Installed probes: look the serials up one after the other, then frame them all on the map.
function nextDevice() {
  const s = DEV.queue.shift();
  if (s) { lookupDevice(s); return; }
  const { found, failed } = DEV;
  DEV.forProbe = false; store.set("hs.devQueue", null); fitProbes();
  const msg = `${found ? `${found} probe${found > 1 ? "s" : ""} placed at ${found > 1 ? "their" : "its"} last GPS position.` : "No probe placed."}${failed.length ? ` Not found: ${failed.join(", ")}. Check the ID or place ${failed.length > 1 ? "them" : "it"} by hand.` : ""}${found ? " Next: draw the irrigation blocks around them." : ""}`;
  setStatus(msg, !!failed.length, "probeStatus");
}
$("probeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const ids = [...new Set($("probeIds").value.split(/[\s,;]+/).filter(Boolean))];
  const bad = ids.filter((s) => !/^[A-Za-z0-9_-]{3,24}$/.test(s));
  if (!ids.length || bad.length) { setStatus(bad.length ? `Not a device ID: ${bad.join(", ")}. Use the serial number, IMEI or SIM ICCID, as shown in HSTI Logger Overview.` : "Type at least one device ID.", true, "probeStatus"); return; }
  DEV.forProbe = true; DEV.found = 0; DEV.failed = []; DEV.total = ids.length; DEV.queue = ids.slice(1);
  store.set("hs.probeIds", $("probeIds").value);
  if (!loggerReady()) { DEV.forProbe = false; return; }
  lookupDevice(ids[0]);
});
// Coming back in this tab (pop-up blocked).
function readDeviceHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get("device")) return;
  history.replaceState(null, "", location.pathname + location.search);
  const q = store.get("hs.devQueue");
  if (q) Object.assign(DEV, { forProbe: true, queue: q.rest || [], found: q.found || 0, failed: q.failed || [], total: q.total || 1 });
  showDevice(Object.fromEntries(h));
}

// ---------- drawing ----------
// Instructions on the map while drawing, with the drawing buttons next to them (the panel can be out of view on a phone).
const DRAW_ICONS = { Undo: "arrowLeft", Finish: "check", Cancel: "cross" };
function drawbar(msg, acts = []) {
  const d = $("drawbar"); d.hidden = !msg; d.innerHTML = "";
  if (!msg) return;
  const t = document.createElement("span"); t.textContent = msg; d.appendChild(t);
  if (!acts.length) return;
  const row = document.createElement("span"); row.className = "drawbar-acts";
  for (const [label, fn, disabled] of acts) { const b = document.createElement("button"); b.type = "button"; setLabel(b, label, DRAW_ICONS[label]); b.disabled = !!disabled; b.onclick = fn; row.appendChild(b); }
  d.appendChild(row);
}
const undoPoint = () => { S.draft.pop(); renderDraft(); };
function renderDraft() {
  draftLayer.clearLayers();
  const drawing = S.mode === "draw", block = S.mode === "block", n = S.draft.length;
  if (n > 1) L.polyline(S.draft, { color: "#ffd84a", weight: 3 }).addTo(draftLayer);
  if (n > 2) L.polygon(S.draft, { color: "#ffd84a", weight: 0, fillOpacity: 0.15 }).addTo(draftLayer);
  S.draft.forEach((p, i) => {
    const mk = L.marker(p, { icon: L.divIcon({ className: "", html: '<div class="vertex-pin"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(draftLayer);
    if (i === 0) mk.on("click", (ev) => { L.DomEvent.stopPropagation(ev); finishDraw(); });
  });
  if (drawing) drawbar(n < 3 ? `Field: tap the map to add its corners (${n} so far)` : "Field: tap the first corner or Finish to close it",
    [["Undo", undoPoint, !n], ["Finish", finishDraw, n < 3], ["Cancel", () => setMode(null)]]);
  else if (block) {
    const which = `Block ${S.blocks[S.redraw].name}`;
    drawbar(n < 3 ? `${which}: tap the map to add its corners (${n} so far)` : `${which}: tap the first corner or Finish to close it`,
      [["Undo", undoPoint, !n], ["Finish", finishDraw, n < 3], ["Cancel", () => setMode(null)]]);
  } else drawbar("");
}
function setMode(mode, block = null) {
  S.mode = mode; S.draft = []; S.redraw = mode === "block" ? block : null;
  if (mode) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  map.getContainer().style.cursor = mode ? "crosshair" : "";
  $("pivCentreBtn").classList.toggle("active", mode === "pivot"); setLabel($("pivCentreBtn"), mode === "pivot" ? "Cancel" : "Place pivot centre on map", mode === "pivot" ? "cross" : "mapPin");
  if (mode !== "place") S.placeFor = null;
  $("probeAddBtn").classList.toggle("active", mode === "probe"); setLabel($("probeAddBtn"), mode === "probe" ? "Cancel" : "Place one by hand", mode === "probe" ? "cross" : "add");
  renderDraft(); if (S.blocks) renderBlockRows();
  if (mode === "pivot") drawbar("Tap the pivot centre on the map");
  if (mode === "probe") drawbar("Tap the map where the probe is installed", [["Cancel", () => setMode(null)]]);
  if (mode === "place") drawbar(`Tap the map where ${S.placeFor.name} should go`, [["Cancel", () => setMode(null)]]);
  if (S.result && !S.check) renderResult(); // the "Set by hand" buttons show the mode
}
function finishDraw() {
  if (S.draft.length < 3) return;
  const f = S.draft.slice(), bi = S.mode === "block" ? S.redraw : null;
  setMode(null);
  if (bi == null) { setField(f, { fit: false }); renderBlockRows(); return; }
  S.blocks[bi].ring = f; blocksChanged();
}
map.on("click", (e) => {
  if (S.mode === "draw" || S.mode === "block") { S.draft.push([e.latlng.lat, e.latlng.lng]); renderDraft(); }
  else if (S.mode === "pivot") { irr.pivotCentre = [e.latlng.lat, e.latlng.lng]; setMode(null); updateIrrigation(); }
  else if (S.mode === "probe") { setMode(null); addProbe({ lat: e.latlng.lat, lon: e.latlng.lng, how: "hand" }, { fit: false }); }
  else if (S.mode === "place") { const s = S.placeFor; setMode(null); placeSensor(s, e.latlng.lat, e.latlng.lng); }
  else identify(e.latlng);
});

$("fieldName").addEventListener("input", (e) => store.set("hs.fieldName", e.target.value));

// ---------- NDVI ----------
const NDVI_SCALE = [0, 0.9]; // fixed colour scale for satellite dates, so the timeline compares like with like
function showNdvi(nd) {
  ndviLayer.clearLayers();
  if (!nd.overlay && S.field) nd.overlay = ndviOverlay(nd, fieldRings(), nd.source === "sentinel" ? NDVI_SCALE : null);
  const ov = nd.overlay;
  if (ov) L.imageOverlay(ov.url, ov.bounds, { opacity: 0.9, interactive: false }).addTo(ndviLayer);
  $("ndviMeta").hidden = false;
  $("ndviMeta").textContent = ov ? `${nd.label} · field NDVI ${fmt(ov.lo, 2)} to ${fmt(ov.hi, 2)}, average ${fmt(ov.mean, 2)}` : `${nd.label} · does not cover this field`;
  renderKey();
}
function setNdvi(nd) { S.ndvi = nd; $("ndviClear").hidden = false; showNdvi(nd); if (S.result) setNdviStatus("NDVI updated. Run “Find sensor spots” again to use it."); }
function clearNdvi(msg) {
  S.ndvi = null; ndviLayer.clearLayers(); $("ndviClear").hidden = true; $("ndviMeta").hidden = true; renderKey();
  if (msg) setNdviStatus(msg);
}
function hideTimeline() { TL.playing = false; TL.token++; setLabel($("tPlay"), "Play", "play"); $("sceneRow").hidden = true; }
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
  if (!sc.nd) { sc.nd = await Sentinel.ndvi(sc, S.field); sc.nd.overlay = ndviOverlay(sc.nd, fieldRings(), NDVI_SCALE); sc.mean = sc.nd.overlay ? sc.nd.overlay.mean : null; }
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
function stopPlay() { TL.playing = false; setLabel($("tPlay"), "Play", "play"); }
$("tPlay").addEventListener("click", async () => {
  if (TL.playing) return stopPlay();
  TL.playing = true; setLabel($("tPlay"), "Pause", "pause");
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

// ---------- irrigation blocks ----------
// HSTI sizes a probe kit as one probe per irrigation block, so blocks drive the number and place of the probes.
// The block count in step 2 opens one row per block (name + Draw borders); a block counts once its borders are drawn.
const blockLayer = L.layerGroup().addTo(map);
S.blocks = []; // [{ name, ring: [[lat, lon], …] or null }]
const drawnBlocks = () => S.blocks.filter((b) => b.ring);
function nextBlockName() { const used = new Set(S.blocks.map((b) => b.name)); for (let i = 0; ; i++) { const n = i < 26 ? String.fromCharCode(65 + i) : `B${i + 1}`; if (!used.has(n)) return n; } }
// One row per block given in step 2. Fewer blocks drops the rows not drawn yet first.
function syncBlockRows() {
  const want = askedBlocks() || 0;
  while (S.blocks.length < want) S.blocks.push({ name: nextBlockName(), ring: null });
  while (S.blocks.length > want) { const k = S.blocks.map((b) => !b.ring).lastIndexOf(true); S.blocks.splice(k >= 0 ? k : S.blocks.length - 1, 1); }
}
// The drawn blocks are the field: NDVI, soil and the analysis cover them (and only them). The field polygon is the
// outline around all blocks, used to fetch data; the analysis grid keeps the points inside the blocks.
function blocksChanged() {
  clearResult();
  syncFieldToBlocks();
  renderBlocks();
}
function syncFieldToBlocks() {
  const d = drawnBlocks();
  if (d.length) {
    const hull = hullLatLng(d.flatMap((b) => b.ring));
    if (!S.fieldFromBlocks || JSON.stringify(hull) !== JSON.stringify(S.field)) setField(hull, { fit: false, fromBlocks: true });
    else setField(S.field, { fit: false, fromBlocks: true, keepNdvi: true });
  } else if (S.fieldFromBlocks) setField(EXAMPLE_FIELD, { example: true });
}
// Pixels and grid points that count: inside the drawn blocks, or inside the field drawn as a whole.
const fieldRings = () => (S.fieldFromBlocks ? drawnBlocks().map((b) => b.ring) : S.field ? [S.field] : []);
// Colours follow the drawn blocks, as in the results.
const blockColor = (b) => (b.ring ? zoneColor(drawnBlocks().indexOf(b)) : zoneColor(-1));
function renderBlocks() {
  blockLayer.clearLayers();
  drawnBlocks().forEach((b) => {
    L.polygon(b.ring, { color: blockColor(b), weight: 2.5, fillOpacity: 0.12, dashArray: "4 4", interactive: false }).addTo(blockLayer)
      .bindTooltip(escapeHtml(b.name), { permanent: true, direction: "center", offset: [0, -34], className: "block-label" });
  });
  renderBlockRows();
  const n = drawnBlocks().length, sel = $("nSensors");
  sel.disabled = n > 0;
  if (n) sel.value = "auto";
  $("autoOpt").textContent = n ? `One per irrigation block (${n})` : "Auto (by field size)";
  store.set("hs.blocks", S.blocks);
  renderNeed(); roiDefaults(); clipSoil();
}
function renderBlockRows() {
  const n = drawnBlocks().length, total = S.blocks.length, next = S.blocks.findIndex((b) => !b.ring);
  if (!total) {
    // No block count: one row to draw the whole field; the number of probes then follows its size.
    const own = S.field && !S.isExample && !S.fieldFromBlocks, drawing = S.mode === "draw", label = drawing ? "Cancel" : own ? "Redraw" : "Draw borders";
    $("blocksSummary").textContent = "No block count given: draw the whole field.";
    $("blockList").innerHTML = `<li class="${own ? "drawn" : ""}"><i class="sw" style="background:#fff;border:1px solid var(--line)"></i><span class="row-name">Whole field</span>
      <span class="ha">${own ? `${fmt(fieldAreaHa(S.field), 2)} ha` : "not drawn"}</span>
      <button type="button" data-field="1" class="${drawing ? "active" : own || S.mode ? "" : "primary-lite"}">${icon(drawing ? "cross" : "pen")}${label}</button></li>`;
    $("blockFileBtn").querySelector(".lbl").textContent = "Import field or blocks";
    return;
  }
  $("blockFileBtn").querySelector(".lbl").textContent = "Import blocks";
  $("blocksSummary").textContent = `Your ${total} block${total === 1 ? "" : "s"} · ${n === total ? (total > 1 ? "all drawn" : "drawn") : `${n} of ${total} drawn`}`;
  $("blockList").innerHTML = S.blocks.map((b, bi) => {
    const drawing = S.mode === "block" && S.redraw === bi, label = drawing ? "Cancel" : b.ring ? "Redraw" : "Draw borders";
    return `<li class="${b.ring ? "drawn" : ""}"><i class="sw" style="background:${blockColor(b)}"></i><input type="text" value="${escapeHtml(b.name)}" data-i="${bi}" aria-label="Name of block ${bi + 1}" maxlength="30">
      <span class="ha">${b.ring ? `${fmt(fieldAreaHa(b.ring), 2)} ha` : "not drawn"}</span>
      <button type="button" data-draw="${bi}" class="${drawing ? "active" : bi === next && S.mode !== "block" ? "primary-lite" : ""}" aria-label="${label}: block ${escapeHtml(b.name)}">${icon(drawing ? "cross" : "pen")}${label}</button></li>`;
  }).join("");
}
// The grower's own block count (step 2) frames the need: one probe per block. It sets the probe count when no
// block is drawn yet.
function askedBlocks() { const v = Math.round(+$("nBlocks").value); return v >= 1 ? Math.min(v, 50) : null; }
function renderNeed() {
  const want = askedBlocks(), drawn = drawnBlocks().length, sel = $("nSensors"), line = $("needLine");
  if (!drawn) {
    if (want) {
      if (![...sel.options].some((o) => o.value === String(want))) sel.add(new Option(String(want), String(want)));
      sel.value = String(want);
    } else if (sel.dataset.fromAsk) sel.value = "auto";
    sel.dataset.fromAsk = want ? "1" : "";
  }
  $("countHint").textContent = drawn ? "One probe per block drawn, plus an optional one where a block is clearly uneven."
    : want ? `Set from your number of irrigation blocks: one probe per irrigation block. Without block borders the field is split into ${want} zone${want > 1 ? "s" : ""}, one probe each.`
    : "No block map? Pick the number of irrigation blocks here: one probe per block.";
  line.hidden = !want;
  if (!want) return;
  const probes = `<b>${want} probe${want > 1 ? "s" : ""}</b>, one per block`;
  line.innerHTML = !drawn ? `You need ${probes}. Draw the borders of each block (“Draw the blocks”) so every probe lands inside its own block, away from its borders.`
    : drawn < want ? `You need ${probes}. ${drawn} of ${want} blocks drawn: blocks without borders get no probe.`
    : `You need ${probes}. All ${want} blocks are drawn.`;
}
$("nBlocks").addEventListener("input", () => {
  if (S.mode === "block") setMode(null);
  store.set("hs.nBlocks", askedBlocks()); syncBlockRows(); blocksChanged();
});
$("blockList").addEventListener("input", (e) => {
  const i = e.target.dataset.i; if (i == null) return;
  const b = S.blocks[+i]; b.name = e.target.value.trim() || nextBlockName(); clearResult(); store.set("hs.blocks", S.blocks);
  if (b.ring) blockLayer.getLayers()[drawnBlocks().indexOf(b)].setTooltipContent(escapeHtml(b.name));
});
$("blockList").addEventListener("click", (e) => {
  if (e.target.dataset.field) { setMode(S.mode === "draw" ? null : "draw"); if (S.mode && window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" }); return; }
  const d = e.target.dataset.draw; if (d == null) return;
  if (S.mode === "block" && S.redraw === +d) { setMode(null); return; }
  setMode("block", +d);
  if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" });
});
// Imported blocks fill the rows not drawn yet, then add rows; the block count follows.
$("blockFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const found = readPolygons(await f.text());
    if (!found.length) throw new Error("none");
    if (S.mode) setMode(null);
    if (!S.blocks.length && found.length === 1) {
      if (found[0].name && !$("fieldName").value) { $("fieldName").value = found[0].name; store.set("hs.fieldName", found[0].name); }
      setField(found[0].ring); renderBlockRows(); setStatus("Field imported.", false, "searchStatus"); return;
    }
    for (const p of found) {
      const row = S.blocks.find((b) => !b.ring);
      if (row) { row.ring = p.ring; if (p.name) row.name = p.name; } else S.blocks.push({ name: p.name || nextBlockName(), ring: p.ring });
    }
    $("nBlocks").value = S.blocks.length; store.set("hs.nBlocks", S.blocks.length);
    blocksChanged();
    setStatus(`${found.length} irrigation block${found.length > 1 ? "s" : ""} imported.`, false, "searchStatus");
  } catch (err) { setStatus("Could not read blocks from that file. Use a GeoJSON or KML file with one polygon per block (or one for the whole field), in WGS84 (lat/lon).", true, "searchStatus"); }
});
// Every polygon in a GeoJSON or KML file, as { name, ring: [[lat, lon], …] }.
function readPolygons(txt) {
  const out = [], close = (r) => { const a = r[0], b = r[r.length - 1]; if (a[0] === b[0] && a[1] === b[1]) r.pop(); return r; };
  if (txt.trim().startsWith("<")) {
    const doc = new DOMParser().parseFromString(txt, "application/xml");
    doc.querySelectorAll("Placemark").forEach((pm) => {
      const nm = pm.querySelector("name");
      pm.querySelectorAll("Polygon").forEach((pg) => {
        const c = pg.querySelector("outerBoundaryIs coordinates, coordinates"); if (!c) return;
        const ring = c.textContent.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((a) => a.length >= 2).map(([lon, lat]) => [lat, lon]);
        if (ring.length >= 3) out.push({ name: nm ? nm.textContent.trim() : null, ring: close(ring) });
      });
    });
    return out;
  }
  const g = JSON.parse(txt), feats = g.type === "FeatureCollection" ? g.features : g.type === "Feature" ? [g] : [{ geometry: g, properties: {} }];
  for (const ft of feats) {
    const geom = ft.geometry, props = ft.properties || {}, name = props.name || props.nom || props.block || props.secteur || null;
    const polys = !geom ? [] : geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    polys.forEach((pc) => { if (pc[0] && pc[0].length >= 3) out.push({ name: name != null ? String(name) : null, ring: close(pc[0].map(([lon, lat]) => [lat, lon])) }); });
  }
  return out;
}

// ---------- analysis ----------
async function analyze() {
  if (!S.field) return;
  const check = appMode() === "check";
  if (check && !S.probes.length) { setStatus("Add your installed probes first: type their device IDs, place them by hand or import them.", true); return; }
  const btn = $("analyzeBtn"); btn.disabled = true;
  try {
    const G = buildGrid(S.field, S.fieldFromBlocks ? drawnBlocks().map((b) => b.ring) : null), ha = G.area / 10000, pts = G.pts;
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

    S.result = computePlacement({ G, elev, soilSamples, ndvi: S.ndvi, irrigation, request: check ? String(askedBlocks() || S.probes.length) : $("nSensors").value, blocks: drawnBlocks(), fieldFromBlocks: S.fieldFromBlocks, buffer: Math.max(0, +$("buffer").value || 0) });
    if (check) runCheck(); else renderResult();
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
  sel.innerHTML = Object.entries(VIEWS).filter(([k, v]) => k === "zones" || v.get(R)).map(([k, v]) => `<option value="${k}">${k === "zones" && R.blocks ? "Irrigation blocks" : v.label}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "zones";
  renderGrid();
  sensorLayer.clearLayers();
  const list = $("sensorList"); list.innerHTML = "";
  R.sensors.forEach((s, n) => {
    const col = zoneColor(s.zone);
    // Pins can be dragged to adjust a spot; the notes and every export follow the new position.
    const mk = L.marker([s.lat, s.lon], { draggable: true, autoPan: true, title: `${s.name}: drag to move`, icon: L.divIcon({ className: `sensor-pin${s.moved ? " moved" : ""}`, html: `<span style="background:${col}">${n + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
      .bindPopup(`<b>${s.name}</b><br>${s.why.map(escapeHtml).join("<br>")}${s.tip ? `<br><i>${escapeHtml(s.tip)}</i>` : ""}`).addTo(sensorLayer);
    mk.on("dragend", () => { const ll = mk.getLatLng(); if (!placeSensor(s, ll.lat, ll.lng)) mk.setLatLng([s.lat, s.lon]); });
    const card = document.createElement("article"); card.className = `sensor${s.moved ? " moved" : ""}`;
    const coords = `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`;
    card.innerHTML = `<h3><span class="badge" style="background:${col}">${n + 1}</span>${s.name}${s.block != null ? ` <span class="tag">Block ${escapeHtml(s.block)}</span>` : ""}${s.optional ? ' <span class="tag">Optional</span>' : ""}${s.moved ? ' <span class="tag">Moved</span>' : ""}</h3>
      <div class="coords">${coords}</div>
      <ul>${s.why.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      ${s.tip ? `<p class="hint">Installation: ${escapeHtml(s.tip)}</p>` : ""}
      <div class="row"><button type="button" data-act="zoom">${icon("search")}Show</button><button type="button" data-act="copy">${icon("link")}Copy coordinates</button>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lon.toFixed(6)}">${icon("externalLink")}Navigate</a>
      <button type="button" data-act="place" class="${S.mode === "place" && S.placeFor === s ? "active" : ""}">${icon(S.mode === "place" && S.placeFor === s ? "cross" : "pen")}${S.mode === "place" && S.placeFor === s ? "Cancel" : "Set by hand"}</button>
      ${s.moved ? `<button type="button" data-act="reset">${icon("arrowLeft")}Back to recommended spot</button>` : ""}${s.optional ? `<button type="button" data-act="drop">${icon("trash")}Drop this optional probe</button>` : ""}</div>
      ${s.moved ? `<input type="text" class="reason" data-act="reason" maxlength="200" placeholder="Why here? e.g. the customer's choice, near the pump" aria-label="Why ${escapeHtml(s.name)} is placed here" value="${escapeHtml(s.reason || "")}">` : ""}`;
    card.querySelector('[data-act="zoom"]').onclick = () => { map.setView([s.lat, s.lon], Math.max(map.getZoom(), 17)); if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" }); };
    card.querySelector('[data-act="copy"]').onclick = async (ev) => { try { await navigator.clipboard.writeText(coords); setLabel(ev.currentTarget, "Copied", "check"); } catch (e) { setLabel(ev.currentTarget, coords); } };
    if (s.optional) card.querySelector('[data-act="drop"]').onclick = () => {
      R.sensors.splice(R.sensors.indexOf(s), 1); R.sensors.forEach((t, k) => { t.name = `HS-${k + 1}`; });
      setStatus(`Optional probe removed: block ${s.block} keeps one probe.`); renderResult();
    };
    if (s.moved) card.querySelector('[data-act="reset"]').onclick = () => { resetSensor(s); delete s.reason; setStatus(`${s.name} is back on the recommended spot.`); renderResult(); };
    if (s.moved) card.querySelector('[data-act="reason"]').oninput = (ev) => { s.reason = ev.target.value.trim() || null; };
    card.querySelector('[data-act="place"]').onclick = () => {
      if (S.mode === "place" && S.placeFor === s) { setMode(null); return; }
      S.placeFor = s; setMode("place"); if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" });
    };
    list.appendChild(card);
  });
  $("notes").innerHTML = R.notes.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  roiDefaults();
}
function renderGrid() {
  const R = S.result; gridLayer.clearLayers(); if (!R) return;
  const v = $("view").value || "zones", h = R.G.spacing / 2, lg = $("legend");
  let color;
  if (v === "zones" && R.blocks) {
    color = (i) => zoneColor(R.lab[i]);
    lg.innerHTML = `<div class="row">${R.blocks.map((b, bi) => `<span class="row" style="gap:4px"><span class="badge" style="background:${zoneColor(bi)};width:14px;min-width:14px;height:14px;border-width:1px"></span>Block ${escapeHtml(b.name)} · ${fmt(b.ha, 1)} ha</span>`).join("")}${R.lab.some((l) => l < 0) ? `<span class="row" style="gap:4px"><span class="badge" style="background:${zoneColor(-1)};width:14px;min-width:14px;height:14px;border-width:1px"></span>Outside blocks</span>` : ""}</div>`;
  } else if (v === "zones") {
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
// A spot set by hand (dragged, or tapped on the map after "Set by hand"): any point inside a block (or the field)
// is accepted, for instance where the customer wants it; the notes warn when it breaks a rule, such as a block border.
function placeSensor(s, lat, lon) {
  const R = S.result; if (!R) return false;
  const [x, y] = R.G.P.fwd(lat, lon);
  if (!(R.blocks ? R.blocks.some((b) => inPoly(x, y, b.xy)) : inPoly(x, y, R.G.poly))) { setStatus(`${s.name} must stay inside ${R.blocks ? "a block" : "the field"}.`, true); return false; }
  moveSensor(R, s, lat, lon);
  setStatus(`${s.name} set by hand. Add why below its card if you like: the report and the exports use this position.`);
  renderResult(); return true;
}

// ---------- return on investment ----------
// The farmer's own water and pumping figures and HSTI's probe price (entered by hand: it depends on the probe
// type and the sensors fitted). Area and probe count follow the field and the plan until typed over.
const ROI_FIELDS = { roiArea: "area", roiWater: "waterPerHa", roiWaterPrice: "waterPrice", roiFlow: "flow", roiKw: "kw", roiKwh: "kwhPrice", roiFuel: "fuelLph", roiFuelPrice: "fuelPrice", roiProbes: "probes", roiPrice: "probePrice", roiInstall: "install", roiSub: "sub", roiGrant: "grant", roiTimeWeek: "timeWeek", roiWeeks: "weeks", roiHourly: "hourly", roiFertHa: "fertHa", roiFertRate: "fertRate", roiCropHa: "cropHa", roiYield: "yieldRate" };
function readRoi() {
  const v = (id) => { const x = parseFloat($(id).value); return Number.isFinite(x) ? x : null; };
  const o = { energy: $("roiEnergy").value, rates: [v("roiLo"), v("roiMid"), v("roiHi")] };
  for (const [id, k] of Object.entries(ROI_FIELDS)) o[k] = v(id);
  return o;
}
function roiDefaults() {
  const setAuto = (id, val) => { const el = $(id); if (el.dataset.typed) return; el.value = val == null ? "" : val; };
  const d = drawnBlocks(), area = d.length ? d.reduce((a, b) => a + fieldAreaHa(b.ring), 0) : S.field && !S.isExample ? fieldAreaHa(S.field) : null;
  setAuto("roiArea", area == null ? null : +area.toFixed(1));
  setAuto("roiProbes", appMode() === "check" && S.probes.length ? S.probes.length : S.result ? S.result.sensors.length : askedBlocks() || drawnBlocks().length || null);
  renderRoi();
}
function renderRoi() {
  const e = $("roiEnergy").value;
  document.querySelectorAll(".roi-el").forEach((el) => { el.hidden = e !== "electric"; });
  document.querySelectorAll(".roi-di").forEach((el) => { el.hidden = e !== "diesel"; });
  document.querySelectorAll(".roi-pump").forEach((el) => { el.hidden = e === "none"; });
  const X = computeRoi(readRoi()), out = $("roiOut");
  if (!X) { out.innerHTML = '<p class="hint">Enter the irrigated area and the water used per year to see the savings.</p>'; return; }
  out.innerHTML = roiSummaryHtml(X) + `<p class="hint">${escapeHtml(roiBasis(X))} ${escapeHtml(roiCostText(X))}</p>
    <h3 class="sub-h">Each year, three cases</h3><div class="roi-scroll">${roiTable(X)}</div>
    <h3 class="sub-h">Over ${ROI_YEARS} years, expected case</h3><div class="roi-scroll">${roiYearsCompact(X)}</div>`;
}
document.getElementById("roiStep").addEventListener("input", (e) => {
  if (e.target.id === "roiArea" || e.target.id === "roiProbes") e.target.dataset.typed = e.target.value === "" ? "" : "1";
  const saved = { energy: $("roiEnergy").value };
  for (const id of [...Object.keys(ROI_FIELDS), "roiLo", "roiMid", "roiHi"]) saved[id] = $(id).value;
  saved.typed = ["roiArea", "roiProbes"].filter((id) => $(id).dataset.typed);
  store.set("hs.roi", saved);
  if (e.target.value === "" && (e.target.id === "roiArea" || e.target.id === "roiProbes")) roiDefaults(); else renderRoi();
});

// ---------- start choice ----------
// The app opens on one question: install new probes (find how many and where), or check probes already installed.
const MODE_NAME = { new: ["add", "Installing new probes"], check: ["check", "Checking installed probes"] };
const appMode = () => $("panel").dataset.mode || null;
function setAppMode(m) {
  if (S.mode) setMode(null);
  $("panel").dataset.mode = m || ""; store.set("hs.appMode", m || null);
  if (m) {
    $("modeName").innerHTML = `${icon(MODE_NAME[m][0])}<span>${MODE_NAME[m][1]}</span>`;
    setLabel($("analyzeBtn"), m === "check" ? "Check my probes" : "Find sensor spots", m === "check" ? "check" : "sparkles");
  }
  clearResult(); setStatus(""); renderProbes(); roiDefaults();
  $("panel").scrollTop = 0;
  if (m === "check" && S.probes.length) fitProbes();
}
$("modePick").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) setAppMode(b.dataset.mode); });
$("modeChange").addEventListener("click", () => setAppMode(null));

// ---------- installed probes ----------
// Probes already in the ground, from their device GPS, placed by hand or imported. Each can be dragged to its
// true position; once checked, the check follows the pin as it moves.
const probeLayer = L.layerGroup().addTo(map);
S.probes = []; // [{ name, serial, lat, lon, how: "gps" | "hand" | "file" }]
S.check = null;
function nextProbeName() { for (let i = 1; ; i++) { const n = `Probe ${i}`; if (!S.probes.some((q) => q.name === n)) return n; } }
function addProbe(p, { fit = true } = {}) {
  const same = p.serial && S.probes.find((q) => q.serial === p.serial);
  if (same) Object.assign(same, p); else S.probes.push({ ...p, name: p.name || nextProbeName() });
  probesChanged(); if (fit) fitProbes();
}
function probesChanged() {
  store.set("hs.probes", S.probes);
  if (S.result && appMode() === "check") runCheck(); else renderProbes();
  roiDefaults();
}
function fitProbes() {
  if (!S.probes.length) return;
  const b = L.latLngBounds(S.probes.map((p) => [p.lat, p.lon]));
  if (S.field && !S.isExample) b.extend(L.polygon(S.field).getBounds());
  map.fitBounds(b, { padding: [60, 60], maxZoom: 17 });
}
const SEV_TAG = ["good", "look", "move"];
function renderProbes() {
  probeLayer.clearLayers();
  const on = appMode() === "check", C = on && S.check, R = S.result;
  $("probeList").innerHTML = S.probes.map((p, i) => {
    const a = C && C.probes[i];
    return `<li><i class="pk${a ? ` sev${a.sev}` : ""}"></i><input type="text" value="${escapeHtml(p.name)}" data-i="${i}" aria-label="Name of probe ${i + 1}" maxlength="30">
      <span class="ha">${p.how === "gps" ? "GPS" : p.how === "file" ? "file" : "by hand"}${p.moved ? ", moved" : ""}</span>
      <button type="button" data-zoom="${i}" aria-label="Show ${escapeHtml(p.name)} on the map">${icon("search")}</button><button type="button" data-del="${i}" aria-label="Remove ${escapeHtml(p.name)}">${icon("trash")}</button></li>`;
  }).join("");
  if (!on) return;
  if (C) {
    // Recommended spots (hollow, numbered) and a dashed line from each probe that should move to where it could go.
    R.sensors.forEach((s, n) => L.marker([s.lat, s.lon], { keyboard: false, zIndexOffset: -100, icon: L.divIcon({ className: "rec-pin", html: `<span>${n + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
      .bindPopup(`<b>Recommended spot ${s.name}</b>${s.block != null ? ` · block ${escapeHtml(s.block)}` : ""}${s.optional ? " (optional)" : ""}<br>${s.why.map(escapeHtml).join("<br>")}`).addTo(probeLayer));
    C.probes.forEach((a) => { if (a.sev && a.ref && a.move >= 3) L.polyline([[a.lat, a.lon], [a.ref.s.lat, a.ref.s.lon]], { color: a.sev === 2 ? "#d0453a" : "#e0a02a", weight: 2.5, dashArray: "6 6", interactive: false }).addTo(probeLayer); });
  }
  S.probes.forEach((p, i) => {
    const a = C && C.probes[i];
    const mk = L.marker([p.lat, p.lon], { draggable: true, autoPan: true, title: `${p.name}: drag to its true position`, icon: L.divIcon({ className: "probe-pin", html: `<i class="pk${a ? ` sev${a.sev}` : ""}"></i>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .bindTooltip(escapeHtml(p.name), { permanent: true, direction: "right", offset: [10, 0], className: "probe-label" }).addTo(probeLayer);
    if (a) mk.bindPopup(`<b>${escapeHtml(p.name)}</b>: ${a.verdict}<br>${a.lines.map(escapeHtml).join("<br>")}${a.suggest ? `<br><i>${escapeHtml(a.suggest)}</i>` : ""}`);
    mk.on("dragend", () => { const ll = mk.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; p.moved = true; probesChanged(); });
  });
}
$("probeList").addEventListener("input", (e) => {
  const i = e.target.dataset.i; if (i == null) return;
  S.probes[+i].name = e.target.value.trim() || nextProbeName(); store.set("hs.probes", S.probes);
  const lay = probeLayer.getLayers().filter((l) => l.options.draggable)[+i]; if (lay) lay.setTooltipContent(escapeHtml(S.probes[+i].name));
});
$("probeList").addEventListener("change", () => { if (S.check) runCheck(); });
$("probeList").addEventListener("click", (e) => {
  const z = e.target.dataset.zoom, d = e.target.dataset.del;
  if (z != null) { const p = S.probes[+z]; map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17)); if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" }); }
  if (d != null) { S.probes.splice(+d, 1); probesChanged(); }
});
$("probeAddBtn").addEventListener("click", () => { setMode(S.mode === "probe" ? null : "probe"); if (S.mode && window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" }); });
$("probeFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  let pts = [];
  try { pts = readPoints(await f.text()); } catch (err) { console.warn(err); }
  if (!pts.length) { setStatus("No probe position found in that file. Use a CSV with lat and lon columns (name or serial optional), or a GPX, KML or GeoJSON file of points, in WGS84.", true, "probeStatus"); return; }
  pts.forEach((p) => addProbe({ ...p, how: "file" }, { fit: false }));
  fitProbes(); setStatus(`${pts.length} probe${pts.length > 1 ? "s" : ""} imported.`, false, "probeStatus");
});
// Points from a CSV (lat/lon columns, or lat, lon[, name] without a header), GPX waypoints, KML or GeoJSON points.
function readPoints(txt) {
  const t = txt.replace(/^﻿/, "").trim(), out = [];
  const add = (lat, lon, name, serial) => { lat = +lat; lon = +lon; if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) out.push({ lat, lon, name: name ? String(name).trim() : null, serial: serial && /^\d{4,15}$/.test(String(serial).trim()) ? String(serial).trim() : null }); };
  if (t.startsWith("<")) {
    const doc = new DOMParser().parseFromString(t, "application/xml"), txtOf = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent : null; };
    doc.querySelectorAll("wpt").forEach((w) => add(w.getAttribute("lat"), w.getAttribute("lon"), txtOf(w, "name")));
    doc.querySelectorAll("Placemark").forEach((pm) => { const c = txtOf(pm, "Point coordinates"); if (c) { const [lon, lat] = c.trim().split(","); add(lat, lon, txtOf(pm, "name")); } });
    return out;
  }
  if (t.startsWith("{") || t.startsWith("[")) {
    const g = JSON.parse(t), feats = g.type === "FeatureCollection" ? g.features : g.type === "Feature" ? [g] : [];
    for (const f of feats) {
      const pr = f.properties || {}, gm = f.geometry || {};
      if (pr.kind === "field") continue;
      const pts = gm.type === "Point" ? [gm.coordinates] : gm.type === "MultiPoint" ? gm.coordinates : [];
      pts.forEach(([lon, lat]) => add(lat, lon, pr.name || pr.nom, pr.serial || pr.device || pr.id));
    }
    return out;
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim()), delim = [";", "\t", ","].find((d) => lines[0].includes(d)) || ",";
  const cells = (l) => { const r = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === delim) { r.push(cur); cur = ""; } else cur += ch; } r.push(cur); return r.map((c) => c.trim()); };
  const head = cells(lines[0]).map((h) => h.toLowerCase()), col = (...names) => head.findIndex((h) => names.includes(h));
  let iLat = col("lat", "latitude", "y"), iLon = col("lon", "lng", "long", "longitude", "x"), iName = col("name", "nom", "label"), iSer = col("serial", "device", "device id", "id", "imei");
  const num = (s) => s.replace(",", ".");
  if (iLat < 0 || iLon < 0) { iLat = 0; iLon = 1; iName = 2; iSer = -1; } else lines.shift();
  for (const l of lines) { const c = cells(l); add(num(c[iLat] || ""), num(c[iLon] || ""), iName >= 0 ? c[iName] : null, iSer >= 0 ? c[iSer] : null); }
  return out;
}

// ---------- probe check ----------
function runCheck() {
  S.check = assessProbes(S.result, S.probes);
  renderCheck(); renderProbes(); roiDefaults();
}
function renderCheck() {
  const R = S.result, C = S.check; if (!R || !C) return;
  $("results").hidden = true; $("checkResults").hidden = false;
  $("view").innerHTML = '<option value="zones">Zones</option>'; renderGrid(); // light zone shading under the probes
  const [g, l, m] = C.counts, n = C.probes.length;
  $("checkHeadline").innerHTML = `<b>${n} probe${n > 1 ? "s" : ""} checked:</b> ${[g && `${g} well placed`, l && `${l} worth a look`, m && `${m} should move`].filter(Boolean).join(", ")}.`
    + (C.missing.length ? ` <b>${C.missing.length} ${R.blocks ? "block" : "zone"}${C.missing.length > 1 ? "s have" : " has"} no probe.</b>` : "");
  const list = $("checkList"); list.innerHTML = "";
  C.probes.forEach((a, i) => {
    const p = S.probes[i], card = document.createElement("article"); card.className = `sensor check sev${a.sev}`;
    const coords = `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`, t = a.ref && a.ref.s;
    card.innerHTML = `<h3><i class="pk sev${a.sev}"></i>${escapeHtml(a.name)} <span class="tag v-${SEV_TAG[a.sev]}">${a.verdict}</span>${a.inside && R.blocks ? ` <span class="tag">Block ${escapeHtml(R.blocks[a.zone].name)}</span>` : ""}</h3>
      <div class="coords">${coords}${p.serial ? ` · device ${p.serial}` : ""}${a.edge != null ? ` · ${fmt(a.edge, 0)} m from the border` : ""}</div>
      <ul>${a.lines.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      ${a.suggest ? `<p class="suggest">${escapeHtml(a.suggest)}</p>` : ""}
      <div class="row"><button type="button" data-act="zoom">${icon("search")}Show</button>
      ${t && a.sev && a.move >= 3 ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${t.lat.toFixed(6)},${t.lon.toFixed(6)}">${icon("externalLink")}Navigate to ${t.name}</a>
      <button type="button" data-act="try">${icon("mapPin")}Try it at ${t.name}</button>` : ""}</div>`;
    card.querySelector('[data-act="zoom"]').onclick = () => { map.setView([a.lat, a.lon], Math.max(map.getZoom(), 17)); if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" }); };
    const tr = card.querySelector('[data-act="try"]');
    if (tr) tr.onclick = () => { p.lat = t.lat; p.lon = t.lon; p.moved = true; setStatus(`${p.name} moved to ${t.name} to see the result. Drag it back, or remove and add it again, to undo.`); probesChanged(); };
    list.appendChild(card);
  });
  const miss = C.missing.map((s) => `<li><b>${s.block != null ? `Block ${escapeHtml(s.block)}` : `Zone ${s.zone + 1}`} has no probe.</b> Recommended spot ${s.name}: ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}. <button type="button" class="link" data-add="${R.sensors.indexOf(s)}">Add a probe there</button></li>`)
    .concat(C.optional.map((s) => `<li>Block ${escapeHtml(s.block)} is uneven (${escapeHtml(s.uneven)}). An optional second probe at ${s.name} would show whether that part needs different watering. <button type="button" class="link" data-add="${R.sensors.indexOf(s)}">Add a probe there</button></li>`));
  $("checkMissing").innerHTML = miss.length ? `<h3 class="sub-h">Missing probes</h3><ul class="missing">${miss.join("")}</ul>` : "";
  $("checkNotes").innerHTML = R.notes.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
}
$("checkMissing").addEventListener("click", (e) => {
  const k = e.target.dataset.add; if (k == null) return;
  const s = S.result.sensors[+k]; addProbe({ lat: s.lat, lon: s.lon, how: "hand", name: `New ${s.name}` }, { fit: false });
});
const checkCtx = () => ({ ...exportCtx(), check: S.check, probes: S.probes });
$("dlCheckReport").onclick = () => S.check && openReport(S.result, checkCtx());
$("dlCheckCsv").onclick = () => S.check && exportCheckCsv(S.result, checkCtx());

// ---------- tabs ----------
// Probe placement and the return on investment are two tabs of the panel, so each stays short.
function showTab(t) {
  $("panel").dataset.tab = t;
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  store.set("hs.tab", t);
}
document.querySelector(".tabs").addEventListener("click", (e) => { const t = e.target.dataset.tab; if (t) { showTab(t); $("panel").scrollTop = 0; } });
$("toRoi").addEventListener("click", () => { showTab("roi"); $("panel").scrollTop = 0; $("roiStep").scrollIntoView({ behavior: "smooth" }); });

// ---------- exports ----------
const exportCtx = () => ({ field: S.field, fieldName: $("fieldName").value.trim(), askedBlocks: askedBlocks(), roi: computeRoi(readRoi()) });
$("dlReport").onclick = () => S.result && openReport(S.result, exportCtx());
$("dlReportRoi").onclick = () => { if (S.check) openReport(S.result, checkCtx()); else if (S.result) openReport(S.result, exportCtx()); else { showTab("place"); setStatus("Find the sensor spots (or check your probes) first, then open the report."); } };
$("dlGpx").onclick = () => S.result && exportGpx(S.result, exportCtx());
$("dlCsv").onclick = () => S.result && exportCsv(S.result, exportCtx());
$("dlGeo").onclick = () => S.result && exportGeoJson(S.result, exportCtx());

// ---------- start ----------
(function start() {
  showTab(store.get("hs.tab") === "roi" ? "roi" : "place");
  const roi = store.get("hs.roi");
  if (roi) {
    $("roiEnergy").value = roi.energy || "electric";
    for (const id of [...Object.keys(ROI_FIELDS), "roiLo", "roiMid", "roiHi"]) if (roi[id] != null && roi[id] !== "") $(id).value = roi[id];
    for (const id of roi.typed || []) $(id).dataset.typed = "1";
  }
  const saved = store.get("hs.field");
  if (Array.isArray(saved) && saved.length >= 3) setField(saved, { fromBlocks: !!store.get("hs.fieldFromBlocks") }); else setField(EXAMPLE_FIELD, { example: true });
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
  const nb = store.get("hs.nBlocks"); if (nb >= 1) $("nBlocks").value = nb;
  const sb = store.get("hs.blocks");
  if (Array.isArray(sb)) S.blocks = sb.filter((b) => b && typeof b.name === "string").map((b) => ({ name: b.name, ring: Array.isArray(b.ring) && b.ring.length >= 3 ? b.ring : null }));
  if (S.blocks.length && !askedBlocks()) $("nBlocks").value = S.blocks.length;
  syncBlockRows();
  syncFieldToBlocks(); // drawn blocks always define the field (older saves could keep a separate outline)
  renderBlocks();
  const sp = store.get("hs.probes");
  if (Array.isArray(sp)) S.probes = sp.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => ({ ...p, name: String(p.name || "Probe") }));
  $("probeIds").value = store.get("hs.probeIds") || "";
  const am = store.get("hs.appMode");
  setAppMode(am === "new" || am === "check" ? am : null);
  readDeviceHash();
})();

// ---------- 3D view ----------
// The drawn blocks (or the whole field) on a lidar terrain model, with the probe spots when there are some.
function open3d() {
  if (!S.field) return;
  const rings = S.fieldFromBlocks ? drawnBlocks().map((b) => ({ name: `Block ${b.name}`, color: blockColor(b), ring: b.ring }))
    : [{ name: S.isExample ? "Example field" : "Field", color: "#ffffff", ring: S.field }];
  const check = appMode() === "check";
  const spots = check ? S.probes.map((p, i) => ({ label: String(i + 1), color: "#2f6b45", lat: p.lat, lon: p.lon }))
    : S.result ? S.result.sensors.map((s, i) => ({ label: String(i + 1), color: zoneColor(s.zone), lat: s.lat, lon: s.lon })) : [];
  if (window.innerWidth <= 760) $("mapwrap").scrollIntoView({ behavior: "smooth" });
  View3D.open({ rings, spots, ndvi: S.ndvi && S.ndvi.overlay });
}
$("view3d").addEventListener("click", open3d);
$("view3dRes").addEventListener("click", open3d);
$("view3dChk").addEventListener("click", open3d);
