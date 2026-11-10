"use strict";
// Root zone depth from the crop, its stage and the satellite NDVI, and the probe length it calls for.
//
// Sources:
// - Maximum effective root depth Zr: FAO Irrigation and Drainage Paper 56 (Allen et al., 1998), Table 22.
//   FAO-56 says the smaller values suit irrigation scheduling and the larger ones deep, unlayered soils,
//   so irrigated fields use the low end of the range and rainfed fields the middle.
// - Stage lengths (initial, development, mid-season, late, in days): FAO-56 Table 11, typical spring or
//   Mediterranean sowings. Real lengths change with variety, region and sowing date.
// - Root growth: from about 15 cm at sowing to Zr at the end of the development stage. Roots follow the
//   canopy, so with satellite images the depth is scaled by canopy development read from NDVI
//   (as in FAO-56 dual Kc work, where Zr follows the basal crop coefficient).

const CROPS = {
  // Annual crops: zr in metres [min, max], days [initial, development, mid, late].
  maize: { name: "Maize (grain)", kind: "annual", zr: [1.0, 1.7], days: [30, 40, 50, 30] },
  maizeSilage: { name: "Maize (silage)", kind: "annual", zr: [1.0, 1.7], days: [30, 40, 45, 15] },
  wheat: { name: "Winter wheat", kind: "annual", zr: [1.5, 1.8], days: [30, 140, 40, 30] },
  barley: { name: "Spring barley", kind: "annual", zr: [1.0, 1.5], days: [15, 25, 50, 30] },
  sorghum: { name: "Sorghum", kind: "annual", zr: [1.0, 2.0], days: [20, 35, 40, 30] },
  sunflower: { name: "Sunflower", kind: "annual", zr: [0.8, 1.5], days: [25, 35, 45, 25] },
  soybean: { name: "Soybean", kind: "annual", zr: [0.6, 1.3], days: [20, 35, 60, 25] },
  sugarbeet: { name: "Sugar beet", kind: "annual", zr: [0.7, 1.2], days: [50, 40, 50, 40] },
  potato: { name: "Potato", kind: "annual", zr: [0.4, 0.6], days: [25, 30, 45, 30] },
  peas: { name: "Peas", kind: "annual", zr: [0.6, 1.0], days: [20, 30, 35, 15] },
  beans: { name: "Green beans", kind: "annual", zr: [0.5, 0.7], days: [20, 30, 30, 10] },
  tomato: { name: "Tomato", kind: "annual", zr: [0.7, 1.5], days: [30, 40, 45, 30] },
  melon: { name: "Melon", kind: "annual", zr: [0.8, 1.5], days: [25, 35, 40, 20] },
  onion: { name: "Onion (dry)", kind: "annual", zr: [0.3, 0.6], days: [15, 25, 70, 40] },
  carrot: { name: "Carrot", kind: "annual", zr: [0.5, 1.0], days: [20, 30, 50, 20] },
  lettuce: { name: "Lettuce", kind: "annual", zr: [0.3, 0.5], days: [20, 30, 15, 10] },
  // Perennial crops: roots stay at depth all year once established.
  vine: { name: "Grapevine", kind: "perennial", zr: [1.0, 2.0] },
  apple: { name: "Apple, pear, cherry", kind: "perennial", zr: [1.0, 2.0] },
  stone: { name: "Peach, apricot, plum", kind: "perennial", zr: [1.0, 2.0] },
  olive: { name: "Olive", kind: "perennial", zr: [1.2, 1.7] },
  citrus: { name: "Citrus", kind: "perennial", zr: [1.2, 1.5] },
  walnut: { name: "Walnut", kind: "perennial", zr: [1.7, 2.4] },
  kiwi: { name: "Kiwifruit", kind: "perennial", zr: [0.7, 1.3] },
  strawberry: { name: "Strawberry", kind: "perennial", zr: [0.2, 0.3] },
  alfalfa: { name: "Alfalfa (lucerne)", kind: "perennial", zr: [1.0, 2.0] },
  grass: { name: "Grass, pasture", kind: "perennial", zr: [0.5, 1.5] },
};
const STAGES = { ini: "emergence stage", dev: "development stage", mid: "mid-season, full cover", late: "late season, ripening", after: "after harvest" };
const ZR_SOWING = 0.15; // m, root depth soon after sowing (FAO-56: 0.15–0.20 m)
const NDVI_BARE = 0.15, NDVI_FULL = 0.85; // bare soil and typical full cover, used when the timeline is too short to show the season's peak
// Soil groups (WRB) where something stops the roots before the crop's own depth.
const SHALLOW_SOILS = {
  Leptosols: "Shallow soil over rock or gravel is likely here (Leptosols)",
  Planosols: "A dense clay layer is likely in the subsoil here (Planosols), and water perches above it",
  Stagnosols: "The subsoil is likely waterlogged part of the year here (Stagnosols)",
  Plinthosols: "A hardened iron-rich layer is likely in the subsoil here (Plinthosols)",
  Durisols: "A silica-cemented layer is likely in the subsoil here (Durisols)",
  Gleysols: "A shallow water table is likely here (Gleysols)",
};

