"use strict";
// Exports: GPX, CSV, GeoJSON and a printable placement report (HTML).

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const slug = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fileBase = (ctx) => `hydrascout-${slug(ctx.fieldName) || "field"}-${stamp()}`;
// Zone number, or block name when the spots follow irrigation blocks; optional probes are flagged.
const zoneOf = (s) => (s.block != null ? s.block : String(s.zone + 1));
const optTag = (s) => (s.optional ? " (optional)" : "");
const sensorText = (s) => s.why.concat(s.tip ? [s.tip] : []).join(" ");

function irrigationSummary(irr) {
  if (!irr || irr.type === "none") return "Not irrigated";
  const parts = [IRRIGATION_LABELS[irr.type]];
  if (irr.type === "drip") { if (irr.emitter) parts.push(`emitters every ${irr.emitter} cm`); if (irr.lineSpacing) parts.push(`lines ${irr.lineSpacing} cm apart`); if (irr.flow) parts.push(`${irr.flow} L/h per emitter`); }
  if ((irr.type === "micro" || irr.type === "sprinkler") && irr.spacing) parts.push(`heads ${irr.spacing} m apart`);
  if ((irr.type === "pivot" || irr.type === "linear") && irr.pivot) {
    if (irr.pivot.radius) parts.push(`${irr.type === "pivot" ? "radius" : "length"} ${irr.pivot.radius} m`);
    if (irr.pivot.span) parts.push(`spans of ${irr.pivot.span} m`);
    if (irr.type === "pivot" && irr.pivot.lat != null) parts.push(`centre ${irr.pivot.lat.toFixed(5)}, ${irr.pivot.lon.toFixed(5)}`);
  }
  if (irr.notes) parts.push(irr.notes);
  return parts.join(", ");
}

function exportGpx(R, ctx) {
  const w = R.sensors.map((s) => `  <wpt lat="${s.lat.toFixed(7)}" lon="${s.lon.toFixed(7)}"><name>${s.name}</name><desc>${escapeHtml(sensorText(s))}</desc></wpt>`).join("\n");
  const trk = ctx.field.concat([ctx.field[0]]).map(([a, b]) => `      <trkpt lat="${a.toFixed(7)}" lon="${b.toFixed(7)}"/>`).join("\n");
  download(`${fileBase(ctx)}.gpx`, "application/gpx+xml", `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hydrascout Placement" xmlns="http://www.topografix.com/GPX/1/1">\n${w}\n  <trk><name>${escapeHtml(ctx.fieldName || "Field boundary")}</name><trkseg>\n${trk}\n  </trkseg></trk>\n</gpx>\n`);
}

function exportCsv(R, ctx) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["name", "lat", "lon", "zone", "zone_share_pct", "elevation_m", "slope_pct", "clay_pct", "sand_pct", "ndvi", "dist_to_edge_m", "pivot_dist_m", "moved_by_hand", "optional", "why", "install_tip"]];
  R.sensors.forEach((s) => rows.push([s.name, s.lat.toFixed(7), s.lon.toFixed(7), q(zoneOf(s)), fmt(s.share * 100, 0), fmt(R.T.elev[s.i], 1), fmt(R.T.slope[s.i], 2),
    R.soil ? fmt(R.soil.clay[s.i], 1) : "", R.soil ? fmt(R.soil.sand[s.i], 1) : "", R.ndvi ? fmt(R.ndvi[s.i], 3) : "", fmt(s.edge, 0),
    R.piv ? fmt(R.piv[s.i].d, 0) : "", s.moved ? "yes" : "no", s.optional ? "yes" : "no", q(s.why.join(" ")), q(s.tip || "")]));
  download(`${fileBase(ctx)}.csv`, "text/csv", "﻿" + rows.map((r) => r.join(",")).join("\n") + "\n");
}

function exportGeoJson(R, ctx) {
  const ring = ctx.field.concat([ctx.field[0]]).map(([a, b]) => [b, a]);
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { kind: "field", name: ctx.fieldName || null, area_ha: +R.ha.toFixed(3), irrigation: irrigationSummary(R.irrigation), ndvi_source: R.ndviInfo ? R.ndviInfo.label : null }, geometry: { type: "Polygon", coordinates: [ring] } },
    ...R.sensors.map((s) => ({ type: "Feature", properties: { kind: "sensor", name: s.name, moved_by_hand: !!s.moved, optional: !!s.optional, zone: zoneOf(s), zone_share: +s.share.toFixed(3), why: s.why, install_tip: s.tip }, geometry: { type: "Point", coordinates: [+s.lon.toFixed(7), +s.lat.toFixed(7)] } })),
  ] };
  download(`${fileBase(ctx)}.geojson`, "application/geo+json", JSON.stringify(fc, null, 2));
}

