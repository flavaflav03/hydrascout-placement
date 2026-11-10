"use strict";
// Return on investment: what the probes save on water and pumping energy, against what they cost.
// A probe typically saves 10–30% of irrigation water (HSTI field experience), and pumping hours fall with it.

const ROI_SCENARIOS = [["Low", 0], ["Expected", 1], ["High", 2]];
const ENERGY_LABELS = { none: "No pumping cost", electric: "Electric pump", diesel: "Diesel pump" };

// inp: { area, waterPerHa, waterPrice, energy, flow, kw, kwhPrice, fuelLph, fuelPrice, probes, probePrice, install, sub, grant,
//        pay: "buy" | "lease", lease, quota, marginHa, timeWeek, weeks, hourly, fertHa, fertRate, fungHa, fungRate,
//        cropHa, yieldRate, rates: [lo, mid, hi] }
// Returns null while the water volume is missing. Time, fertiliser, fungicide and yield gains are the farmer's own
// estimates: they stay the same in the three scenarios, only the water saving changes.
// With a water quota, the water saved is not a cost saved: it irrigates more hectares, worth their extra margin.
// With a lease, there is nothing to pay upfront: the monthly price per probe is a yearly cost like the subscription.
const ROI_YEARS = 5;
function computeRoi(inp) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const volume = n(inp.area) * n(inp.waterPerHa);
  if (!volume) return null;
  const hours = inp.energy !== "none" && n(inp.flow) ? volume / inp.flow : null;
  const energyPerHour = inp.energy === "electric" ? n(inp.kw) * n(inp.kwhPrice) : inp.energy === "diesel" ? n(inp.fuelLph) * n(inp.fuelPrice) : 0;
  const waterCost = volume * n(inp.waterPrice), energyCost = hours ? hours * energyPerHour : 0;
  const lease = inp.pay === "lease";
  const gross = lease ? n(inp.install) : n(inp.probes) * n(inp.probePrice) + n(inp.install), grant = lease ? 0 : Math.min(n(inp.grant), gross);
  const invest = gross - grant, subYear = n(inp.probes) * n(inp.sub), leaseYear = lease ? n(inp.probes) * n(inp.lease) * 12 : 0;
  const costYear = subYear + leaseYear;
  const priced = lease ? n(inp.lease) > 0 : n(inp.probePrice) > 0;
  const quota = !!inp.quota && n(inp.marginHa) > 0;
  // Extra gains, a year
  const labourHours = n(inp.timeWeek) * n(inp.weeks), labour = labourHours * n(inp.hourly);
  const pct = (v) => Math.min(n(v), 100) / 100;
  const fert = n(inp.area) * n(inp.fertHa) * pct(inp.fertRate);
  const fung = n(inp.area) * n(inp.fungHa) * pct(inp.fungRate);
  const crop = n(inp.area) * n(inp.cropHa) * pct(inp.yieldRate);
  const extras = labour + fert + fung + crop;
  const scenarios = ROI_SCENARIOS.map(([label, k]) => {
    const r = n(inp.rates[k]) / 100, extraHa = quota ? (r * volume) / inp.waterPerHa : 0;
    const pumping = quota ? extraHa * inp.marginHa : r * (waterCost + energyCost), saved = pumping + extras, net = saved - costYear;
    const years = Array.from({ length: ROI_YEARS }, (_, y) => (y + 1) * net - (priced ? invest : 0)); // cumulative, end of each season
    return {
      label, rate: r * 100, m3: r * volume, hours: hours ? r * hours : null, water: quota ? 0 : r * waterCost, energy: quota ? 0 : r * energyCost, extraHa, pumping, saved, net,
      payback: priced && net > 0 ? invest / net : null, // in irrigation seasons
      years, gain5: priced ? years[ROI_YEARS - 1] : null,
    };
  });
  return { ...inp, volume, hours, waterCost, energyCost, lease, gross, grant, invest, subYear, leaseYear, costYear, priced, quota, labourHours, labour, fert, fung, crop, extras, scenarios };
}

