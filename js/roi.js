"use strict";
// Return on investment: what the probes save on water and pumping energy, against what they cost.
// A probe typically saves 10–30% of irrigation water (HSTI field experience), and pumping hours fall with it.

const ROI_SCENARIOS = [["Low", 0], ["Expected", 1], ["High", 2]];
const ENERGY_LABELS = { none: "No pumping cost", electric: "Electric pump", diesel: "Diesel pump" };

// inp: { area, waterPerHa, waterPrice, energy, flow, kw, kwhPrice, fuelLph, fuelPrice, probes, probePrice, install, sub, rates: [lo, mid, hi] }
// Returns null while the water volume is missing.
function computeRoi(inp) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const volume = n(inp.area) * n(inp.waterPerHa);
  if (!volume) return null;
  const hours = inp.energy !== "none" && n(inp.flow) ? volume / inp.flow : null;
  const energyPerHour = inp.energy === "electric" ? n(inp.kw) * n(inp.kwhPrice) : inp.energy === "diesel" ? n(inp.fuelLph) * n(inp.fuelPrice) : 0;
  const waterCost = volume * n(inp.waterPrice), energyCost = hours ? hours * energyPerHour : 0;
  const invest = n(inp.probes) * n(inp.probePrice) + n(inp.install), subYear = n(inp.probes) * n(inp.sub);
  const priced = n(inp.probePrice) > 0;
  const scenarios = ROI_SCENARIOS.map(([label, k]) => {
    const r = n(inp.rates[k]) / 100, saved = r * (waterCost + energyCost), net = saved - subYear;
    return {
      label, rate: r * 100, m3: r * volume, hours: hours ? r * hours : null, water: r * waterCost, energy: r * energyCost, saved, net,
      payback: priced && net > 0 ? invest / net : null, // in irrigation seasons
      gain3: priced ? 3 * net - invest : null,
    };
  });
  return { ...inp, volume, hours, waterCost, energyCost, invest, subYear, priced, scenarios };
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
    ...(X.hours ? [["Pumping hours saved", (s) => `${num(s.hours)} h`]] : []),
    ...(X.waterCost ? [["Water bill saved", (s) => eur(s.water)]] : []),
    ...(X.energyCost ? [[X.energy === "diesel" ? "Diesel saved" : "Electricity saved", (s) => eur(s.energy)]] : []),
    ["Savings per year", (s) => `<b>${eur(s.saved)}</b>`],
    ...(X.subYear ? [["Net of subscription", (s) => eur(s.net)]] : []),
    ...(X.priced ? [["Payback", (s) => `<b>${paybackText(s.payback)}</b>`], ["Net gain over 3 years", (s) => `<b>${eur(s.gain3)}</b>`]] : []),
  ];
  return `<table class="roi-table"><thead><tr><th></th>${X.scenarios.map((s) => `<th>${s.label}</th>`).join("")}</tr></thead><tbody>${rows.map(([k, f]) => `<tr><th>${k}</th>${X.scenarios.map((s) => `<td>${f(s)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
// Today's situation, in one sentence.
function roiBasis(X) {
  const parts = [`${num(X.area, 1)} ha irrigated with ${num(X.volume)} m³ a year (${num(X.waterPerHa)} m³/ha)`];
  if (X.waterCost) parts.push(`water bill ${eur(X.waterCost)} (${num(X.waterPrice, 2)} €/m³)`);
  if (X.hours) parts.push(`${num(X.hours)} pumping hours at ${num(X.flow)} m³/h`);
  if (X.energyCost) parts.push(`${X.energy === "diesel" ? "diesel" : "electricity"} ${eur(X.energyCost)} (${X.energy === "diesel" ? `${num(X.fuelLph, 1)} L/h at ${num(X.fuelPrice, 2)} €/L` : `${num(X.kw, 1)} kW at ${num(X.kwhPrice, 3)} €/kWh`})`);
  return `Today: ${parts.join(", ")}.`;
}
function roiCostText(X) {
  if (!X.priced) return "Enter the HSTI price per probe to see the payback.";
  return `Investment: ${eur(X.invest)} for ${X.probes} probe${X.probes > 1 ? "s" : ""}${X.install ? ` (installation included)` : ""}${X.subYear ? `, then ${eur(X.subYear)} a year of subscription` : ""}.`;
}
