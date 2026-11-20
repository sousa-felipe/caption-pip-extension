(() => {
  const loaded = (window.__cpipLoaded = window.__cpipLoaded || {});
  if (loaded.captions || document.documentElement.hasAttribute("data-cpip-pip")) return;
  loaded.captions = true;
  const CPIP = (window.CPIP = window.CPIP || {});

  /* Match whole words only */
  const CANVAS_NAME = /subtitle|caption|octopus|libass|jassub|danmaku|(^|[^a-z])(subs?|ass|text-?track)([^a-z]|$)/i;

  /* Caption sources */
  const CAPTION_SEL = [
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
  const BAD_AREA = "[data-a-target^='player-info' i],[data-a-target*='channel' i],[data-a-target*='stream-info' i],.top-bar,[class*='top-bar' i],[class*='metadata' i]";
  const BAD_CHILD = "a,button,img,svg,picture,input";
  const TIME = /^\d{1,2}:\d{2}(:\d{2})?(\s*\/\s*\d{1,2}:\d{2}(:\d{2})?)?$/;

  function blocked(el, root, video) {
    if (el.closest(BAD_TAG) || el.querySelector(BAD_CHILD)) return true;
    /* Only inside the player, never a wrapper around the video */
    const area = el.closest(BAD_AREA);
    if (area && (!root || root.contains(area)) && !(video && area.contains(video))) return true;
    let node = el;
    for (let i = 0; node && i < 3 && node !== root; i++, node = node.parentElement) {
      if (video && node.contains(video)) break;
      if (node.matches(BAD_CLASS)) return true;
    }
    return false;
  }

  const invisible = (style) => style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.05;

  function shown(el, box) {
    const elBox = el.getBoundingClientRect();
    if (!elBox.width || !elBox.height) return false;
    const centerX = elBox.left + elBox.width / 2;
    const centerY = elBox.top + elBox.height / 2;
    if (centerX < box.left || centerX > box.right || centerY < box.top || centerY > box.bottom) return false;
    /* Check style last */
    return !invisible(getComputedStyle(el));
  }

  const isClear = (color) => !color || color === "transparent" || /,\s*0\)$/.test(color);
  const norm = (text) => text.replace(/\s+/g, " ").trim();

  function blockOf(el, root) {
    const text = (el.innerText || "").replace(/ /g, " ").trim();
    if (!text || text.length > 300 || TIME.test(text)) return null;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    let bg = style.backgroundColor;
    for (let node = el.parentElement, i = 0; isClear(bg) && node && i < 2 && node !== root; i++, node = node.parentElement) {
      bg = getComputedStyle(node).backgroundColor;
    }
    return {
      els: [el],
      text,
      left: box.left,
      width: box.width,
      top: box.top,
      bottom: box.bottom,
      fs: parseFloat(style.fontSize) || 16,
      color: style.color,
      font: style.fontFamily,
      weight: style.fontWeight,
      bg: isClear(bg) ? "" : bg,
    };
  }

  function domBlocks(video, root, roots) {
    let list = [];
    try {
      list = CPIP.customSel
        ? CPIP.qsaAll([...new Set([...CPIP.knownRoots(), ...roots])], CPIP.customSel)
        : CPIP.qsaAll(roots, CAPTION_SEL);
    } catch (e) {
    }
    const box = video.getBoundingClientRect();
    list = list.filter((el) => !CPIP.isOurs(el) && (CPIP.customSel || !blocked(el, root, video)) && shown(el, box));
    /* Avoid lines drawn twice */
    list = list.filter((outer) => !list.some((inner) => inner !== outer && outer.contains(inner)));
    return list.map((el) => blockOf(el, root)).filter(Boolean);
  }

  /* Remove repeated captions */
  function dedupe(blocks) {
    const lines = (block) => block.text.split("\n").map(norm).filter(Boolean);
    const sorted = [...blocks].sort((a, b) => lines(b).length - lines(a).length);
    const out = [];
    for (const block of sorted) {
      const mine = lines(block);
      const covered = out.some((other) => {
        const theirs = new Set(lines(other));
        return mine.every((line) => theirs.has(line));
      });
      if (!covered) out.push(block);
    }
    return out;
  }

  /* Join lines of one caption, so they never overlap */
  function stack(blocks) {
    const out = [];
    for (const block of [...blocks].sort((x, y) => x.bottom - y.bottom)) {
      const prev = out[out.length - 1];
      const below = prev && block.top >= prev.top + prev.fs * 0.5 && block.top - prev.bottom < prev.fs * 0.6;
      if (below && Math.abs(block.left + block.width / 2 - (prev.left + prev.width / 2)) < Math.max(block.width, prev.width) * 0.5) {
        const left = Math.min(prev.left, block.left);
        const right = Math.max(prev.left + prev.width, block.left + block.width);
        prev.left = left;
        prev.width = right - left;
        prev.bottom = block.bottom;
        prev.els = prev.els.concat(block.els);
        prev.text += "\n" + block.text;
      } else out.push({ ...block });
    }
    return out;
  }

  /* Read native tracks (WebVTT) */
  function cueBlocks(video, content, seen) {
    const out = [];
    for (const track of video.textTracks) {
      if (track.mode === "disabled" || !/subtitles|captions/.test(track.kind) || !track.activeCues) continue;
      for (const cue of track.activeCues) {
        const text = String(cue.text || "").replace(/<[^>]+>/g, "").trim();
        if (!text || seen.has(norm(text)) || text.split("\n").every((line) => seen.has(norm(line)))) continue;
        const free = cue.snapToLines === false && typeof cue.line === "number";
        out.push({
          text,
          left: content.left + content.width * 0.05,
          width: content.width * 0.9,
          bottom: content.top + content.height * (free ? CPIP.clamp(cue.line, 5, 98) / 100 : 0.94),
          fs: content.height * 0.045,
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
  function layersOf(roots, content) {
    return CPIP.qsaAll(roots, "canvas").filter((canvas) => {
      if (CPIP.isOurs(canvas)) return false;
      const box = canvas.getBoundingClientRect();
      const overlapW = Math.min(box.right, content.left + content.width) - Math.max(box.left, content.left);
      const overlapH = Math.min(box.bottom, content.top + content.height) - Math.max(box.top, content.top);
      if (overlapW <= 0 || overlapH <= 0 || (overlapW * overlapH) / (content.width * content.height) < 0.4) return false;
      const style = getComputedStyle(canvas);
      if (invisible(style)) return false;
      return CANVAS_NAME.test(canvas.className + " " + canvas.id) || style.pointerEvents === "none";
    });
  }

  /* Last resort for unknown players */
  function looseBlocks(video, root, roots) {
    const box = video.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const all = CPIP.qsaAll(roots, "*");
    if (all.length > 1500) return [];
    const out = [];
    for (const el of all) {
      if (el === video || el.children.length > 3 || !CPIP.hasText(el) || CPIP.isOurs(el)) continue;
      const elBox = el.getBoundingClientRect();
      if (elBox.top < box.top + box.height * 0.45 || Math.abs(elBox.left + elBox.width / 2 - mid) > box.width * 0.15) continue;
      if (blocked(el, root, video) || !shown(el, box)) continue;
      if (getComputedStyle(el).pointerEvents !== "none") continue;
      out.push(el);
    }
    return out.map((el) => blockOf(el, root)).filter(Boolean);
  }

  function scan(s) {
    const video = s.video;
    const content = CPIP.content(video);
    const root = CPIP.playerRoot(video, content);
    /* Search player and its shadow roots */
    const roots = CPIP.rootsIn(root);
    let blocks = dedupe(stack(domBlocks(video, root, roots)));
    /* Align YouTube captions to the left edge */
    if (video.closest(".html5-video-player")) blocks.forEach((block) => (block.leftAlign = true));
    const seen = new Set();
    for (const block of blocks) {
      seen.add(norm(block.text));
      block.text.split("\n").forEach((line) => seen.add(norm(line)));
    }
    const cues = cueBlocks(video, content, seen);
    if (!blocks.length && !cues.length) blocks = looseBlocks(video, root, roots);
    return { blocks: blocks.concat(cues), layers: layersOf(roots, content), content, root };
  }

  /* Per-frame update of caption positions */
  function trackBlocksMotion(caps) {
    let moved = false;
    for (const block of caps.blocks) {
      if (!block.els) continue;
      let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;
      for (const el of block.els) {
        if (!el.isConnected) return moved;
        const box = el.getBoundingClientRect();
        left = Math.min(left, box.left);
        right = Math.max(right, box.right);
        top = Math.min(top, box.top);
        bottom = Math.max(bottom, box.bottom);
      }
      if (left !== block.left || right - left !== block.width || bottom !== block.bottom || top !== block.top) moved = true;
      block.left = left;
      block.width = right - left;
      block.top = top;
      block.bottom = bottom;
    }
    return moved;
  }

  /* Read captions from the page for Document PiP */
  function scanDoc(s) {
    const blocks = [];
    const box = s.placeholder.getBoundingClientRect();
    const custom = CPIP.customSel;
    try {
      const roots = CPIP.rootsIn(s.playerRoot);
      let els = CPIP.qsaAll(roots, custom || CAPTION_SEL).filter((el) => {
        if (CPIP.isOurs(el) || (!custom && blocked(el, s.playerRoot, null))) return false;
        /* Skip faded text */
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const elBox = el.getBoundingClientRect();
        if (!elBox.width || !elBox.height) return false;
        const centerX = elBox.left + elBox.width / 2;
        const centerY = elBox.top + elBox.height / 2;
        return centerX >= box.left && centerX <= box.right && centerY >= box.top && centerY <= box.bottom;
      });
      els = els.filter((outer) => !els.some((inner) => inner !== outer && outer.contains(inner)));
      for (const el of els) {
        const text = (el.innerText || "").trim();
        if (!text || text.length > 300) continue;
        const style = getComputedStyle(el);
        blocks.push({
          text,
          color: style.color,
          bg: isClear(style.backgroundColor) ? "" : style.backgroundColor,
          font: style.fontFamily,
          weight: style.fontWeight,
          shadow: style.textShadow,
          size: box.height ? parseFloat(style.fontSize) / box.height : 0,
        });
      }
    } catch (e) {
      console.warn("[Caption pip] page caption scan failed", e);
    }
    try {
      for (const track of s.video.textTracks) {
        if (track.mode === "disabled" || !/subtitles|captions/.test(track.kind) || !track.activeCues) continue;
        for (const cue of track.activeCues) {
          const text = String(cue.text || "").replace(/<[^>]+>/g, "").trim();
          if (text) blocks.push({ text, color: "#fff", bg: "" });
        }
      }
    } catch (e) {
      console.warn("[Caption pip] text track scan failed", e);
    }
    const seen = new Set();
    return blocks.filter((block) => {
      const text = norm(block.text);
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    });
  }

  /* False only when no captions exist */
  function hasCaptions(video) {
    if (CPIP.customSel) return true;
    try {
      if ([...video.textTracks].some((track) => /subtitles|captions/.test(track.kind))) return true;
      const content = CPIP.content(video);
      const roots = CPIP.rootsIn(CPIP.playerRoot(video, content));
      if (CPIP.qsaAll(roots, CAPTION_SEL).some((el) => !CPIP.isOurs(el))) return true;
      return layersOf(roots, content).length > 0;
    } catch (e) {
      console.warn("[Caption pip] caption check failed", e);
      return true;
    }
  }

  /* Share with pip.js and documentpip.js */
  CPIP.hasCaptions = hasCaptions;
  CPIP.scan = scan;
  CPIP.trackBlocksMotion = trackBlocksMotion;
  CPIP.scanDoc = scanDoc;
})();
