(() => {
  /* Core */
  if (window.__cpipLoaded) return;
  window.__cpipLoaded = true;

  /* Share with captions.js and pip.js */
  const CPIP = (window.CPIP = window.CPIP || {});
  CPIP.customSel = "";

  /* Borrow the parent's hostname */
  const HOST =
    location.hostname ||
    (() => {
      try {
        const a = location.ancestorOrigins;
        return a && a.length ? new URL(a[0]).hostname : "";
      } catch (e) {
        return "";
      }
    })();
  const STORE = HOST ? "sel:" + HOST : "";
  const SITE = HOST || "this page";
  const MSG = "caption-pip";
  const PICK_EVENTS = ["click", "mousedown", "mouseup", "pointerdown", "pointerup"];
  const MEDIA_EVENTS = ["loadedmetadata", "play", "pause", "emptied", "resize"];

  let videos = [];
  let hoverVideo = null;
  let hoverFrame = null;
  let picking = false;
  let lastRefresh = 0;
  const kids = new Map();
  const shadows = new Set();

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const isOurs = (el) => !!el.closest?.("#cpip-button,#cpip-pick,#cpip-hint,#cpip-toast,#cpip-hl,.cpip-out");
  const area = (v) => {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  };

  /* Pick where to attach elements */
  function mount() {
    const f = document.fullscreenElement;
    return f && f.tagName !== "VIDEO" ? f : document.documentElement;
  }

  /* Shadow DOM */
  function shadowRootsIn(root, out = []) {
    for (const el of root.querySelectorAll("*")) {
      if (!el.shadowRoot) continue;
      out.push(el.shadowRoot);
      shadowRootsIn(el.shadowRoot, out);
    }
    return out;
  }

  /* Cache roots of shadow DOM */
  const rootsCache = new WeakMap();
  function rootsIn(root, ttl = 2000) {
    const now = performance.now();
    const hit = rootsCache.get(root);
    if (hit && now - hit.at < ttl) return hit.list;
    const list = [root, ...shadowRootsIn(root)];
    rootsCache.set(root, { at: now, list });
    return list;
  }

  /* Query roots without repeats */
  const qsaAll = (roots, sel) => [...new Set(roots.flatMap((r) => [...r.querySelectorAll(sel)]))];

  /* Walk full page for shadow roots */
  const learnShadows = (root = document) => shadowRootsIn(root).forEach((r) => shadows.add(r));

  /* Learn shadow roots under pointer */
  function learnFromPath(e) {
    let found = false;
    for (const n of e.composedPath()) {
      if (n instanceof ShadowRoot && !shadows.has(n)) {
        shadows.add(n);
        learnShadows(n);
        found = true;
      }
    }
    return found;
  }

  function knownRoots() {
    for (const r of shadows) if (!r.host.isConnected) shadows.delete(r);
    return [document, ...shadows];
  }

  /* Video finder */
  function usable(v) {
    const r = v.getBoundingClientRect();
    return v.isConnected && r.width >= 160 && r.height >= 90 && v.videoWidth > 0;
  }

  function refreshVideos() {
    lastRefresh = performance.now();
    videos = qsaAll(knownRoots(), "video").filter(usable);
    if (videos.length) ensureButton();
    announce();
  }

  /* Refresh on media events */
  let refreshTimer = 0;
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      refreshVideos();
    }, 250);
  }

  function onMedia(e) {
    const t = e.target;
    if (t === window || (t instanceof HTMLMediaElement && !t.classList.contains("cpip-out"))) scheduleRefresh();
  }

  function videoAt(x, y) {
    return (
      videos
        .filter((v) => {
          const r = v.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        })
        .sort((a, b) => area(b) - area(a))[0] || null
    );
  }

  /* Pick playing video, then biggest */
  function bestVideo() {
    return [...videos].sort((a, b) => (b.paused ? 0 : 1e9) + area(b) - ((a.paused ? 0 : 1e9) + area(a)))[0] || null;
  }

  /* Pick video under pointer or best one */
  const targetVideo = () => (hoverVideo && hoverVideo.isConnected && videos.includes(hoverVideo) ? hoverVideo : bestVideo());

  /* Create span with text */
  function span(text, cls) {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  /* Get picture area without black bars */
  function content(v) {
    const r = v.getBoundingClientRect();
    const fit = getComputedStyle(v).objectFit;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh || fit === "fill") return { left: r.left, top: r.top, width: r.width, height: r.height };
    const k = fit === "cover" ? Math.max(r.width / vw, r.height / vh) : Math.min(r.width / vw, r.height / vh);
    const w = vw * k;
    const h = vh * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  /* Get parent across shadow DOM */
  const up = (el) => el.parentElement || (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

  /* Search captions */
  function playerRoot(v, c) {
    if (window.top !== window && c.width * c.height > innerWidth * innerHeight * 0.7) return document.body;
    /* YouTube captions live inside the player */
    const yt = v.closest(".html5-video-player");
    if (yt) return yt;
    let root = up(v) || v.getRootNode();
    let el = up(v);
    const a = c.width * c.height;
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > a * 1.8 || r.width < c.width * 0.95 || r.height < c.height * 0.95) break;
      root = el;
      el = up(el);
    }
    return root;
  }

  /* Check element has own text */
  const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  function toggle() {
    learnShadows();
    refreshVideos();
    kidFrames();
    if (!CPIP.active() && !videos.length && kids.size) return forward();
    if (CPIP.active()) CPIP.stop();
    else CPIP.start(targetVideo());
  }

  /* Messages */
  let toastEl = null;
  let toastTimer = null;

  /* Keep messages centered on player */
  const pinned = new Map();
  let pinRaf = 0;

  function placePinned(el, pv) {
    const r = pv.getBoundingClientRect();
    const m = mount();
    const o = m === document.documentElement ? { left: -scrollX, top: -scrollY } : m.getBoundingClientRect();
    el.style.left = r.left + r.width / 2 - o.left + "px";
    el.style.top = r.top + r.height / 2 - o.top + "px";
  }

  function pinLoop() {
    pinRaf = 0;
    for (const [el, pv] of pinned) {
      if (!el.isConnected || !pv.isConnected) pinned.delete(el);
      else placePinned(el, pv);
    }
    if (pinned.size) pinRaf = requestAnimationFrame(pinLoop);
  }

  function centerOnPlayer(el) {
    const pv = targetVideo();
    if (!pv) return;
    pinned.set(el, pv);
    placePinned(el, pv);
    if (!pinRaf) pinRaf = requestAnimationFrame(pinLoop);
  }

  /* Toasts */
  function toast(msg, who) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "cpip-toast";
    }
    if (!toastEl.isConnected) mount().appendChild(toastEl);
    centerOnPlayer(toastEl);
    toastEl.replaceChildren(...(who ? [span(who, "cpip-who"), span(msg)] : [span(msg)]));
    toastEl.classList.add("cpip-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("cpip-show");
      pinned.delete(toastEl);
    }, 2600);
  }

  /* Frame bridge */
  function send(win, data) {
    try {
      win.postMessage(data, { targetOrigin: "*", includeUserActivation: true });
    } catch (e) {
      try {
        win.postMessage(data, "*");
      } catch (e2) {}
    }
  }

  /* Tell parent frame about videos */
  let sent = "";
  function announce() {
    if (window.top === window) return;
    const k = [...kids.values()];
    const has = videos.length > 0 || kids.size > 0;
    const on = CPIP.active() || k.some((x) => x.on);
    const playing = videos.some((v) => !v.paused) || k.some((x) => x.playing);
    const key = `${has}|${on}|${playing}`;
    if (key === sent) return;
    sent = key;
    send(parent, { [MSG]: "video", has, on, playing });
  }

  /* Find child frames with video */
  function kidFrames() {
    const live = new Set();
    for (let i = 0; i < frames.length; i++) live.add(frames[i]);
    for (const w of kids.keys()) if (!live.has(w)) kids.delete(w);
    return qsaAll(knownRoots(), "iframe").filter((f) => kids.has(f.contentWindow));
  }

  /* Find iframe under pointer */
  function frameAt(x, y) {
    let best = null;
    let max = 0;
    for (const f of kidFrames()) {
      const r = f.getBoundingClientRect();
      const a = r.width * r.height;
      if (r.width < 160 || r.height < 90 || x < r.left || x > r.right || y < r.top || y > r.bottom || a < max) continue;
      best = f;
      max = a;
    }
    return best;
  }

  /* Pick active frame, then playing, then biggest */
  function bestKid() {
    const score = (f) => {
      const k = kids.get(f.contentWindow);
      return (k.on ? 4e9 : 0) + (k.playing ? 2e9 : 0) + area(f);
    };
    const f = kidFrames().sort((a, b) => score(b) - score(a))[0];
    return f ? f.contentWindow : [...kids.keys()][0] || null;
  }

  /* Pass action to player frame */
  function forward(win, what = "toggle") {
    const w = win || bestKid();
    if (w) send(w, { [MSG]: what });
  }

  const isChild = (w) => {
    try {
      return w.parent === window;
    } catch (e) {
      return false;
    }
  };

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || !(MSG in d) || !e.source || e.source === window) return;
    const fromParent = e.source === parent;
    if (d[MSG] === "video" && isChild(e.source)) {
      if (d.has) kids.set(e.source, { on: !!d.on, playing: !!d.playing });
      else kids.delete(e.source);
      updateButton();
    } else if (d[MSG] === "toggle" && fromParent) {
      toggle();
    } else if (d[MSG] === "pick" && fromParent) {
      startPick();
    } else if (d[MSG] === "ping" && fromParent) {
      sent = "";
      announce();
    }
  });

  /* Buttons */
  const ICON =
    '<svg viewBox="0 0 36 36" aria-hidden="true">' +
    '<rect x="3" y="6" width="30" height="24" rx="1.5" fill="none" stroke="#fff" stroke-width="3"/>' +
    '<rect x="18" y="18" width="10.5" height="7.5" fill="#fff"/></svg>';

  /* Pick icon */
  const ICON_PICK =
    '<svg viewBox="0 0 36 36" aria-hidden="true">' +
    '<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M13.5 19.5V8.25a2.25 2.25 0 0 1 4.5 0V9.5h2a1.75 1.75 0 0 1 1.75 1.75h1.75a1.75 1.75 0 0 1 1.75 1.75' +
    'h1.75a1.75 1.75 0 0 1 1.75 1.75V23.5c0 3.5-2 6-4.5 7H15C12.5 27.5 9.5 23 7.5 19c-.6-1.2.4-2.3 1.6-2' +
    'c1.8.4 3.4 1.3 4.4 2.5Z"/>' +
    '<path d="M18 9.5v5.5M21.75 11.25v4.25M25.25 13v3"/></g></svg>';

  /* Plus icon */
  const PLUS = '<svg viewBox="0 0 9 9" aria-hidden="true"><path d="M4.5 1v7M1 4.5h7" fill="none" stroke="#fff" stroke-width="1"/></svg>';

  /* Shortcuts */
  const KEYS_PIP = ["Alt", "Shift", "P"];
  const KEYS_PICK = ["Alt", "Shift", "S"];
  const keysLabel = (keys) => keys.join("+");

  /* Recreate YouTube default tooltip */
  function setTip(b, label, keys) {
    let t = b.querySelector(".cpip-tip");
    if (!t) b.appendChild((t = span("", "cpip-tip")));
    const k = span("", "cpip-keys");
    keys.forEach((key, i) => {
      if (i) {
        const p = span("", "cpip-plus");
        p.innerHTML = PLUS;
        k.appendChild(p);
      }
      k.appendChild(span(key, "cpip-key"));
    });
    t.replaceChildren(span(label), k);
  }

  let btn = null;
  let pickBtn = null;
  let btnLabel = "";

  /* Send click to iframe or handle here */
  function makeButton(id, icon, onClick) {
    const b = document.createElement("button");
    b.id = id;
    b.innerHTML = icon;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e, hoverFrame && hoverFrame.isConnected && !hoverVideo ? hoverFrame.contentWindow : null);
    });
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    return b;
  }

  function ensureButton() {
    if (!btn) {
      btn = makeButton("cpip-button", ICON, (_, win) => (win ? forward(win) : toggle()));
      updateButton();
    }
    if (!pickBtn) {
      pickBtn = makeButton("cpip-pick", ICON_PICK, (_, win) => (win ? forward(win, "pick") : startPick()));
      pickBtn.setAttribute("aria-label", `Pick caption (${keysLabel(KEYS_PICK)})`);
      setTip(pickBtn, "Pick caption", KEYS_PICK);
    }
    const m = mount();
    if (btn.parentNode !== m) m.appendChild(btn);
    if (pickBtn.parentNode !== m) m.appendChild(pickBtn);
  }

  function updateButton() {
    announce();
    if (!btn) return;
    const on = hoverFrame && hoverFrame.isConnected ? !!(kids.get(hoverFrame.contentWindow) || {}).on : CPIP.active();
    const label = on ? "Exit caption pip" : "Caption pip";
    btn.classList.toggle("cpip-on", on);
    /* Update tooltip on label change */
    if (label === btnLabel) return;
    btnLabel = label;
    btn.setAttribute("aria-label", `${label} (${keysLabel(KEYS_PIP)})`);
    setTip(btn, label, KEYS_PIP);
  }

  function placeButton(v) {
    const r = v.getBoundingClientRect();
    const top = clamp(r.top, 0, innerHeight) + 10 + "px";
    const right = clamp(r.right, 0, innerWidth) - 10;
    btn.style.top = pickBtn.style.top = top;
    btn.style.left = right - 49 + "px";
    pickBtn.style.left = right - 49 - 43 + "px";
  }

  const hideButton = () => [btn, pickBtn].forEach((b) => b && b.classList.remove("cpip-show"));

  /* Check hot zone, top right of video */
  function inHotzone(el, x, y) {
    const r = el.getBoundingClientRect();
    const top = clamp(r.top, 0, innerHeight);
    const right = clamp(r.right, 0, innerWidth);
    return x >= right - 180 && x <= right && y >= top && y <= top + 80;
  }

  let lastMove = 0;
  window.addEventListener(
    "mousemove",
    (e) => {
      const now = performance.now();
      if (now - lastMove < 80 || picking) return;
      lastMove = now;
      /* Refresh videos resized without events */
      if (learnFromPath(e) || now - lastRefresh > 1000) refreshVideos();
      if (!videos.length && !kids.size) return;
      const v = videoAt(e.clientX, e.clientY);
      const f = v ? null : frameAt(e.clientX, e.clientY);
      /* Reset hover on pointer leave */
      hoverVideo = v;
      hoverFrame = f;
      if (!v && !f) return hideButton();
      if (!inHotzone(v || f, e.clientX, e.clientY)) return hideButton();
      ensureButton();
      updateButton();
      placeButton(v || f);
      [btn, pickBtn].forEach((b) => b.classList.add("cpip-show"));
    },
    { capture: true, passive: true }
  );

  /* Hide buttons on page leave */
  document.documentElement.addEventListener("mouseleave", () => {
    if (picking) return;
    hoverVideo = hoverFrame = null;
    hideButton();
  });

  /* Caption picker */
  let hl = null;
  let hint = null;

  function cssPath(el) {
    const scope = el.getRootNode();
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement) {
      if (n.id && !/\d{4,}/.test(n.id)) {
        parts.unshift("#" + CSS.escape(n.id));
        break;
      }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((k) => /^[a-z][\w-]{1,32}$/i.test(k) && !/\d{3,}/.test(k)).slice(0, 2);
      if (cls.length) p += "." + cls.map((k) => CSS.escape(k)).join(".");
      parts.unshift(p);
      if (cls.length) {
        try {
          const count = scope.querySelectorAll(parts.join(" > ")).length;
          if (count >= 1 && count <= 6) break;
        } catch (e) {}
      }
    }
    return parts.join(" > ");
  }

  /* Find text under pointer */
  function textAt(x, y) {
    const v = videoAt(x, y);
    if (!v) return null;
    const root = playerRoot(v, content(v));
    let best = null;
    let bestA = Infinity;
    for (const el of qsaAll(rootsIn(root, 1000), "*")) {
      if (el === v || !hasText(el) || isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width * r.height >= bestA) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      best = el;
      bestA = r.width * r.height;
    }
    return best;
  }

  const swallow = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /* Limit lookup to one per frame */
  let pickRaf = 0;
  let pickXY = null;
  function onPickMove(e) {
    pickXY = [e.clientX, e.clientY];
    if (pickRaf) return;
    pickRaf = requestAnimationFrame(() => {
      pickRaf = 0;
      if (!picking) return;
      const el = textAt(...pickXY);
      if (!el) return (hl.style.display = "none");
      const r = el.getBoundingClientRect();
      hl.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    });
  }

  function onPickClick(e) {
    swallow(e);
    const el = textAt(e.clientX, e.clientY);
    if (!el) return;
    saveSel(cssPath(el));
    stopPick();
    toast("Caption source saved for " + SITE);
  }

  const pickHandler = (t) => (t === "click" ? onPickClick : swallow);

  function startPick() {
    if (picking) return;
    learnShadows();
    refreshVideos();
    kidFrames();
    if (!videos.length && kids.size) return forward(null, "pick");
    if (!videos.length) return toast("No video found here", "Pick caption");
    const pv = targetVideo();
    if (pv && pv.mediaKeys) return toast("Protected by DRM", "Pick caption");
    picking = true;
    hideButton();
    hl = document.createElement("div");
    hl.id = "cpip-hl";
    hint = document.createElement("div");
    hint.id = "cpip-hint";
    hint.append(span("Click the caption text while it is on screen"), span("Esc", "cpip-key"), span("Cancel"), span("Del", "cpip-key"), span("Reset"));
    mount().append(hl, hint);
    centerOnPlayer(hint);
    window.addEventListener("mousemove", onPickMove, true);
    PICK_EVENTS.forEach((t) => window.addEventListener(t, pickHandler(t), true));
  }

  function stopPick() {
    picking = false;
    cancelAnimationFrame(pickRaf);
    pickRaf = 0;
    hl && hl.remove();
    hint && hint.remove();
    window.removeEventListener("mousemove", onPickMove, true);
    PICK_EVENTS.forEach((t) => window.removeEventListener(t, pickHandler(t), true));
  }

  /* Save selector per site */
  const store = globalThis.chrome && chrome.storage && chrome.storage.local;

  function saveSel(sel) {
    CPIP.customSel = sel;
    try {
      STORE && store && store.set({ [STORE]: sel });
    } catch (e) {}
  }

  try {
    if (STORE && store) {
      store.get(STORE, (o) => (CPIP.customSel = (o && o[STORE]) || ""));
      chrome.storage.onChanged.addListener((ch, a) => {
        if (a === "local" && ch[STORE]) CPIP.customSel = ch[STORE].newValue || "";
      });
    }
  } catch (e) {}

  /* Keyboard shortcut */
  const ACTIONS = { KeyP: toggle, KeyS: startPick };
  window.addEventListener(
    "keydown",
    (e) => {
      if (picking) {
        if (e.key === "Escape") {
          swallow(e);
          stopPick();
          toast("Caption pick cancelled");
        } else if (e.key === "Delete" || e.key === "Backspace") {
          swallow(e);
          saveSel("");
          stopPick();
          toast("Caption source reset for " + SITE);
        }
        return;
      }
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const action = ACTIONS[e.code];
      if (!action) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      action();
    },
    true
  );

  /* Share with captions.js and pip.js */
  Object.assign(CPIP, { clamp, isOurs, hasText, content, playerRoot, toast, updateButton, rootsIn, qsaAll, knownRoots });

  /* Lifecycle */
  MEDIA_EVENTS.forEach((t) => window.addEventListener(t, onMedia, true));
  document.addEventListener("fullscreenchange", () => {
    scheduleRefresh();
    if (btn) ensureButton();
  });
  window.addEventListener("pagehide", () => {
    CPIP.stop();
    if (window.top !== window) send(parent, { [MSG]: "video", has: false });
    sent = "";
  });
  window.addEventListener("pageshow", (e) => e.persisted && refreshVideos());

  refreshVideos();
  /* Ask child frames to announce again */
  for (let i = 0; i < frames.length; i++) send(frames[i], { [MSG]: "ping" });
  /* Walk shadow DOM when idle */
  (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => {
    const n = shadows.size;
    learnShadows();
    if (shadows.size !== n) refreshVideos();
  });
})();
