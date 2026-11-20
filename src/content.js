(() => {
  /* Core */
  const loaded = (window.__cpipLoaded = window.__cpipLoaded || {});
  if (loaded.content || document.documentElement.hasAttribute("data-cpip-pip")) return;
  loaded.content = true;

  /* Share with captions.js, pip.js and documentpip.js */
  const CPIP = (window.CPIP = window.CPIP || {});
  CPIP.customSel = "";

  /* Borrow the parent's hostname */
  const HOST =
    location.hostname ||
    (() => {
      try {
        const parentOrigins = location.ancestorOrigins;
        return parentOrigins && parentOrigins.length ? new URL(parentOrigins[0]).hostname : "";
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
  const childFrames = new Map();
  const shadows = new Set();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isOurs = (el) => !!el.closest?.("#cpip-button,#cpip-pick,#cpip-menu,#cpip-hint,#cpip-toast,#cpip-hl,.cpip-out");
  const area = (video) => {
    const box = video.getBoundingClientRect();
    return box.width * box.height;
  };

  /* Pick where to attach elements */
  function overlay() {
    const fullscreen = document.fullscreenElement;
    return fullscreen && fullscreen.tagName !== "VIDEO" ? fullscreen : document.documentElement;
  }

  /* Shadow DOM */
  function shadowRootsIn(root, out = []) {
    for (const host of root.querySelectorAll("*")) {
      if (!host.shadowRoot) continue;
      out.push(host.shadowRoot);
      shadowRootsIn(host.shadowRoot, out);
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
  const qsaAll = (roots, selector) => [...new Set(roots.flatMap((root) => [...root.querySelectorAll(selector)]))];

  /* Walk full page for shadow roots */
  const learnShadows = (root = document) => shadowRootsIn(root).forEach((shadowRoot) => shadows.add(shadowRoot));

  /* Learn shadow roots under pointer */
  function learnFromPath(e) {
    let found = false;
    for (const target of e.composedPath()) {
      if (target instanceof ShadowRoot && !shadows.has(target)) {
        shadows.add(target);
        learnShadows(target);
        found = true;
      }
    }
    return found;
  }

  function knownRoots() {
    for (const root of shadows) if (!root.host.isConnected) shadows.delete(root);
    return [document, ...shadows];
  }

  /* Video finder */
  function usable(video) {
    const box = video.getBoundingClientRect();
    return video.isConnected && box.width >= 160 && box.height >= 90 && video.videoWidth > 0;
  }

  function refreshVideos() {
    lastRefresh = performance.now();
    videos = qsaAll(knownRoots(), "video").filter(usable);
    if (videos.length) ensureButtons();
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
    const target = e.target;
    if (target === window || (target instanceof HTMLMediaElement && !target.classList.contains("cpip-out"))) scheduleRefresh();
  }

  function videoAt(x, y) {
    return (
      videos
        .filter((video) => {
          const box = video.getBoundingClientRect();
          return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
        })
        .sort((videoA, videoB) => area(videoB) - area(videoA))[0] || null
    );
  }

  /* Pick video under pointer or best one */
  function bestVideo() {
    return [...videos].sort((videoA, videoB) => (videoB.paused ? 0 : 1e9) + area(videoB) - ((videoA.paused ? 0 : 1e9) + area(videoA)))[0] || null;
  }
  const targetVideo = () => (hoverVideo && hoverVideo.isConnected && videos.includes(hoverVideo) ? hoverVideo : bestVideo());

  /* Create span with text */
  function span(text, className) {
    const el = document.createElement("span");
    if (className) el.className = className;
    el.textContent = text;
    return el;
  }

  /* Get picture area without black bars */
  function content(video) {
    const box = video.getBoundingClientRect();
    const fit = getComputedStyle(video).objectFit;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || fit === "fill") return { left: box.left, top: box.top, width: box.width, height: box.height };
    const scale = fit === "cover" ? Math.max(box.width / vw, box.height / vh) : Math.min(box.width / vw, box.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h };
  }

  /* Get parent across shadow DOM */
  const up = (el) => el.parentElement || (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

  /* Search captions */
  function playerRoot(video, content) {
    if (window.top !== window && content.width * content.height > innerWidth * innerHeight * 0.7) return document.body;
    /* Render YouTube captions inside the player */
    const yt = video.closest(".html5-video-player");
    if (yt) return yt;
    let root = up(video) || video.getRootNode();
    let node = up(video);
    const contentArea = content.width * content.height;
    while (node && node !== document.body && node !== document.documentElement) {
      const box = node.getBoundingClientRect();
      if (box.width * box.height > contentArea * 1.8 || box.width < content.width * 0.95 || box.height < content.height * 0.95) break;
      root = node;
      node = up(node);
    }
    return root;
  }

  /* Check element has own text */
  const hasText = (el) => [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());

  function toggle() {
    learnShadows();
    refreshVideos();
    videoFrames();
    if (!CPIP.active() && !videos.length && childFrames.size) return sendToFrame();
    if (CPIP.active()) CPIP.stop();
    else CPIP.start(targetVideo());
  }

  /* Messages */
  let toastPopup = null;
  let toastTimer = null;

  /* Stick overlays to the player */
  const pinned = new Map();
  let pinRaf = 0;

  /* Get position inside the overlay */
  function toOverlay(x, y) {
    const container = overlay();
    const base = container === document.documentElement ? { left: -scrollX, top: -scrollY } : container.getBoundingClientRect();
    return { left: x - base.left + "px", top: y - base.top + "px" };
  }

  function placeCentered(el, video) {
    const box = video.getBoundingClientRect();
    Object.assign(el.style, toOverlay(box.left + box.width / 2, box.top + box.height / 2));
  }

  function pinLoop() {
    pinRaf = 0;
    for (const [el, { video, place }] of pinned) {
      if (!el.isConnected || !video.isConnected) pinned.delete(el);
      else place(el, video);
    }
    if (pinned.size) pinRaf = requestAnimationFrame(pinLoop);
  }

  function pin(el, video, place) {
    pinned.set(el, { video, place });
    place(el, video);
    if (!pinRaf) pinRaf = requestAnimationFrame(pinLoop);
  }

  function centerOnPlayer(el) {
    const video = targetVideo();
    if (video) pin(el, video, placeCentered);
  }

  /* Toasts */
  function toast(msg, who) {
    if (!toastPopup) {
      toastPopup = document.createElement("div");
      toastPopup.id = "cpip-toast";
    }
    if (!toastPopup.isConnected) overlay().appendChild(toastPopup);
    centerOnPlayer(toastPopup);
    toastPopup.replaceChildren(...(who ? [span(who, "cpip-who"), span(msg)] : [span(msg)]));
    toastPopup.classList.add("cpip-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastPopup.classList.remove("cpip-show");
      pinned.delete(toastPopup);
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

  /* Report video state to parent frame */
  let sent = "";
  function announce() {
    if (window.top === window) return;
    const states = [...childFrames.values()];
    const has = videos.length > 0 || childFrames.size > 0;
    const on = CPIP.active() || states.some((state) => state.on);
    const playing = videos.some((video) => !video.paused) || states.some((state) => state.playing);
    const key = `${has}|${on}|${playing}`;
    if (key === sent) return;
    sent = key;
    send(parent, { [MSG]: "video", has, on, playing });
  }

  /* Find child frames with video */
  function videoFrames() {
    const live = new Set();
    for (let i = 0; i < frames.length; i++) live.add(frames[i]);
    for (const win of childFrames.keys()) if (!live.has(win)) childFrames.delete(win);
    return qsaAll(knownRoots(), "iframe").filter((frame) => childFrames.has(frame.contentWindow));
  }

  /* Find iframe under pointer */
  function frameAt(x, y) {
    let best = null;
    let bestArea = 0;
    for (const frame of videoFrames()) {
      const box = frame.getBoundingClientRect();
      const frameArea = box.width * box.height;
      if (box.width < 160 || box.height < 90 || x < box.left || x > box.right || y < box.top || y > box.bottom || frameArea < bestArea) continue;
      best = frame;
      bestArea = frameArea;
    }
    return best;
  }

  /* Pick active frame, then playing, then biggest */
  function bestChildWindow() {
    const score = (frame) => {
      const state = childFrames.get(frame.contentWindow);
      return (state.on ? 4e9 : 0) + (state.playing ? 2e9 : 0) + area(frame);
    };
    const best = videoFrames().sort((frameA, frameB) => score(frameB) - score(frameA))[0];
    return best ? best.contentWindow : [...childFrames.keys()][0] || null;
  }

  /* Pass action to player frame */
  function sendToFrame(win, what = "toggle") {
    const target = win || bestChildWindow();
    if (target) send(target, { [MSG]: what });
  }

  const isChild = (win) => {
    try {
      return win.parent === window;
    } catch (e) {
      return false;
    }
  };

  window.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || typeof data !== "object" || !(MSG in data) || !e.source || e.source === window) return;
    const fromParent = e.source === parent;
    if (data[MSG] === "video" && isChild(e.source)) {
      if (data.has) childFrames.set(e.source, { on: !!data.on, playing: !!data.playing });
      else childFrames.delete(e.source);
      updateButton();
    } else if (data[MSG] === "toggle" && fromParent) {
      toggle();
    } else if (data[MSG] === "pick" && fromParent) {
      startPick();
    } else if (data[MSG] === "ping" && fromParent) {
      sent = "";
      announce();
    }
  });

  /* Shortcuts */
  const ACTIONS = { KeyP: toggle, KeyS: startPick };
  const KEYS_PIP = ["Alt", "Shift", "P"];
  const KEYS_PICK = ["Alt", "Shift", "S"];
  const keysLabel = (keys) => keys.join("+");

  /* Recreate YouTube default tooltip */
  function setTip(btn, label, keys) {
    let tip = btn.querySelector(".cpip-tip");
    if (!tip) btn.appendChild((tip = span("", "cpip-tip")));
    const keysCombo = span("", "cpip-keys");
    keys.forEach((key, i) => {
      if (i) {
        const plus = span("", "cpip-plus");
        plus.innerHTML = CPIP.ICONS.PLUS;
        keysCombo.appendChild(plus);
      }
      keysCombo.appendChild(span(key, "cpip-key"));
    });
    tip.replaceChildren(span(label), keysCombo);
  }

  let pipBtn = null;
  let pickBtn = null;
  let btnLabel = "";

  /* Send click to iframe or handle here */
  function makeButton(id, icon, onClick) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.innerHTML = icon;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e, hoverFrame && hoverFrame.isConnected && !hoverVideo ? hoverFrame.contentWindow : null);
    });
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu();
    });
    return btn;
  }

  /* Right click menu on the buttons */
  let menu = null;
  let btnsHidden = false;

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    window.removeEventListener("mousedown", onMenuOutside, true);
    window.removeEventListener("keydown", closeMenu, true);
    window.removeEventListener("blur", closeMenu);
    window.removeEventListener("scroll", closeMenu, true);
  }

  function onMenuOutside(e) {
    if (menu && !e.composedPath().includes(menu)) closeMenu();
  }

  function showMenu() {
    closeMenu();
    menu = document.createElement("div");
    menu.id = "cpip-menu";
    const addItem = (label, onPick) => {
      const item = span(label, "cpip-item");
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        onPick && onPick();
      });
      menu.appendChild(item);
    };
    addItem("Hide buttons", () => {
      btnsHidden = true;
      hoverVideo = hoverFrame = null;
      hideButtons();
    });
    menu.appendChild(span("", "cpip-sep"));
    addItem("Close");
    menu.addEventListener("contextmenu", (e) => e.preventDefault());
    overlay().appendChild(menu);
    const menuBox = menu.getBoundingClientRect();
    const pipBox = pipBtn.getBoundingClientRect();
    menu.style.left = clamp(pipBox.right - menuBox.width, 0, innerWidth - menuBox.width) + "px";
    menu.style.top = clamp(pipBox.bottom + 6, 0, innerHeight - menuBox.height) + "px";
    window.addEventListener("mousedown", onMenuOutside, true);
    window.addEventListener("keydown", closeMenu, true);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
  }

  function ensureButtons() {
    if (!pipBtn) {
      pipBtn = makeButton("cpip-button", CPIP.ICONS.PIP, (_, win) => (win ? sendToFrame(win) : toggle()));
      updateButton();
    }
    if (!pickBtn) {
      pickBtn = makeButton("cpip-pick", CPIP.ICONS.PICK, (_, win) => (win ? sendToFrame(win, "pick") : startPick()));
      pickBtn.setAttribute("aria-label", `Pick caption (${keysLabel(KEYS_PICK)})`);
      setTip(pickBtn, "Pick caption", KEYS_PICK);
    }
    const container = overlay();
    if (pipBtn.parentNode !== container) container.appendChild(pipBtn);
    if (pickBtn.parentNode !== container) container.appendChild(pickBtn);
  }

  function updateButton() {
    announce();
    if (!pipBtn) return;
    const on = hoverFrame && hoverFrame.isConnected ? !!(childFrames.get(hoverFrame.contentWindow) || {}).on : CPIP.active();
    const label = on ? "Exit caption pip" : "Caption pip";
    pipBtn.classList.toggle("cpip-on", on);
    /* Update tooltip on label change */
    if (label === btnLabel) return;
    btnLabel = label;
    pipBtn.setAttribute("aria-label", `${label} (${keysLabel(KEYS_PIP)})`);
    setTip(pipBtn, label, KEYS_PIP);
  }

  function placeButtons(_, video) {
    const box = video.getBoundingClientRect();
    const top = box.top + 10;
    const right = box.right - 10;
    Object.assign(pipBtn.style, toOverlay(right - 49, top));
    Object.assign(pickBtn.style, toOverlay(right - 49 - 43, top));
  }

  const hideButtons = () => {
    pinned.delete(pipBtn);
    [pipBtn, pickBtn].forEach((btn) => btn && btn.classList.remove("cpip-show"));
  };

  /* Dimensions */
  const HOTZONE_W = 240;
  const HOTZONE_H = 140;

  /* Check hot zone, top right of video */
  function inHotzone(el, x, y) {
    const box = el.getBoundingClientRect();
    return x >= box.right - HOTZONE_W && x <= box.right && y >= box.top && y <= box.top + HOTZONE_H;
  }

  /* Keep buttons while the menu is open */
  let lastMove = 0;
  window.addEventListener(
    "mousemove",
    (e) => {
      const now = performance.now();
      if (now - lastMove < 80 || picking || menu) return;
      lastMove = now;
      if (learnFromPath(e) || now - lastRefresh > 1000) refreshVideos();
      if (!videos.length && !childFrames.size) return;
      const video = videoAt(e.clientX, e.clientY);
      const frame = video ? null : frameAt(e.clientX, e.clientY);
      hoverVideo = video;
      hoverFrame = frame;
      if (!video && !frame) return (btnsHidden = false), hideButtons();
      if (!inHotzone(video || frame, e.clientX, e.clientY)) return (btnsHidden = false), hideButtons();
      if (btnsHidden) return;
      ensureButtons();
      updateButton();
      pin(pipBtn, video || frame, placeButtons);
      [pipBtn, pickBtn].forEach((btn) => btn.classList.add("cpip-show"));
    },
    { capture: true, passive: true }
  );

  /* Hide buttons on page leave */
  document.documentElement.addEventListener("mouseleave", () => {
    if (picking || menu) return;
    hoverVideo = hoverFrame = null;
    btnsHidden = false;
    hideButtons();
  });

  /* Caption picker */
  let highlight = null;
  let hint = null;

  function cssPath(el) {
    const scope = el.getRootNode();
    const parts = [];
    let node = el;
    for (let i = 0; node && node.nodeType === 1 && i < 4; i++, node = node.parentElement) {
      if (node.id && !/\d{4,}/.test(node.id)) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let p = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((className) => /^[a-z][\w-]{1,32}$/i.test(className) && !/\d{3,}/.test(className)).slice(0, 2);
      if (classes.length) p += "." + classes.map((className) => CSS.escape(className)).join(".");
      parts.unshift(p);
      if (classes.length) {
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
    const video = videoAt(x, y);
    if (!video) return null;
    const root = playerRoot(video, content(video));
    let best = null;
    let smallest = Infinity;
    for (const el of qsaAll(rootsIn(root, 1000), "*")) {
      if (el === video || !hasText(el) || isOurs(el)) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      if (box.width * box.height >= smallest) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      best = el;
      smallest = box.width * box.height;
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
      if (!el) return (highlight.style.display = "none");
      const box = el.getBoundingClientRect();
      highlight.style.cssText = `display:block;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    });
  }

  function onKeydown(e) {
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
    const target = e.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  }

  function onPickClick(e) {
    swallow(e);
    const el = textAt(e.clientX, e.clientY);
    if (!el) return;
    saveSel(cssPath(el));
    stopPick();
    toast("Caption source saved for " + SITE);
  }

  const pickHandler = (type) => (type === "click" ? onPickClick : swallow);

  function startPick() {
    if (picking) return;
    learnShadows();
    refreshVideos();
    videoFrames();
    if (!videos.length && childFrames.size) return sendToFrame(null, "pick");
    if (!videos.length) return toast("No video found here", "Pick caption");
    picking = true;
    hideButtons();
    highlight = document.createElement("div");
    highlight.id = "cpip-hl";
    hint = document.createElement("div");
    hint.id = "cpip-hint";
    hint.append(span("Click the caption text while it is on screen"), span("Esc", "cpip-key"), span("Cancel"), span("Del", "cpip-key"), span("Reset"));
    overlay().append(highlight, hint);
    centerOnPlayer(hint);
    window.addEventListener("mousemove", onPickMove, true);
    PICK_EVENTS.forEach((type) => window.addEventListener(type, pickHandler(type), true));
  }

  function stopPick() {
    picking = false;
    cancelAnimationFrame(pickRaf);
    pickRaf = 0;
    highlight && highlight.remove();
    hint && hint.remove();
    window.removeEventListener("mousemove", onPickMove, true);
    PICK_EVENTS.forEach((type) => window.removeEventListener(type, pickHandler(type), true));
  }

  /* Save selector per site */
  const store = globalThis.chrome && chrome.storage && chrome.storage.local;

  function saveSel(selector) {
    CPIP.customSel = selector;
    try {
      STORE && store && store.set({ [STORE]: selector });
    } catch (e) {}
  }

  try {
    if (STORE && store) {
      store.get(STORE, (data) => (CPIP.customSel = (data && data[STORE]) || ""));
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes[STORE]) CPIP.customSel = changes[STORE].newValue || "";
      });
    }
  } catch (e) {}

  /* Share with captions.js, pip.js and documentpip.js */
  Object.assign(CPIP, { clamp, isOurs, hasText, content, playerRoot, toast, updateButton, rootsIn, qsaAll, knownRoots });

  /* Lifecycle */
  MEDIA_EVENTS.forEach((type) => window.addEventListener(type, onMedia, true));
  window.addEventListener("keydown", onKeydown, true);
  document.addEventListener("fullscreenchange", () => {
    scheduleRefresh();
    if (pipBtn) ensureButtons();
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
  (window.requestIdleCallback || ((callback) => setTimeout(callback, 300)))(() => {
    const count = shadows.size;
    learnShadows();
    if (shadows.size !== count) refreshVideos();
  });
})();