const round5 = (cm) => Math.round(cm / 5) * 5;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Stage and share of root growth done, from the days since sowing.
function stageFromDays(c, d) {
  const [a, b, m, l] = c.days;
  if (d < 0) return null;
  if (d < a) return { stage: "ini", f: d / (a + b) };
  if (d < a + b) return { stage: "dev", f: d / (a + b) };
  if (d < a + b + m) return { stage: "mid", f: 1 };
  if (d < a + b + m + l) return { stage: "late", f: 1 };
  return { stage: "after", f: 1 };
}

// Stage and canopy development from the NDVI timeline (annual crops). `shown` is the date on screen,
// `scenes` every loaded date with its field-average NDVI.
function stageFromNdvi(shown, scenes) {
  const done = scenes.filter((s) => s.mean != null);
  if (!shown || shown.mean == null) return null;
  // The season's peak, when the timeline shows enough of it; otherwise a typical full-cover NDVI.
  const peak = done.length >= 4 ? done.reduce((p, s) => (s.mean > p.mean ? s : p)) : null;
  const top = peak ? Math.max(peak.mean, 0.5) : NDVI_FULL;
  const f = clamp01((shown.mean - NDVI_BARE) / (top - NDVI_BARE));
  if (peak && shown.date > peak.date && shown.mean < peak.mean - 0.1) return { stage: f < 0.25 ? "after" : "late", f: 1, peak };
  return { stage: f < 0.1 ? "ini" : f < 0.85 ? "dev" : "mid", f, peak };
}

// inp: { crop, sowing ("YYYY-MM-DD"), young, stage ("auto" or a STAGES key), irrigated, shown, scenes, soils, today }
function computeRoots(inp) {
  const c = CROPS[inp.crop]; if (!c) return null;
  const notes = [];
  const lowEnd = inp.irrigated !== false;
  // Deepest effective roots of the season: low end of FAO's range under irrigation, middle when rainfed.
  let maxM = lowEnd ? c.zr[0] : (c.zr[0] + c.zr[1]) / 2;
  if (c.kind === "perennial" && inp.young) { maxM *= 0.5; notes.push("Young plantation: roots are taken as about half the mature depth. This is a rough guess, so check with an auger."); }
  let stage = null, f = 1, src = null;
  if (c.kind === "annual") {
    if (inp.stage && inp.stage !== "auto") { stage = inp.stage; f = { ini: 0.1, dev: 0.5, mid: 1, late: 1, after: 1 }[stage]; src = "the stage you picked"; }
    else if (inp.sowing) {
      const d = Math.floor((Date.parse(inp.today) - Date.parse(inp.sowing)) / 864e5), r = stageFromDays(c, d);
      if (r) { stage = r.stage; f = r.f; src = `${d} days since sowing`; }
      else notes.push("The sowing date is in the future: the depth shown is the one the crop will reach.");
    } else {
      const r = stageFromNdvi(inp.shown, inp.scenes || []);
      if (r) { stage = r.stage; f = r.f; src = `the satellite image of ${inp.shown.date} (NDVI ${fmt(inp.shown.mean, 2)}${r.peak ? `, season peak ${fmt(r.peak.mean, 2)} on ${r.peak.date}` : ""})`; }
    }
    if (!stage) notes.push("Give the sowing date, pick the stage or load satellite images to see today's root depth.");
  }
  const nowM = stage ? ZR_SOWING + (maxM - ZR_SOWING) * clamp01(f) : null;
  const top = (inp.soils || [])[0];
  if (top && SHALLOW_SOILS[top.name]) notes.push(`${SHALLOW_SOILS[top.name]}: roots may stop above ${round5(maxM * 100)} cm. Check the depth with an auger before choosing the probe length.`);
  if (stage === "after") notes.push("The crop looks harvested on this date: the probe is sized for next season's deepest roots.");
  return {
    crop: c.name, kind: c.kind, stage, stageLabel: stage ? STAGES[stage] : null, src,
    nowCm: nowM != null ? Math.max(10, round5(nowM * 100)) : null,
    maxCm: round5(maxM * 100), rangeCm: [round5(c.zr[0] * 100), round5(c.zr[1] * 100)], lowEnd,
    activeCm: round5(maxM * 50), // about 70% of the water comes from the top half of the root zone
    notes,
  };
}

