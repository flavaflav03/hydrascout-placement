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
