// A script the side browser puts into every page it shows, so the page can
// be used without the mouse. Obsidian's hotkeys can't hear keys pressed
// inside a web page, so anything Obsidian has to do (zoom, go back to your
// note, …) is passed back as a console message starting "__curious:",
// which the pane listens for.
//
// Keys (when you're not typing in a box on the page). Kept to a few on
// purpose; Space / Shift+Space and the arrow keys also scroll as usual.
//   f           show a letter on every link and button; type it to follow
//   j / k       scroll down / up               H / L   back / forward
//   o           type an address or search
//   Esc         back to your note (in a text box: leave the box first)
//   Alt+O       back to your note, even from a text box
//   Alt+F       over to the chat
//   Alt+← / →   back / forward                 Ctrl+= / - / 0 and Ctrl+scroll: zoom
//
// It's plain JavaScript in a string because it runs in the web page, not in
// Obsidian.

export const PAGE_SCRIPT = `(() => {
  if (window.__curious) return;
  window.__curious = true;
  const say = (what) => console.log("__curious:" + what);

  const isField = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // What scrolls: usually the page itself, but some sites scroll an inner box.
  const scroller = () => {
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight > root.clientHeight + 10) return root;
    let best = root, bestArea = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (el.scrollHeight <= el.clientHeight + 10) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (overflow !== "auto" && overflow !== "scroll") continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best;
  };
  // Scroll by a number of screens (negative = up); the pane calls this too.
  window.__curiousScroll = (screens) => {
    const el = scroller();
    const height = el === document.scrollingElement || el === document.documentElement ? innerHeight : el.clientHeight;
    el.scrollBy({ top: screens * height, behavior: "smooth" });
  };

  // ---- Link hints: press f, then the letters on what you want ----
  const LETTERS = "asdfghjklqwertyuiopzxcvbnm";
  const CLICKABLE = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role="button"], [role="link"], [role="tab"], [onclick]';
  let hints = null;

  const showHints = () => {
    const found = [...document.querySelectorAll(CLICKABLE)].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    }).slice(0, LETTERS.length * LETTERS.length);
    if (found.length === 0) return;
    // One letter each if there are few enough, otherwise two.
    const n = LETTERS.length;
    const label = (i) => found.length <= n ? LETTERS[i] : LETTERS[Math.floor(i / n)] + LETTERS[i % n];
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const items = found.map((el, i) => {
      const r = el.getBoundingClientRect();
      const tag = document.createElement("span");
      tag.textContent = label(i);
      tag.style.cssText = "position:fixed;left:" + Math.max(0, r.left) + "px;top:" + Math.max(0, r.top) + "px;" +
        "background:#ffd84d;color:#000;font:bold 12px/1.3 monospace;padding:0 4px;border-radius:3px;" +
        "border:1px solid #b38f00;box-shadow:0 1px 3px rgba(0,0,0,.4);text-transform:uppercase";
      box.appendChild(tag);
      return { el, label: label(i), tag };
    });
    document.documentElement.appendChild(box);
    hints = { items, typed: "", box };
  };
  const hideHints = () => { if (hints) hints.box.remove(); hints = null; };
  const follow = (el) => {
    hideHints();
    el.focus();
    if (isField(el)) return; // a text box: just put the cursor in it
    if (el.tagName === "A") el.target = "_self"; // no tabs here, so open in place
    el.click();
  };
  const hintKey = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") return hideHints();
    if (e.key === "Backspace") hints.typed = hints.typed.slice(0, -1);
    else if (/^[a-z]$/i.test(e.key)) hints.typed += e.key.toLowerCase();
    else return;
    const matches = hints.items.filter((h) => h.label.startsWith(hints.typed));
    if (matches.length === 0) return hideHints();
    if (matches.length === 1 && matches[0].label === hints.typed) return follow(matches[0].el);
    for (const h of hints.items) h.tag.style.display = h.label.startsWith(hints.typed) ? "" : "none";
  };

  // ---- Keys ----
  const KEYS = {
    j: () => window.__curiousScroll(0.3),
    k: () => window.__curiousScroll(-0.3),
    f: showHints,
    H: () => say("back"),
    L: () => say("forward"),
    o: () => say("address"),
  };

  addEventListener("keydown", (e) => {
    if (hints) return hintKey(e);
    const ctrl = e.ctrlKey || e.metaKey;
    const handled = (what) => { e.preventDefault(); e.stopImmediatePropagation(); if (what) say(what); };

    if (ctrl && !e.altKey) {
      const zoom = { "=": "zoom-in", "+": "zoom-in", "-": "zoom-out", "0": "zoom-reset" }[e.key];
      if (zoom) handled(zoom);
      return;
    }
    if (e.altKey && !ctrl) {
      const what = { KeyO: "to-note", KeyF: "to-chat", ArrowLeft: "back", ArrowRight: "forward" }[e.code];
      if (what) handled(what);
      return;
    }
    if (e.key === "Escape") {
      // In a text box, the first Esc leaves the box; the next one goes back.
      if (isField(document.activeElement)) document.activeElement.blur();
      else say("to-note");
      return;
    }
    if (isField(document.activeElement) || e.altKey) return; // typing: leave keys alone
    const action = KEYS[e.key];
    if (action) { handled(); action(); }
  }, true);

  addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    say(e.deltaY < 0 ? "zoom-in" : "zoom-out");
  }, { passive: false, capture: true });

  // Hints point at where things were; if the page moves, they're wrong.
  addEventListener("scroll", hideHints, true);

  // "Open in a new tab" links open here instead, since this pane has no tabs.
  addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[target]");
    if (a) a.target = "_self";
  }, true);
})();`;