// HSTI probe range, from the HSTI distributor catalogue (August 2026). HydraScout® sensors measure soil
// moisture (VWC) and temperature, 10 cm apart or a multiple of 10 cm. Lengths and sensor counts per crop family:
const RANGE = {
  veg: { label: "Vegetable crops", lengths: [10, 20, 30, 40, 50], sensors: [1, 5] },
  berry: { label: "Berries and small fruits", lengths: [10, 20, 30, 40, 50, 60], sensors: [1, 6] },
  tree: { label: "Fruit trees", lengths: [50, 60, 70, 80, 90, 100, 120, 150], sensors: [2, 10], wireless: { lengths: [50, 60, 70, 80, 90, 100], sensors: [2, 8] } },
  vine: { label: "Viticulture", lengths: [60, 70, 80, 90, 100, 120, 150], sensors: [2, 10], wireless: { lengths: [60, 70, 80, 90, 100], sensors: [2, 8] } },
};
// Crops the catalogue does not list in a family (field crops, forage) get the whole HydraScout range (20 to 150 cm).
const RANGE_ALL = { label: "HydraScout range", lengths: [20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150], sensors: [1, 10] };
const CROP_FAMILY = { potato: "veg", tomato: "veg", melon: "veg", onion: "veg", carrot: "veg", lettuce: "veg", beans: "veg", peas: "veg", sugarbeet: "veg",
  strawberry: "berry", apple: "tree", stone: "tree", olive: "tree", citrus: "tree", walnut: "tree", kiwi: "tree", vine: "vine" };
const WIRELESS_MAX = { lora: 6, ltem: 8 }; // sensors per HydraScout® Wireless probe

// Sensor depths for a probe length: every 10 cm up to 60 cm, every 20 cm on longer probes (always ending at
// the bottom of the probe), kept within the family's sensor count.
function sensorDepths(len, [lo, hi]) {
  const step = len <= 60 ? 10 : 20, d = [];
  for (let z = len; z >= 10 && d.length < hi; z -= step) d.unshift(z);
  return d.length >= lo ? d : null;
}

// Shortest probe whose bottom sensor sits just below the deepest roots, so it sees water draining past them.
// link: "cable", "lora" or "ltem".
function recommendProbe(roots, cropKey, link = "cable") {
  if (!roots) return null;
  const target = roots.maxCm + 10, fam = RANGE[CROP_FAMILY[cropKey]], notes = [];
  let r = fam || RANGE_ALL, product = "HydraScout®";
  if (!fam) notes.push(`${roots.crop} is not in a crop family of the HSTI catalogue: the whole HydraScout range (up to 150 cm) is used. Check the configuration with HSTI.`);
  if (link !== "cable") {
    if (fam && fam.wireless) { r = { ...fam, ...fam.wireless }; product = `HydraScout® Wireless (${link === "lora" ? "LoRaWAN" : "LTE-M"}, pre-production)`; r.sensors = [r.sensors[0], Math.min(r.sensors[1], WIRELESS_MAX[link])]; }
    else notes.push("HydraScout® Wireless is only listed for fruit trees and vines: a cabled HydraScout® is suggested.");
  }
  let len = r.lengths.find((l) => l >= target);
  if (len == null) {
    len = r.lengths[r.lengths.length - 1];
    notes.push(len >= roots.maxCm
      ? `The longest ${r.label.toLowerCase()} probe (${len} cm) reaches the bottom of the roots, but no sensor sits below them to see drainage.`
      : len >= roots.activeCm
      ? `The deepest roots (${roots.maxCm} cm) go past the longest ${r.label.toLowerCase()} probe (${len} cm); it still covers the top ${roots.activeCm} cm where most of the water is taken.`
      : `The longest ${r.label.toLowerCase()} probe (${len} cm) does not reach the main root zone (${roots.activeCm} cm). Check with HSTI.`);
  }
  const depths = sensorDepths(len, r.sensors) || [len];
  // HSTI product code: H-LLSS-A, LL = length in decimetres, SS = number of sensors (60 cm, 4 sensors = H-0604-A).
  // Only confirmed for the cabled HydraScout®; the Wireless version's code is not known yet.
  const pad2 = (n) => String(n).padStart(2, "0");
  const code = product === "HydraScout®" ? `H-${pad2(len / 10)}${pad2(depths.length)}-A` : null;
  if (!code) notes.push("Product code of the Wireless version: to confirm with HSTI.");
  return { target, product, code, lengthCm: len, depthsCm: depths, family: r.label, notes,
    ref: `${product} ${len} cm with ${depths.length} sensor${depths.length > 1 ? "s" : ""}` };
}

function rootsSummary(r, rec) {
  if (!r) return "";
  const lines = [];
  if (r.nowCm != null) lines.push(`Roots now: about ${r.nowCm} cm (${r.stageLabel}, from ${r.src}).`);
  lines.push(`Deepest effective roots${r.kind === "annual" ? " this season" : ""}: about ${r.maxCm} cm (FAO-56 gives ${r.rangeCm[0]}–${r.rangeCm[1]} cm for ${r.crop.toLowerCase()}; ${r.lowEnd ? "low end used for an irrigated field" : "middle used for a rainfed field"}). About 70% of the water comes from the top ${r.activeCm} cm.`);
  if (rec) lines.push(`Suggested probe: ${rec.code ? `${rec.code}, ` : ""}${rec.ref}, at ${rec.depthsCm.join(", ")} cm (each measures moisture and temperature).${rec.lengthCm > r.maxCm ? " The bottom sensor sits just below the roots to see water draining past them." : ""}`);
  return lines.concat(r.notes, rec ? rec.notes : []);
}
