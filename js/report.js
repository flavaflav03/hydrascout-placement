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
const sensorText = (s) => s.why.concat(s.reason ? [`Placed here: ${s.reason}.`] : [], s.tip ? [s.tip] : []).join(" ");

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
  if (irr.rowBearing != null) parts.push(`rows ${irr.rowBearing}° from north`);
  if (irr.notes) parts.push(irr.notes);
  return parts.join(", ");
}

function exportGpx(R, ctx) {
  const w = R.sensors.map((s) => `  <wpt lat="${s.lat.toFixed(7)}" lon="${s.lon.toFixed(7)}"><name>${s.name}</name><desc>${escapeHtml(sensorText(s))}</desc></wpt>`).join("\n");
  const trk = ctx.field.concat([ctx.field[0]]).map(([a, b]) => `      <trkpt lat="${a.toFixed(7)}" lon="${b.toFixed(7)}"/>`).join("\n");
  download(`${fileBase(ctx)}.gpx`, "application/gpx+xml", `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="HydraScout Placement" xmlns="http://www.topografix.com/GPX/1/1">\n${w}\n  <trk><name>${escapeHtml(ctx.fieldName || "Field boundary")}</name><trkseg>\n${trk}\n  </trkseg></trk>\n</gpx>\n`);
}

function exportCsv(R, ctx) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["name", "lat", "lon", "zone", "zone_share_pct", "elevation_m", "slope_pct", "clay_pct", "sand_pct", "ndvi", "dist_to_edge_m", "pivot_dist_m", "moved_by_hand", "optional", "why", "install_tip", "placed_here_because"]];
  R.sensors.forEach((s) => rows.push([s.name, s.lat.toFixed(7), s.lon.toFixed(7), q(zoneOf(s)), fmt(s.share * 100, 0), fmt(R.T.elev[s.i], 1), fmt(R.T.slope[s.i], 2),
    R.soil ? fmt(R.soil.clay[s.i], 1) : "", R.soil ? fmt(R.soil.sand[s.i], 1) : "", R.ndvi ? fmt(R.ndvi[s.i], 3) : "", fmt(s.edge, 0),
    R.piv ? fmt(R.piv[s.i].d, 0) : "", s.moved ? "yes" : "no", s.optional ? "yes" : "no", q(s.why.join(" ")), q(s.tip || ""), q(s.reason || "")]));
  download(`${fileBase(ctx)}.csv`, "text/csv", "﻿" + rows.map((r) => r.join(",")).join("\n") + "\n");
}