// Plan view of the field with zones and sensors, drawn in local metres.
function fieldSvg(R, ctx) {
  const P = R.G.P, ring = ctx.field.map(([a, b]) => P.fwd(a, b)), h = R.G.spacing / 2;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const pad = 20, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const W = 640, H = Math.max(240, Math.min(720, (W * (y1 - y0)) / (x1 - x0))), sc = Math.min(W / (x1 - x0), H / (y1 - y0));
  const X = (x) => (x - x0) * sc, Y = (y) => H - (y - y0) * sc;
  const cells = R.pts.map((p, i) => `<rect x="${X(p.x - h).toFixed(1)}" y="${Y(p.y + h).toFixed(1)}" width="${(2 * h * sc + 0.6).toFixed(1)}" height="${(2 * h * sc + 0.6).toFixed(1)}" fill="${zoneColor(R.lab[i])}" fill-opacity="0.45"/>`).join("");
  let pivot = "";
  if (R.piv && R.irrigation.pivot) { const [cx, cy] = P.fwd(R.irrigation.pivot.lat, R.irrigation.pivot.lon); pivot = `<circle cx="${X(cx)}" cy="${Y(cy)}" r="${R.irrigation.pivot.radius * sc}" fill="none" stroke="#2f7fbf" stroke-width="1.5" stroke-dasharray="6 4"/>`; }
  const sens = R.sensors.map((s) => { const [px, py] = P.fwd(s.lat, s.lon); return `<g><circle cx="${X(px)}" cy="${Y(py)}" r="11" fill="${zoneColor(s.zone)}" stroke="#fff" stroke-width="2.5"/><text x="${X(px)}" y="${Y(py) + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${R.sensors.indexOf(s) + 1}</text></g>`; }).join("");
  const nice = [10, 20, 50, 100, 200, 500, 1000].find((m) => m * sc > 60) || 1000;
  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="100%" role="img" aria-label="Field plan with sensor positions" style="max-width:${W}px;background:#f3f5f1;border-radius:6px">
    ${cells}${pivot}<polygon points="${ring.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="#1d2a22" stroke-width="2"/>${sens}
    <g transform="translate(${W - 30},28)"><path d="M0,-16 L7,6 L0,1 L-7,6 Z" fill="#1d2a22"/><text y="20" text-anchor="middle" font-size="12" fill="#1d2a22">N</text></g>
    <g transform="translate(14,${H - 14})"><rect width="${nice * sc}" height="4" fill="#1d2a22"/><text y="-5" font-size="11" fill="#1d2a22">${nice} m</text></g></svg>`;
}

function reportHtml(R, ctx) {
  const c = centroidLatLng(ctx.field), title = ctx.fieldName ? `Sensor placement – ${ctx.fieldName}` : "Sensor placement";
  const sm = R.summary;
  const dataRows = [
    ["Field", `${ctx.fieldName ? escapeHtml(ctx.fieldName) + ", " : ""}${fmt(R.ha, 2)} ha, centre ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`],
    ["Elevation", `Copernicus DEM GLO-90 (via Open-Meteo): ${fmt(sm.eMin, 0)}–${fmt(sm.eMax, 0)} m, mean slope ${fmt(sm.fSlope, 1)}%`],
    ["Soil", R.soil ? `ISRIC SoilGrids 2.0, 0–60 cm: about ${fmt(sm.fClay, 0)}% clay on average` : "Not loaded"],
    ["NDVI", R.ndviInfo ? `${escapeHtml(R.ndviInfo.label)}${R.ndviInfo.cloud != null ? ` (scene cloud cover ${fmt(R.ndviInfo.cloud, 0)}%)` : ""}, field average ${fmt(sm.fNdvi, 2)}` : "Not used"],
    ["Irrigation", escapeHtml(irrigationSummary(R.irrigation))],
    ["Sensors", `${R.sensors.length}${R.blocks ? ` for ${R.blocks.length} irrigation block${R.blocks.length > 1 ? "s" : ""} (one per block${R.sensors.some((s) => s.optional) ? ", plus optional ones for uneven blocks" : ""})` : ""}, at least ${R.buffer} m from the field edge where possible`],
  ];
  const table = R.sensors.map((s) => `<tr><td><b style="color:${zoneColor(s.zone)}">●</b> ${s.name}${optTag(s)}${s.moved ? " (moved)" : ""}</td><td>${s.lat.toFixed(6)}</td><td>${s.lon.toFixed(6)}</td><td>${escapeHtml(zoneOf(s))} (${fmt(s.share * 100, 0)}%)</td><td>${fmt(R.T.elev[s.i], 0)} m</td><td>${R.soil ? fmt(R.soil.clay[s.i], 0) + "%" : "–"}</td><td>${R.ndvi ? fmt(R.ndvi[s.i], 2) : "–"}</td></tr>`).join("");
  const cards = R.sensors.map((s) => `<section class="s"><h3><span style="background:${zoneColor(s.zone)}">${R.sensors.indexOf(s) + 1}</span>${s.name}${optTag(s)}</h3>
    <p class="mono">${s.lat.toFixed(6)}, ${s.lon.toFixed(6)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lon.toFixed(6)}">directions</a></p>
    <p class="lbl">Why here</p><ul>${s.why.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
    ${s.tip ? `<p class="lbl">Installation</p><p>${escapeHtml(s.tip)}</p>` : ""}
    <p class="lbl">Installed on (fill in on site)</p><p class="blank">Date: ____________ &nbsp; Depth(s): ____________ &nbsp; Serial no.: ____________</p></section>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2a22;background:#fff;margin:0 auto;max-width:820px;padding:24px 16px}
h1{font-size:26px;margin:0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#5c6b61;margin:28px 0 8px}
.sub{color:#5c6b61;margin:4px 0 0}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#5c6b61}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:0}dt{color:#5c6b61}dd{margin:0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #dde3dc}th{color:#5c6b61;font-weight:600}
.wrap{overflow-x:auto}.s{border:1px solid #dde3dc;border-radius:8px;padding:12px 14px;margin:10px 0;break-inside:avoid}
.s h3{margin:0 0 4px;display:flex;align-items:center;gap:8px;font-size:17px}.s h3 span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;color:#fff;font-size:12px}
.s ul{margin:4px 0 8px;padding-left:20px}.lbl{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#5c6b61;margin:8px 0 0}.blank{color:#5c6b61}
.notes{color:#5c6b61;font-size:13px}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #2f6b45;background:#2f6b45;color:#fff;cursor:pointer}
.legend{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;margin-top:6px}.legend b{font-size:16px}
@media print{button{display:none}body{padding:0}a{color:inherit}}
</style></head><body>
<header><h1>${escapeHtml(title)}</h1><p class="sub">Hydrascout soil &amp; temperature sensors · HSTI France · generated ${new Date().toLocaleDateString()}</p>
<p><button onclick="window.print()">Print or save as PDF</button></p></header>
<h2>Field and data used</h2><dl>${dataRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
<h2>Plan</h2>${fieldSvg(R, ctx)}
<div class="legend">${R.blocks ? R.blocks.map((b, bi) => `<span><b style="color:${zoneColor(bi)}">■</b> Block ${escapeHtml(b.name)} · ${fmt(b.ha, 1)} ha · ${R.sensors.filter((s) => s.zone === bi).map((s) => s.name + optTag(s)).join(", ") || "no probe"}</span>`).join("")
  : R.sensors.map((s) => `<span><b style="color:${zoneColor(s.zone)}">■</b> Zone ${s.zone + 1} · ${fmt(s.share * 100, 0)}% · ${s.name}</span>`).join("")}</div>
<h2>Sensor positions</h2><div class="wrap"><table><thead><tr><th>Sensor</th><th>Latitude</th><th>Longitude</th><th>${R.blocks ? "Block" : "Zone"} (share)</th><th>Elevation</th><th>Clay</th><th>NDVI</th></tr></thead><tbody>${table}</tbody></table></div>
<h2>Why each spot was chosen</h2>${cards}
<h2>Method and limits</h2><ul class="notes"><li>The field is sampled on a regular grid. Each point gets elevation, slope, relative position (hollow or rise), soil texture, NDVI and irrigation coverage when available. ${R.blocks ? "Each irrigation block gets one probe at its most typical point, away from the field edge; a block made of two clearly different parts gets an optional second probe." : "Points are grouped into zones with similar conditions, and each sensor sits at the most typical point of its zone, away from the field edge."}</li>${R.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
</body></html>`;
  return html;
}

// Opens the report in a new tab (to read, print or save as PDF); downloads it if pop-ups are blocked.
function openReport(R, ctx) {
  const html = reportHtml(R, ctx), url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(url, "_blank");
  if (!w) download(`${fileBase(ctx)}-report.html`, "text/html", html);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
