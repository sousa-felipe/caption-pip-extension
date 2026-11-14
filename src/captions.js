(() => {
  if (window.__cpipLoaded) return;
  const CPIP = (window.CPIP = window.CPIP || {});

  /* Match whole words only */
  const CANVAS_NAME = /subtitle|caption|octopus|libass|jassub|danmaku|(^|[^a-z])(subs?|ass|text-?track)([^a-z]|$)/i;

  /* Caption sources */
  const KNOWN = [
    ".jw-text-track-cue",
    ".vjs-text-track-cue",
    ".plyr__caption",
    ".shaka-text-container div",
    ".art-subtitle p",
    ".art-subtitle div",
    ".dplayer-subtitle",
    "[data-part='cue']",
    ".vds-captions [data-part='cue-display']",
    ".mejs__captions-text",
    ".fp-subtitle",
    ".bmpui-subtitle-region-container",
    ".ytp-caption-segment",
    "[data-testid='cueBoxRowTextCue']",
    "[class*='subtitle' i]",
    "[class*='caption' i]",
    "[class*='subs' i]:not([class*='subscri' i])",
    "[class*='cue' i]",
    "[class*='sub-text' i]",
    "[id*='subtitle' i]",
    "[id*='caption' i]",
  ].join(",");

  /* Things that match the words above but are not captions */
  const BAD_TAG = "button,a,input,select,textarea,[role='button'],[role='menu'],[role='menuitem'],[role='dialog'],[role='listbox'],[role='slider'],[role='tab']";
  const BAD_CLASS = "[class*='control' i],[class*='menu' i],[class*='setting' i],[class*='tooltip' i],[class*='btn' i],[class*='button' i],[class*='popup' i],[class*='toast' i],[class*='title' i]:not([class*='subtitle' i]),[class*='episode' i],[class*='track-select' i]";
  const TIME = /^\d{1,2}:\d{2}(:\d{2})?(\s*\/\s*\d{1,2}:\d{2}(:\d{2})?)?$/;

  function blocked(el, root, v) {
    if (el.closest(BAD_TAG)) return true;
    let n = el;
    for (let i = 0; n && i < 3 && n !== root; i++, n = n.parentElement) {
      if (v && n.contains(v)) break;
      if (n.matches(BAD_CLASS)) return true;
    }
    return false;
  }

  const invisible = (cs) => cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05;

  function shown(el, box) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom) return false;
    /* Check style last */
    return !invisible(getComputedStyle(el));
  }

  const clear = (c) => !c || c === "transparent" || /,\s*0\)$/.test(c);
  const norm = (t) => t.replace(/\s+/g, " ").trim();

  function blockOf(el, root) {
    const text = (el.innerText || "").replace(/ /g, " ").trim();
    if (!text || text.length > 300 || TIME.test(text)) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    let bg = cs.backgroundColor;
    for (let n = el.parentElement, i = 0; clear(bg) && n && i < 2 && n !== root; i++, n = n.parentElement) {
      bg = getComputedStyle(n).backgroundColor;
    }
    return {
      text,
      left: r.left,
      width: r.width,
      top: r.top,
      bottom: r.bottom,
      fs: parseFloat(cs.fontSize) || 16,
      color: cs.color,
      font: cs.fontFamily,
      weight: cs.fontWeight,
      bg: clear(bg) ? "" : bg,
    };
  }

  function domBlocks(v, root, roots) {
    let list = [];
    try {
      list = CPIP.customSel
        ? CPIP.qsaAll([...new Set([...CPIP.knownRoots(), ...roots])], CPIP.customSel)
        : CPIP.qsaAll(roots, KNOWN);
    } catch (e) {}
    const box = v.getBoundingClientRect();
    list = list.filter((el) => !CPIP.isOurs(el) && (CPIP.customSel || !blocked(el, root, v)) && shown(el, box));
    /* Avoid lines drawn twice */
    list = [...new Set(list)];
    list = list.filter((a) => !list.some((b) => b !== a && a.contains(b)));
    return list.map((el) => blockOf(el, root)).filter(Boolean);
  }

  /* Remove repeated captions */
  function dedupe(blocks) {
    const lines = (b) => b.text.split("\n").map(norm).filter(Boolean);
    const sorted = [...blocks].sort((a, b) => lines(b).length - lines(a).length);
    const out = [];
    for (const b of sorted) {
      const mine = lines(b);
      const covered = out.some((o) => {
        const theirs = new Set(lines(o));
        return mine.every((l) => theirs.has(l));
      });
      if (!covered) out.push(b);
    }
    return out;
  }

  /* Join lines of one caption, so they never overlap */
  function stack(blocks) {
    const out = [];
    for (const b of [...blocks].sort((x, y) => x.bottom - y.bottom)) {
      const p = out[out.length - 1];
      const below = p && b.top >= p.top + p.fs * 0.5 && b.top - p.bottom < p.fs * 0.6;
      if (below && Math.abs(b.left + b.width / 2 - (p.left + p.width / 2)) < Math.max(b.width, p.width) * 0.5) {
        const l = Math.min(p.left, b.left);
        const r = Math.max(p.left + p.width, b.left + b.width);
        p.left = l;
        p.width = r - l;
        p.bottom = b.bottom;
        p.text += "\n" + b.text;
      } else out.push({ ...b });
    }
    return out;
  }

  /* Read native tracks (WebVTT) */
  function cueBlocks(v, c, seen) {
    const out = [];
    for (const t of v.textTracks) {
      if (t.mode === "disabled" || !/subtitles|captions/.test(t.kind) || !t.activeCues) continue;
      for (const cue of t.activeCues) {
        const text = String(cue.text || "").replace(/<[^>]+>/g, "").trim();
        if (!text || seen.has(norm(text)) || text.split("\n").every((l) => seen.has(norm(l)))) continue;
        const free = cue.snapToLines === false && typeof cue.line === "number";
        out.push({
          text,
          left: c.left + c.width * 0.05,
          width: c.width * 0.9,
          bottom: c.top + c.height * (free ? CPIP.clamp(cue.line, 5, 98) / 100 : 0.94),
          fs: c.height * 0.045,
          color: "#fff",
          font: "Arial, sans-serif",
          weight: "500",
          bg: "",
        });
      }
    }
    return out;
  }

  /* Find canvas overlays (ASS renderers) */
  function layersOf(roots, c) {
    return CPIP.qsaAll(roots, "canvas").filter((cv) => {
      if (CPIP.isOurs(cv)) return false;
      const r = cv.getBoundingClientRect();
      const w = Math.min(r.right, c.left + c.width) - Math.max(r.left, c.left);
      const h = Math.min(r.bottom, c.top + c.height) - Math.max(r.top, c.top);
      if (w <= 0 || h <= 0 || (w * h) / (c.width * c.height) < 0.4) return false;
      const cs = getComputedStyle(cv);
      if (invisible(cs)) return false;
      return CANVAS_NAME.test(cv.className + " " + cv.id) || cs.pointerEvents === "none";
    });
  }

  /* Last resort for unknown players */
  function looseBlocks(v, root, roots) {
    const box = v.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const all = CPIP.qsaAll(roots, "*");
    if (all.length > 1500) return [];
    const out = [];
    for (const el of all) {
      if (el === v || el.children.length > 3 || !CPIP.hasText(el) || CPIP.isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < box.top + box.height * 0.45 || Math.abs(r.left + r.width / 2 - mid) > box.width * 0.15) continue;
      if (blocked(el, root, v) || !shown(el, box)) continue;
      if (getComputedStyle(el).pointerEvents !== "none") continue;
      out.push(el);
    }
    return out.map((el) => blockOf(el, root)).filter(Boolean);
  }

  function scan(s) {
    const a = s.video;
    const c = CPIP.content(a);
    const root = CPIP.playerRoot(a, c);
    /* Search player and its shadow roots */
    const roots = CPIP.rootsIn(root);
    let blocks = dedupe(stack(domBlocks(a, root, roots)));
    /* Align YouTube captions to the left edge */
    if (a.closest(".html5-video-player")) blocks.forEach((b) => (b.leftAlign = true));
    const seen = new Set();
    for (const b of blocks) {
      seen.add(norm(b.text));
      b.text.split("\n").forEach((l) => seen.add(norm(l)));
    }
    const cues = cueBlocks(a, c, seen);
    if (!blocks.length && !cues.length) blocks = looseBlocks(a, root, roots);
    return { blocks: blocks.concat(cues), layers: layersOf(roots, c), c, root };
  }

  CPIP.scan = scan;
})();
