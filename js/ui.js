/* Small interface helpers: the brand logo in the header, and long help texts folded to two lines with a "More" link. */
"use strict";
(function () {
  const logo = document.getElementById("brandLogo");
  if (logo && typeof BRAND !== "undefined") logo.innerHTML = BRAND.logo;

  // Help paragraphs under each step: show two lines, the rest on demand. Texts that fit stay as they are.
  const fold = (p) => {
    if (p.dataset.fold) return;
    p.dataset.fold = "1";
    p.classList.add("clamp");
    const b = document.createElement("button");
    b.type = "button"; b.className = "hint-more"; b.textContent = "More"; b.hidden = true;
    b.setAttribute("aria-expanded", "false");
    if (p.id) b.setAttribute("aria-controls", p.id);
    p.after(b);
    b.addEventListener("click", () => {
      const open = p.classList.toggle("open");
      b.textContent = open ? "Less" : "More";
      b.setAttribute("aria-expanded", String(open));
    });
    const check = () => {
      if (p.classList.contains("open")) { b.hidden = p.hidden; return; }
      b.hidden = p.hidden || p.scrollHeight <= p.clientHeight + 2;
    };
    if ("ResizeObserver" in window) new ResizeObserver(check).observe(p);
    new MutationObserver(check).observe(p, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    check();
  };
  document.querySelectorAll("#panel section.step > p.hint").forEach(fold);
})();

/* Step-by-step panel: one step open at a time, a "Next" button at the bottom of each step,
   and closed steps reduced to their title and a one-line summary of what was entered.
   Any step can be reopened by tapping its title. Results open on their own when they appear. */
document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("panel");
  if (!panel) return;
  const $ = (id) => document.getElementById(id);
  const txt = (id) => { const e = $(id); return e && !e.hidden ? e.textContent.trim() : ""; };
  const sel = (id) => { const e = $(id); return e && e.selectedIndex >= 0 ? e.options[e.selectedIndex].text : ""; };
  const steps = () => [...panel.querySelectorAll(":scope > section.step:not(#roiStep)")]
    .filter((s) => !s.hidden && getComputedStyle(s).display !== "none");
  const visibleTitle = (s) => { const h = s.querySelector("h2"); let t = "";
    h.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent; else if (!n.matches("b, .tag") && getComputedStyle(n).display !== "none") t += n.textContent; });
    return t.trim(); };

  // One line per step, read from what the app already shows.
  const SUM = {
    probeStep: () => { const n = panel.querySelectorAll("#probeList li").length; return n ? `${n} probe${n > 1 ? "s" : ""}` : "No probes yet"; },
    stepField: () => $("q").value.trim() || "Not searched yet",
    stepBlocks: () => [txt("fieldName"), $("fieldName").value.trim(), txt("blocksSummary") || txt("fieldInfo")].filter(Boolean).join(" · "),
    stepVigour: () => [txt("ndviMeta") || "No satellite image yet", $("soilMap").value !== "off" ? `soil map: ${sel("soilMap")}` : ""].filter(Boolean).join(" · "),
    stepIrr: () => sel("irrType"),
    stepCrop: () => ($("crop").value ? sel("crop") : "Not set"),
    stepSpots: () => (panel.dataset.mode === "check" ? `Keep ${$("buffer").value} m from borders` : `${$("nSensors").value === "auto" ? sel("nSensors") : `${$("nSensors").value} probe${$("nSensors").value === "1" ? "" : "s"}`} · ${$("buffer").value} m from borders`),
    results: () => { const n = panel.querySelectorAll("#sensorList .sensor").length; return n ? `${n} spot${n > 1 ? "s" : ""} found` : ""; },
    checkResults: () => txt("checkHeadline"),
  };

  const all = [...panel.querySelectorAll(":scope > section.step:not(#roiStep)")];
  all.forEach((s) => {
    const h = s.querySelector("h2");
    h.classList.add("step-toggle");
    h.tabIndex = 0; h.setAttribute("role", "button");
    const sum = document.createElement("p"); sum.className = "step-sum"; h.after(sum);
    if (s.id !== "results" && s.id !== "checkResults" && s.id !== "stepSpots") {
      const nav = document.createElement("div"); nav.className = "step-nav";
      nav.innerHTML = `<button type="button" class="next">Next</button>` + (s.id === "stepBlocks" || s.dataset.optional != null ? `<button type="button" class="link skip">Skip to the sensor spots</button>` : "");
      s.append(nav);
      nav.querySelector(".next").addEventListener("click", () => go(s, 1));
      const sk = nav.querySelector(".skip"); if (sk) sk.addEventListener("click", () => open($("stepSpots"), true));
    }
    h.addEventListener("click", () => (s.classList.contains("shut") ? open(s, true) : null));
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); h.click(); } });
    // Typing or tabbing into a closed step (e.g. the app focuses a field there) opens it.
    s.addEventListener("focusin", (e) => { if (s.classList.contains("shut") && e.target !== h) open(s); });
  });

  function refresh() {
    const vis = steps();
    all.forEach((s) => {
      const f = SUM[s.id];
      s.querySelector(".step-sum").textContent = f ? f() : "";
      s.querySelector("h2").setAttribute("aria-expanded", String(!s.classList.contains("shut")));
      const nb = s.querySelector(".step-nav .next");
      if (nb) { const nx = vis[vis.indexOf(s) + 1]; nb.hidden = !nx; if (nx) nb.textContent = `Next: ${visibleTitle(nx)}`; }
    });
  }
  function open(s, scroll) {
    if (!s) return;
    all.forEach((o) => o.classList.toggle("shut", o !== s));
    refresh();
    if (scroll) {
      const top = s.offsetTop - panel.offsetTop - 8;
      if (panel.scrollHeight > panel.clientHeight) panel.scrollTo({ top, behavior: "smooth" });
      else s.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  function go(s, d) { const v = steps(); open(v[v.indexOf(s) + d], true); }
  const first = () => open(steps()[0]);

  // Results appear: open them. Mode chosen or changed: start at the first step.
  const watch = (id) => { const e = $(id); if (e) new MutationObserver(() => { if (!e.hidden) open(e, true); else if (!e.classList.contains("shut")) open($("stepSpots")); }).observe(e, { attributes: true, attributeFilter: ["hidden"] }); };
  watch("results"); watch("checkResults");
  new MutationObserver(first).observe(panel, { attributes: true, attributeFilter: ["data-mode"] });
  panel.addEventListener("input", () => setTimeout(refresh));
  panel.addEventListener("change", () => setTimeout(refresh));
  const open0 = all.find((s) => !s.hidden && getComputedStyle(s).display !== "none" && (s.id === "results" || s.id === "checkResults"));
  open0 ? open(open0) : first();
});