const eur = (v) => `${v < 0 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("en-GB")} €`;
const num = (v, d = 0) => (v == null ? "–" : v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }));
// Payback counts irrigation seasons. paybackText(p) for a table cell, paybackText(p, true) inside a sentence.
function paybackText(p, inSentence = false) {
  if (p == null) return inSentence ? "beyond the savings shown" : "not reached";
  if (p <= 1) return inSentence ? "within the first season" : "first season";
  return `${inSentence ? "in " : ""}${num(p, 1)} seasons`;
}

// One table used both in the app and in the report.
function roiTable(X) {
  const rows = [
    ["Water saving", (s) => `${num(s.rate)} %`],
    ["Water saved", (s) => `${num(s.m3)} m³`],
    ...(X.quota ? [["Extra hectares irrigated", (s) => `${num(s.extraHa, 1)} ha`], ["Margin from the extra hectares", (s) => eur(s.pumping)]] : [
      ...(X.hours ? [["Pumping hours saved", (s) => `${num(s.hours)} h`]] : []),
      ...(X.waterCost ? [["Water bill saved", (s) => eur(s.water)]] : []),
      ...(X.energyCost ? [[X.energy === "diesel" ? "Diesel saved" : "Electricity saved", (s) => eur(s.energy)]] : []),
    ]),
    ...(X.labour ? [["Time saved", () => eur(X.labour)]] : []),
    ...(X.fert ? [["Fertiliser saved", () => eur(X.fert)]] : []),
    ...(X.fung ? [["Fungicide saved", () => eur(X.fung)]] : []),
    ...(X.crop ? [["Better yield and quality", () => eur(X.crop)]] : []),
    ["Savings per year", (s) => `<b>${eur(s.saved)}</b>`],
    ...(X.costYear ? [[X.leaseYear ? (X.subYear ? "Net of lease and subscription" : "Net of lease") : "Net of subscription", (s) => eur(s.net)]] : []),
    ...(X.priced ? [["Payback", (s) => `<b>${paybackText(s.payback)}</b>`], [`Net gain over ${ROI_YEARS} years`, (s) => `<b>${eur(s.gain5)}</b>`]] : []),
  ];
  return `<table class="roi-table"><thead><tr><th></th>${X.scenarios.map((s) => `<th>${s.label}</th>`).join("")}</tr></thead><tbody>${rows.map(([k, f]) => `<tr><th>${k}</th>${X.scenarios.map((s) => `<td>${f(s)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
// Year by year over five seasons, expected case, with the cumulative result of the low and high cases underneath.
function roiYearsTable(X) {
  const s = X.scenarios[1], Y = [...Array(ROI_YEARS).keys()], cls = (v) => (v < 0 ? "neg" : "pos");
  const row = (k, f, tot, c = "") => `<tr${c ? ` class="${c}"` : ""}><th>${k}</th>${Y.map((y) => `<td>${f(y)}</td>`).join("")}<td>${tot}</td></tr>`;
  const flat = (k, v, sign = 1) => row(k, () => eur(sign * v), eur(sign * v * ROI_YEARS));
  const rows = [
    row(X.quota ? "Water saved" : "Water kept in the ground", () => `${num(s.m3)} m³`, `${num(s.m3 * ROI_YEARS)} m³`, "water"),
    flat(X.quota ? `Margin from ${num(s.extraHa, 1)} extra ha` : X.energyCost ? "Water and pumping" : "Water bill", s.pumping),
    ...(X.labour ? [flat("Time saved", X.labour)] : []),
    ...(X.fert ? [flat("Fertiliser", X.fert)] : []),
    ...(X.fung ? [flat("Fungicide", X.fung)] : []),
    ...(X.crop ? [flat("Yield and quality", X.crop)] : []),
    ...(X.leaseYear ? [flat("Lease", X.leaseYear, -1)] : []),
    ...(X.subYear ? [flat("Subscription", X.subYear, -1)] : []),
    ...(X.priced && X.invest ? [row(X.lease ? "Installation" : X.grant ? "Probes and installation, after grant" : "Probes and installation", (y) => (y ? "–" : eur(-X.invest)), eur(-X.invest))] : []),
    row("Net for the season", (y) => eur(s.net - (X.priced && !y ? X.invest : 0)), `<b>${eur(s.years[ROI_YEARS - 1])}</b>`),
    row("<b>Running total</b>", (y) => `<b class="${cls(s.years[y])}">${eur(s.years[y])}</b>`, "", "total"),
    ...[0, 2].map((k) => row(`Running total, ${X.scenarios[k].label.toLowerCase()} case`, (y) => `<span class="${cls(X.scenarios[k].years[y])}">${eur(X.scenarios[k].years[y])}</span>`, "", "alt")),
  ];
  return `<table class="roi-table roi-years"><thead><tr><th></th>${Y.map((y) => `<th>Year ${y + 1}</th>`).join("")}<th>${ROI_YEARS} years</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// The same five years, one row per season, narrow enough for the side panel and a phone.
function roiYearsCompact(X) {
  const s = X.scenarios[1], cls = (v) => (v < 0 ? "neg" : "pos");
  const cost = (y) => X.costYear + (X.priced && !y ? X.invest : 0);
  const rows = [...Array(ROI_YEARS).keys()].map((y) => `<tr><th>Year ${y + 1}</th><td class="w">${num(s.m3)} m³</td><td>${eur(s.saved)}</td><td>${cost(y) ? eur(-cost(y)) : "–"}</td><td><b class="${cls(s.years[y])}">${eur(s.years[y])}</b></td></tr>`);
  const tc = X.costYear * ROI_YEARS + (X.priced ? X.invest : 0);
  rows.push(`<tr class="total"><th><b>Total</b></th><td class="w">${num(s.m3 * ROI_YEARS)} m³</td><td><b>${eur(s.saved * ROI_YEARS)}</b></td><td>${tc ? eur(-tc) : "–"}</td><td><b class="${cls(s.years[ROI_YEARS - 1])}">${eur(s.years[ROI_YEARS - 1])}</b></td></tr>`);
  return `<table class="roi-table roi-compact"><thead><tr><th></th><th>Water saved</th><th>Gains</th><th>Costs</th><th>Running total</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    <p class="hint">Low case: ${eur(X.scenarios[0].years[ROI_YEARS - 1])} after ${ROI_YEARS} years · high case: ${eur(X.scenarios[2].years[ROI_YEARS - 1])}. The placement report has the line-by-line table.</p>`;
}

// The water saved, made concrete. A French household uses about 120 m³ a year; an Olympic pool holds 2,500 m³.
function roiWaterStory(X) {
  const s = X.scenarios[1], five = s.m3 * ROI_YEARS;
  if (!s.m3) return "";
  const pools = five / 2500, homes = s.m3 / 120;
  const like = [pools >= 1 ? `${num(pools, pools < 10 ? 1 : 0)} Olympic swimming pool${pools >= 1.05 ? "s" : ""}` : null, homes >= 1 ? `the water ${num(homes)} famil${homes >= 1.5 ? "ies use" : "y uses"} at home in a year` : null].filter(Boolean);
  return `<b>${num(s.m3)} m³ of water ${X.quota ? "saved" : "stays in the ground"} every season</b>: only what the crop really needs, applied when it needs it.
    Over ${ROI_YEARS} years that is <b>${num(five)} m³</b>${like.length ? ` (${like[0]}${like[1] ? `; each season alone matches ${like[1]}` : ""})` : ""}.
    ${X.quota ? `Under a quota that water is not lost: it irrigates <b>${num(s.extraHa, 1)} more hectares</b> every season with the same allowance.` : "Water not pumped today is water still in the aquifer in August, when droughts and restrictions hit, and fewer nitrates washed below the roots."}`;
}

// Today's situation, in one sentence.
function roiBasis(X) {
  const parts = [`${num(X.area, 1)} ha irrigated with ${num(X.volume)} m³ a year (${num(X.waterPerHa)} m³/ha)`];
  if (X.waterCost) parts.push(`water bill ${eur(X.waterCost)} (${num(X.waterPrice, 2)} €/m³)`);
  if (X.hours) parts.push(`${num(X.hours)} pumping hours at ${num(X.flow)} m³/h`);
  if (X.energyCost) parts.push(`${X.energy === "diesel" ? "diesel" : "electricity"} ${eur(X.energyCost)} (${X.energy === "diesel" ? `${num(X.fuelLph, 1)} L/h at ${num(X.fuelPrice, 2)} €/L` : `${num(X.kw, 1)} kW at ${num(X.kwhPrice, 3)} €/kWh`})`);
  if (X.labour) parts.push(`${num(X.labourHours)} h of field checks a year could be saved (${num(X.timeWeek, 1)} h a week over ${num(X.weeks)} weeks, at ${num(X.hourly, 2)} €/h)`);
  if (X.quota) parts.push(`water limited by a quota: the water saved irrigates more hectares, each worth ${eur(X.marginHa)} of extra margin`);
  if (X.fung) parts.push(`fungicide ${eur(X.area * X.fungHa)} a year, ${num(X.fungRate)}% less with drier leaves and soil surface`);
  if (X.fert) parts.push(`fertiliser ${eur(X.area * X.fertHa)} a year, ${num(X.fertRate)}% less with fewer nitrates washed out`);
  if (X.crop) parts.push(`crop worth ${eur(X.area * X.cropHa)} a year, ${num(X.yieldRate)}% more from steadier soil moisture`);
  return `Today: ${parts.join(", ")}.`;
}
function roiCostText(X) {
  if (!X.priced) return X.lease ? "Enter the HSTI monthly lease price per probe to see the result." : "Enter the HSTI price per probe to see the payback.";
  const pl = `${X.probes} probe${X.probes > 1 ? "s" : ""}`;
  if (X.lease) return `Lease: ${eur(X.leaseYear / 12)} a month for ${pl} (${eur(X.leaseYear)} a year), nothing to buy upfront${X.invest ? ` apart from ${eur(X.invest)} of installation` : ""}${X.subYear ? `, plus ${eur(X.subYear)} a year of subscription` : ""}.`;
  return `Investment: ${eur(X.invest)} for ${pl}${X.install ? ` (installation included)` : ""}${X.grant ? ` after a ${eur(X.grant)} grant` : ""}${X.subYear ? `, then ${eur(X.subYear)} a year of subscription` : ""}.`;
}

// Headline and water story, used in the app and in the report (the report has its own matching styles).
const DROP_SVG = '<svg class="roi-drop" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2.5C9 7 5.5 10.6 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7 12 2.5Z" fill="#0380B8"/><path d="M9 14.5a3 3 0 0 0 3 3" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
function roiSummaryHtml(X, probes = X.probes) {
  const mid = X.scenarios[1];
  const head = `<p class="roi-headline">${probes ? `<b>${probes} probe${probes > 1 ? "s" : ""}</b>: ` : ""}about <b>${eur(mid.saved)} saved every season</b>${X.priced ? `, paying back <b>${paybackText(mid.payback, true)}</b>${mid.gain5 > 0 ? ` and <b>${eur(mid.gain5)} in your pocket after ${ROI_YEARS} years</b>` : ""}` : ""} (expected case).</p>`;
  const story = roiWaterStory(X);
  return head + (story ? `<div class="roi-water">${DROP_SVG}<p>${story}</p></div>` : "");
}