function exportGeoJson(R, ctx) {
  const ring = ctx.field.concat([ctx.field[0]]).map(([a, b]) => [b, a]);
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { kind: "field", name: ctx.fieldName || null, area_ha: +R.ha.toFixed(3), irrigation: irrigationSummary(R.irrigation), ndvi_source: R.ndviInfo ? R.ndviInfo.label : null }, geometry: { type: "Polygon", coordinates: [ring] } },
    ...R.sensors.map((s) => ({ type: "Feature", properties: { kind: "sensor", name: s.name, moved_by_hand: !!s.moved, placed_here_because: s.reason || null, optional: !!s.optional, zone: zoneOf(s), zone_share: +s.share.toFixed(3), why: s.why, install_tip: s.tip }, geometry: { type: "Point", coordinates: [+s.lon.toFixed(7), +s.lat.toFixed(7)] } })),
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
  const SEVC = ["#3f9a52", "#e0a02a", "#d0453a"];
  const probes = ctx.check ? ctx.check.probes.map((a, n) => { const [px, py] = P.fwd(a.lat, a.lon); let line = "";
    if (a.sev && a.ref && a.move >= 3) { const [tx, ty] = P.fwd(a.ref.s.lat, a.ref.s.lon); line = `<line x1="${X(px)}" y1="${Y(py)}" x2="${X(tx)}" y2="${Y(ty)}" stroke="${SEVC[a.sev]}" stroke-width="2" stroke-dasharray="5 4"/>`; }
    return `${line}<g><rect x="${X(px) - 9}" y="${Y(py) - 9}" width="18" height="18" rx="3" transform="rotate(45 ${X(px)} ${Y(py)})" fill="${SEVC[a.sev]}" stroke="#fff" stroke-width="2.5"/><text x="${X(px) + 14}" y="${Y(py) + 4}" font-size="12" font-weight="700" fill="#1e2d40">${escapeHtml(a.name)}</text></g>`; }).join("") : "";
  const sensFinal = ctx.check ? R.sensors.map((s) => { const [px, py] = P.fwd(s.lat, s.lon); return `<g><circle cx="${X(px)}" cy="${Y(py)}" r="10" fill="#fff" fill-opacity=".85" stroke="${zoneColor(s.zone)}" stroke-width="3"/><text x="${X(px)}" y="${Y(py) + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#1e2d40">${R.sensors.indexOf(s) + 1}</text></g>`; }).join("") + probes : sens;
  const nice = [10, 20, 50, 100, 200, 500, 1000].find((m) => m * sc > 60) || 1000;
  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="100%" role="img" aria-label="Field plan with sensor positions" style="max-width:${W}px;background:#f3f5f1;border-radius:6px">
    ${cells}${pivot}${(R.blocks ? R.blocks.map((b) => b.xy) : [ring]).map((r) => `<polygon points="${r.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="#1e2d40" stroke-width="2"/>`).join("")}${sensFinal}
    <g transform="translate(${W - 30},28)"><path d="M0,-16 L7,6 L0,1 L-7,6 Z" fill="#1e2d40"/><text y="20" text-anchor="middle" font-size="12" fill="#1e2d40">N</text></g>
    <g transform="translate(14,${H - 14})"><rect width="${nice * sc}" height="4" fill="#1e2d40"/><text y="-5" font-size="11" fill="#1e2d40">${nice} m</text></g></svg>`;
}

function reportHtml(R, ctx) {
  const C = ctx.check, c = centroidLatLng(ctx.field), kind = C ? "Probe position check" : "Sensor placement", title = ctx.fieldName ? `${kind} – ${ctx.fieldName}` : kind;
  const sm = R.summary, X = ctx.roi, fine = !!(R.elevInfo && R.elevInfo.res <= 10);
  const dataRows = [
    ["Field", `${ctx.fieldName ? escapeHtml(ctx.fieldName) + ", " : ""}${fmt(R.ha, 2)} ha, centre ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`],
    ["Elevation", `${R.elevInfo ? escapeHtml(demLabel({ source: R.elevInfo.label, res: R.elevInfo.res })) : "Copernicus DEM GLO-90 (via Open-Meteo)"}: ${fmt(sm.eMin, fine ? 1 : 0)}–${fmt(sm.eMax, fine ? 1 : 0)} m, mean slope ${fmt(sm.fSlope, 1)}%`],
    ["Soil", R.soil ? `ISRIC SoilGrids 2.0, 0–60 cm: about ${fmt(sm.fClay, 0)}% clay on average` : "Not loaded"],
    ["NDVI", R.ndviInfo ? `${escapeHtml(R.ndviInfo.label)}${R.ndviInfo.cloud != null ? ` (scene cloud cover ${fmt(R.ndviInfo.cloud, 0)}%)` : ""}, field average ${fmt(sm.fNdvi, 2)}` : "Not used"],
    ["Irrigation", escapeHtml(irrigationSummary(R.irrigation))],
    ...(ctx.roots ? [["Crop", `${escapeHtml(ctx.roots.roots.crop)}${ctx.roots.roots.stageLabel ? `, ${escapeHtml(ctx.roots.roots.stageLabel)}` : ""}`]] : []),
    ...(ctx.askedBlocks ? [["Irrigation blocks", `${ctx.askedBlocks} according to the grower, so ${ctx.askedBlocks} probe${ctx.askedBlocks > 1 ? "s" : ""} (one per block)${R.blocks && R.blocks.length !== ctx.askedBlocks ? `; ${R.blocks.length} drawn on the map` : ""}`]] : []),
    [C ? "Recommended" : "Sensors", `${R.sensors.length}${R.blocks ? ` for ${R.blocks.length} irrigation block${R.blocks.length > 1 ? "s" : ""} (one per block${R.sensors.some((s) => s.optional) ? ", plus optional ones for uneven blocks" : ""})` : ""}, at least ${R.buffer} m from the field edge${R.blocks ? " and the block borders" : ""} where possible`],
  ];
  const table = R.sensors.map((s) => `<tr><td><b style="color:${zoneColor(s.zone)}">●</b> ${s.name}${optTag(s)}${s.moved ? " (moved)" : ""}</td><td>${s.lat.toFixed(6)}</td><td>${s.lon.toFixed(6)}</td><td>${escapeHtml(zoneOf(s))} (${fmt(s.share * 100, 0)}%)</td><td>${fmt(R.T.elev[s.i], fine ? 1 : 0)} m</td><td>${R.soil ? fmt(R.soil.clay[s.i], 0) + "%" : "–"}</td><td>${R.ndvi ? fmt(R.ndvi[s.i], 2) : "–"}</td></tr>`).join("");
  const cards = R.sensors.map((s) => `<section class="s"><h3><span style="background:${zoneColor(s.zone)}">${R.sensors.indexOf(s) + 1}</span>${s.name}${optTag(s)}</h3>
    <p class="mono">${s.lat.toFixed(6)}, ${s.lon.toFixed(6)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lon.toFixed(6)}">directions</a></p>
    <p class="lbl">Why here</p><ul>${s.why.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
    ${s.reason ? `<p class="lbl">Placed here because</p><p>${escapeHtml(s.reason)}</p>` : ""}
    ${s.tip ? `<p class="lbl">Installation</p><p>${escapeHtml(s.tip)}</p>` : ""}
    <p class="lbl">Installed on (fill in on site)</p><p class="blank">Date: ____________ &nbsp; Depth(s): ____________ &nbsp; Serial no.: ____________</p></section>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Asap:wght@400;500;600;700&family=League+Spartan:wght@600;700&display=swap"><style>
.brand{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:0 0 24px}.brand svg{height:52px;width:auto;display:block}.brand small{color:#5a6f86;font-size:12px;text-align:right}
body{font:15px/1.5 Asap,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1e2d40;background:#fff;margin:0 auto;max-width:820px;padding:24px 16px}
h1{font:700 26px/1.15 "League Spartan",Asap,sans-serif;color:#334F77;margin:0}h2{font:600 18px/1.2 "League Spartan",Asap,sans-serif;color:#334F77;margin:28px 0 8px;padding-top:12px;border-top:1px solid #d5e0e8}
.sub{color:#5a6f86;margin:4px 0 0}.mono{font-size:13px;color:#5a6f86;font-variant-numeric:tabular-nums}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:0}dt{color:#5a6f86}dd{margin:0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #d5e0e8}th{color:#5a6f86;font-weight:600}
.wrap{overflow-x:auto}.s{border:1px solid #d5e0e8;border-radius:8px;padding:12px 14px;margin:10px 0;break-inside:avoid}
.s h3{margin:0 0 4px;display:flex;align-items:center;gap:8px;font:600 17px/1.2 "League Spartan",Asap,sans-serif;color:#334F77}.s h3 span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;color:#fff;font-size:12px}
.s ul{margin:4px 0 8px;padding-left:20px}.lbl{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#5a6f86;margin:8px 0 0}.blank{color:#5a6f86}
.notes{color:#5a6f86;font-size:13px}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #0380B8;background:#0380B8;color:#fff;cursor:pointer}
.headline{font-size:17px;margin:12px 0 0;padding:10px 14px;border-left:4px solid #0380B8;background:#e8f1f7;border-radius:4px}
.roi-table{font-variant-numeric:tabular-nums}.roi-table td,.roi-table thead th{text-align:right}.roi-table tbody th{font-weight:400;color:#5a6f86}.roi-table td:nth-child(3){background:#e8f1f7}
.roi-water{display:flex;gap:10px;align-items:flex-start;margin:10px 0 0;padding:10px 14px;border-left:4px solid #0380B8;background:#e6f1f9;color:#133a57;border-radius:4px}.roi-water p{margin:0}.roi-drop{flex:none}
.roi-years{font-size:12px}.roi-years td,.roi-years th{white-space:nowrap}.roi-years td:nth-child(3){background:none}.roi-years td:last-child{background:#e8f1f7;font-weight:600}.roi-years tr.water td{color:#0380B8;font-weight:600}.roi-years tr.total th,.roi-years tr.total td{border-top:2px solid #1e2d40}.roi-years tr.alt th,.roi-years tr.alt td{color:#5a6f86;font-size:11px}.neg{color:#c0392b}.pos{color:#0380B8}
h3{font-size:14px;margin:14px 0 4px}
.legend{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;margin-top:6px}.legend b{font-size:16px}
@media print{button{display:none}body{padding:0}a{color:inherit}}
</style></head><body>
<header><div class="brand">${typeof BRAND !== "undefined" ? BRAND.logoBaseline : ""}</div><h1>${escapeHtml(title)}</h1><p class="sub">HydraScout soil moisture &amp; temperature probes · generated ${new Date().toLocaleDateString()}</p>
${C ? `<p class="headline">${C.probes.length} installed probe${C.probes.length > 1 ? "s" : ""}: ${C.counts.map((k, v) => k && `${k} ${["well placed", "worth a look", "should move"][v]}`).filter(Boolean).join(", ")}${C.missing.length ? `; ${C.missing.length} ${R.blocks ? "block" : "zone"}${C.missing.length > 1 ? "s" : ""} without a probe` : ""}.</p>` : ""}
${X && !C ? roiSummaryHtml(X, X.probes || R.sensors.length).replace('class="roi-headline"', 'class="headline"') : ""}
<p><button onclick="window.print()">Print or save as PDF</button></p></header>
<h2>Field and data used</h2><dl>${dataRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
<h2>Plan</h2>${fieldSvg(R, ctx)}
${C ? `<p class="notes">◆ installed probes (green: good spot, amber: worth a look, red: should move); ○ recommended spots; dashed line: suggested move.</p>` : ""}<div class="legend">${R.blocks ? R.blocks.map((b, bi) => `<span><b style="color:${zoneColor(bi)}">■</b> Block ${escapeHtml(b.name)} · ${fmt(b.ha, 1)} ha · ${R.sensors.filter((s) => s.zone === bi).map((s) => s.name + optTag(s)).join(", ") || "no probe"}</span>`).join("")
  : R.sensors.map((s) => `<span><b style="color:${zoneColor(s.zone)}">■</b> Zone ${s.zone + 1} · ${fmt(s.share * 100, 0)}% · ${s.name}</span>`).join("")}</div>
${ctx.layout ? `<h2>Irrigation layout</h2>${ctx.layout}<p class="notes">Worked out from the irrigation settings and the blocks: a schematic to agree with the grower, not a survey of the pipes.</p>` : ""}
${terrainSection(R, ctx, fine)}
${C ? `<h2>Installed probes</h2><div class="wrap"><table><thead><tr><th>Probe</th><th>Latitude</th><th>Longitude</th><th>${R.blocks ? "Block" : "Zone"}</th><th>To border</th><th>Verdict</th><th>Suggestion</th></tr></thead><tbody>${checkRows(R, C, ctx)}</tbody></table></div>
<h2>Each probe</h2>${C.probes.map((a) => `<section class="s"><h3><span style="background:${["#3f9a52", "#e0a02a", "#d0453a"][a.sev]};border-radius:4px">${a.sev ? "!" : "✓"}</span>${escapeHtml(a.name)} · ${a.verdict}</h3>
    <p class="mono">${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}${a.serial ? ` · device ${escapeHtml(a.serial)}` : ""}</p><ul>${a.lines.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>${a.suggest ? `<p><b>${escapeHtml(a.suggest)}</b>${a.ref && a.sev && a.move >= 3 ? ` <a href="https://www.google.com/maps/dir/?api=1&destination=${a.ref.s.lat.toFixed(6)},${a.ref.s.lon.toFixed(6)}">directions</a>` : ""}</p>` : ""}</section>`).join("")}
${C.missing.length || C.optional.length ? `<h2>Missing probes</h2><ul>${C.missing.map((s) => `<li>${s.block != null ? `Block ${escapeHtml(s.block)}` : `Zone ${s.zone + 1}`} has no probe: recommended spot ${s.name}, ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}.</li>`).concat(C.optional.map((s) => `<li>Block ${escapeHtml(s.block)} is uneven (${escapeHtml(s.uneven)}): optional second probe at ${s.name}, ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}.</li>`)).join("")}</ul>` : ""}
<h2>Recommended spots, for comparison</h2>` : "<h2>Sensor positions</h2>"}<div class="wrap"><table><thead><tr><th>Sensor</th><th>Latitude</th><th>Longitude</th><th>${R.blocks ? "Block" : "Zone"} (share)</th><th>Elevation</th><th>Clay</th><th>NDVI</th></tr></thead><tbody>${table}</tbody></table></div>
${ctx.roots ? `<h2>Root zone and probe length</h2><ul>${rootsSummary(ctx.roots.roots, ctx.roots.probe).map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
${C ? "" : `<h2>Why each spot was chosen</h2>${cards}`}
${X && !C ? `<h2>Return on investment</h2><p>${escapeHtml(roiBasis(X))} ${escapeHtml(roiCostText(X))}</p><h3>Each year, three cases</h3><div class="wrap">${roiTable(X)}</div>
<h3>Over ${ROI_YEARS} years, expected case</h3><div class="wrap">${roiYearsTable(X)}</div>
<p class="notes">Savings use the farmer's own figures and a water saving of ${X.scenarios.map((sc) => `${num(sc.rate)}%`).join(" / ")} (low / expected / high), in line with what HydraScout probes typically save (10–30% of irrigation water, with the pumping hours that go with it). Time, fertiliser, fungicide and yield gains are the farmer's own estimates and are the same in all three cases.${X.quota ? " With a water quota, the water saved irrigates more hectares instead of lowering the bill." : ""}${X.lease ? " The probes are leased: nothing to buy upfront." : ""} Payback counts irrigation seasons.</p>` : ""}
<h2>Method and limits</h2><ul class="notes"><li>The field is sampled on a regular grid. Each point gets elevation, slope, relative position (hollow or rise), soil texture, NDVI and irrigation coverage when available. ${R.blocks ? "Each irrigation block gets one probe at its most typical point, away from the field edge and the block border; a block made of two clearly different parts gets an optional second probe." : "Points are grouped into zones with similar conditions, and each sensor sits at the most typical point of its zone, away from the field edge."}</li>${R.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
</body></html>`;
  return html;
}

// Terrain from the lidar model: each block's lowest and highest ground and slope, and a 3D picture of the blocks.
function terrainSection(R, ctx, fine) {
  const rel = R.elevInfo && R.elevInfo.relief;
  if (!rel && !ctx.picture) return "";
  const names = R.blocks ? R.blocks.map((b) => `Block ${escapeHtml(b.name)}`) : ["Field"];
  const slopeOf = (bi) => mean(R.pts.map((_, i) => i).filter((i) => !R.blocks || R.lab[i] === bi).map((i) => R.T.slope[i]));
  const rows = rel ? rel.map((r, bi) => r && `<tr><td>${R.blocks ? `<b style="color:${zoneColor(bi)}">■</b> ` : ""}${names[bi] || ""}</td><td>${fmt(r.lo, 1)} m</td><td>${fmt(r.hi, 1)} m</td><td><b>${fmt(r.hi - r.lo, 1)} m</b></td><td>${fmt(slopeOf(bi), 1)}%</td><td>${R.sensors.filter((s) => (R.blocks ? s.zone === bi : true)).map((s) => `${s.name} ${fmt(R.T.elev[s.i], fine ? 1 : 0)} m`).join(", ") || "–"}</td></tr>`).filter(Boolean).join("") : "";
  return `<h2>Terrain${fine ? " (lidar)" : ""}</h2>
${ctx.picture ? `<img src="${ctx.picture}" alt="3D view of the ${R.blocks ? "blocks" : "field"} on the terrain model, relief exaggerated three times" style="width:100%;border-radius:6px;display:block">
<p class="notes">3D view from the south-west, relief exaggerated ×3. Numbered pins: the probe spots.</p>` : ""}
${rows ? `<div class="wrap"><table><thead><tr><th>${R.blocks ? "Block" : "Area"}</th><th>Lowest</th><th>Highest</th><th>Difference</th><th>Mean slope</th><th>Probe height</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="notes">${escapeHtml(demLabel({ source: R.elevInfo.label, res: R.elevInfo.res }))}. ${fine ? "Ground heights without crops or trees. Water runs towards the low parts of a block, so a probe in the middle of the height range represents it best." : ""}</p>` : ""}`;
}

// Opens the report in a new tab (to read, print or save as PDF); downloads it if pop-ups are blocked.
// The tab opens straight away (pop-up blockers allow it only during the click) and shows the report once the
// 3D picture of the blocks is ready, or after 25 s without it.
async function openReport(R, ctx) {
  const w = window.open("", "_blank");
  if (w) w.document.write('<!doctype html><meta charset="utf-8"><title>Preparing the report…</title><p style="font:16px system-ui;padding:24px;color:#5a6f86">Preparing the report and its 3D view of the blocks…</p>');
  if (ctx.snapshot) ctx.picture = await Promise.race([ctx.snapshot(), sleep(25000).then(() => null)]).catch(() => null);
  const html = reportHtml(R, ctx), url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  if (w && !w.closed) w.location.href = url; else download(`${fileBase(ctx)}-report.html`, "text/html", html);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function checkRows(R, C) {
  return C.probes.map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${a.lat.toFixed(6)}</td><td>${a.lon.toFixed(6)}</td><td>${a.inside ? escapeHtml(R.blocks ? R.blocks[a.zone].name : String(a.zone + 1)) : "outside"}</td><td>${a.edge != null ? `${fmt(a.edge, 0)} m` : "–"}</td><td>${a.verdict}</td><td>${escapeHtml(a.suggest || "")}</td></tr>`).join("");
}
function exportCheckCsv(R, ctx) {
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`, C = ctx.check;
  const rows = [["name", "serial", "lat", "lon", "block_or_zone", "dist_to_border_m", "verdict", "suggested_spot", "suggested_lat", "suggested_lon", "move_m", "direction", "findings", "suggestion"]];
  C.probes.forEach((a) => { const t = a.ref && a.ref.s; rows.push([q(a.name), q(a.serial || ""), a.lat.toFixed(7), a.lon.toFixed(7), q(a.inside ? (R.blocks ? R.blocks[a.zone].name : a.zone + 1) : "outside"), a.edge != null ? fmt(a.edge, 0) : "", q(a.verdict),
    t ? t.name : "", t ? t.lat.toFixed(7) : "", t ? t.lon.toFixed(7) : "", a.move != null ? fmt(a.move, 0) : "", a.dir || "", q(a.lines.join(" ")), q(a.suggest || "")]); });
  download(`${fileBase(ctx)}-check.csv`, "text/csv", "\ufeff" + rows.map((r) => r.join(",")).join("\n") + "\n");
}
