(() => {
  /* Document PiP for DRM videos, see pagehook.js */
  const loaded = (window.__cpipLoaded = window.__cpipLoaded || {});
  if (loaded.documentpip || document.documentElement.hasAttribute("data-cpip-pip")) return;
  loaded.documentpip = true;
  const CPIP = (window.CPIP = window.CPIP || {});

  const SCAN_MS = 100;
  const SCAN_PAUSED_MS = 500;
  const HIDE_MS = 3000;
  const SCALE_KEY = "capScale";

  /* Load styles once */
  let cssText = null;
  async function loadCss() {
    if (cssText === null) {
      try {
        cssText = await (await fetch(chrome.runtime.getURL("content.css"))).text();
      } catch (e) {
        cssText = "";
      }
    }
    return cssText;
  }

  /* Copy page fonts */
  function copyFonts(doc) {
    const fix = (css, base) =>
      css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => {
        try {
          return `url("${new URL(url, base).href}")`;
        } catch (e) {
          return match;
        }
      });
    let css = "";
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        /* Link cross-origin sheet */
        if (sheet.href) {
          const link = doc.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          doc.head.appendChild(link);
        }
        continue;
      }
      for (const rule of rules) if (rule instanceof CSSFontFaceRule) css += fix(rule.cssText, sheet.href || location.href);
    }
    if (css) {
      const style = doc.createElement("style");
      style.textContent = css;
      doc.head.appendChild(style);
    }
    try {
      for (const font of document.fonts) {
        try {
          doc.fonts.add(font);
        } catch (e) {}
      }
    } catch (e) {}
  }

  const formatTime = (totalSec) => {
    if (!Number.isFinite(totalSec) || totalSec < 0) return "0:00";
    const hr = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const sec = Math.floor(totalSec % 60);
    return hr ? hr + ":" + String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0") : min + ":" + String(sec).padStart(2, "0");
  };

  /* Captions */
  function renderCaptions(s, blocks) {
    const doc = s.pipWin.document;
    s.overlay.textContent = "";
    for (const block of blocks) {
      const el = doc.createElement("div");
      el.textContent = block.text;
      if (block.bg) {
        el.className = "cpip-bg";
        el.style.backgroundColor = block.bg;
      }
      if (block.color) el.style.color = block.color;
      if (block.font) el.style.fontFamily = block.font;
      if (block.weight) el.style.fontWeight = block.weight;
      if (block.size) el.style.fontSize = `calc(max(14px, ${(block.size * 100).toFixed(2)}vh) * var(--cpip-scale, 1))`;
      if (block.shadow && block.shadow !== "none") el.style.textShadow = block.shadow;
      s.overlay.appendChild(el);
    }
  }

  function syncCaptions(s) {
    if (!CPIP.current(s)) return;
    const blocks = CPIP.scanDoc(s);
    const sig = blocks.map((block) => `${block.text}@${(block.size || 0).toFixed(3)}`).join("|");
    if (sig === s.sig) return;
    s.sig = sig;
    renderCaptions(s, blocks);
  }

  /* Put the video back in the page */
  function close(s) {
    if (s.originalParent && s.originalParent.isConnected) {
      if (s.originalStyle) s.video.setAttribute("style", s.originalStyle);
      else s.video.removeAttribute("style");
      if (s.originalNext && s.originalNext.isConnected) s.originalParent.insertBefore(s.video, s.originalNext);
      else s.originalParent.appendChild(s.video);
    }
    if (s.placeholder) s.placeholder.remove();
    try {
      s.pipWin.close();
    } catch (e) {}
  }

  async function start(video) {
    const content = CPIP.content(video);
    const s = {
      mode: "docpip",
      video,
      undo: [],
      sig: "",
      playerRoot: CPIP.playerRoot(video, content),
      originalParent: video.parentElement,
      originalNext: video.nextSibling,
      originalStyle: video.getAttribute("style") || "",
    };
    s.close = () => close(s);
    CPIP.begin(s);
    const bind = (target, type, fn) => CPIP.bind(s, target, type, fn);

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const pipW = CPIP.clamp(Math.round(screen.width * 0.33), 480, 800);
    const pipH = Math.round((pipW * vh) / vw);

    try {
      const css = await loadCss();
      s.pipWin = await window.documentPictureInPicture.requestWindow({ width: pipW, height: pipH });
      if (!CPIP.current(s)) {
        s.pipWin.close();
        return;
      }
      s.css = css;
    } catch (e) {
      if (!CPIP.current(s)) return;
      CPIP.stop(s);
      return CPIP.startNative(video);
    }

    const doc = s.pipWin.document;
    /* Keep content scripts out of this window */
    doc.documentElement.setAttribute("data-cpip-pip", "");
    copyFonts(doc);
    const style = doc.createElement("style");
    style.textContent = s.css;
    doc.head.appendChild(style);

    const wrap = doc.createElement("div");
    wrap.id = "cpip-wrap";
    doc.body.appendChild(wrap);

    s.placeholder = document.createElement("div");
    const box = video.getBoundingClientRect();
    s.placeholder.style.cssText = `width:${box.width}px;height:${box.height}px;background:#000`;
    video.parentElement.insertBefore(s.placeholder, video);
    video.removeAttribute("style");
    wrap.appendChild(video);

    const create = (tag, id, className) => {
      const el = doc.createElement(tag);
      if (id) el.id = id;
      if (className) el.className = className;
      return el;
    };
    const makeButton = (className, icon, title, id) => {
      const btn = create("button", id, "cpip-btn " + className);
      btn.innerHTML = icon;
      btn.title = title;
      return btn;
    };

    /* Center row */
    const ctrl = (s.ctrl = create("div", "cpip-controls"));
    const center = create("div", "cpip-center");
    const backBtn = makeButton("cpip-skip", CPIP.ICONS.BACK10, "Rewind 10 seconds");
    const playBtn = makeButton("", CPIP.ICONS.PLAY, "Play", "cpip-play");
    const fwdBtn = makeButton("cpip-skip", CPIP.ICONS.FWD10, "Forward 10 seconds");
    center.append(backBtn, playBtn, fwdBtn);

    /* Slider */
    const slider = (onPick, gap = 5) => {
      const root = create("div", "", "cpip-slider");
      const inner = create("div", "", "cpip-track");
      const fill = create("div", "", "cpip-fill");
      const rest = create("div", "", "cpip-rest");
      const handle = create("div", "", "cpip-handle");
      inner.append(fill, rest, handle);
      root.append(inner);
      const set = (frac) => {
        const perc = CPIP.clamp(frac, 0, 1) * 100;
        fill.style.width = gap ? `max(0px, calc(${perc}% - ${gap}px))` : `${perc}%`;
        rest.style.left = gap ? `min(100%, calc(${perc}% + ${gap}px))` : `${perc}%`;
        handle.style.left = perc + "%";
      };
      const at = (e) => {
        const box = inner.getBoundingClientRect();
        return CPIP.clamp((e.clientX - box.left) / box.width, 0, 1);
      };
      const end = () => {
        s.seeking = false;
        root.classList.remove("cpip-drag");
      };
      bind(root, "pointerdown", (e) => {
        root.setPointerCapture(e.pointerId);
        s.seeking = true;
        root.classList.add("cpip-drag");
        onPick(at(e));
      });
      bind(root, "pointermove", (e) => s.seeking && root.hasPointerCapture(e.pointerId) && onPick(at(e)));
      bind(root, "pointerup", end);
      bind(root, "lostpointercapture", end);
      return { root, set };
    };

    /* Bottom bar */
    const bottom = create("div", "cpip-bottom");
    const prevBtn = makeButton("", CPIP.ICONS.PREV, "Previous track", "cpip-prev");
    const nextBtn = makeButton("", CPIP.ICONS.NEXT, "Next track", "cpip-next");
    const progress = slider((frac) => {
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) video.currentTime = frac * dur;
      syncTime();
    });
    progress.root.id = "cpip-progress";
    const time = create("span", "", "cpip-time");
    const muteBtn = makeButton("", CPIP.ICONS.VOL, "Mute", "cpip-mute");
    const ccBtn = makeButton("", CPIP.ICONS.CC, "Caption size", "cpip-cc");
    const fitBtn = makeButton("", CPIP.ICONS.FIT, "Fit to video", "cpip-fit");
    bottom.append(prevBtn, progress.root, nextBtn, time, fitBtn, muteBtn, ccBtn);
    ctrl.append(center, bottom);
    wrap.appendChild(ctrl);

    /* Captions sit above the controls */
    s.overlay = create("div", "cpip-cap");
    wrap.appendChild(s.overlay);

    /* Caption size panel */
    const panel = create("div", "cpip-panel");
    const size = slider((frac) => setScale(0.5 + frac * 2, true), 0);
    const pct = create("span", "", "cpip-pct");
    panel.append(size.root, pct);
    wrap.appendChild(panel);
    const closePanel = () => {
      panel.classList.remove("cpip-open");
      ccBtn.classList.remove("cpip-on");
    };

    /* Caption scale, remembered across sessions */
    const setScale = (value, save) => {
      s.scale = Math.round(CPIP.clamp(value, 0.5, 2.5) * 20) / 20;
      s.overlay.style.setProperty("--cpip-scale", s.scale);
      pct.textContent = Math.round(s.scale * 100) + "%";
      size.set((s.scale - 0.5) / 2);
      if (!save) return;
      try {
        chrome.storage.local.set({ [SCALE_KEY]: s.scale });
      } catch (e) {}
    };
    const changeScale = (delta) => setScale(s.scale + delta, true);
    setScale(1);
    try {
      chrome.storage.local.get(SCALE_KEY, (o) => CPIP.current(s) && o && o[SCALE_KEY] && setScale(o[SCALE_KEY]));
    } catch (e) {}

    /* Next and previous from page media session */
    const msHas = (action) => (document.documentElement.getAttribute("data-cpip-ms") || "").split(" ").includes(action);
    const msRun = (action) => window.dispatchEvent(new CustomEvent("cpip-ms", { detail: action }));

    /* Actions */
    const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    const skip = (seconds) => (video.currentTime = CPIP.clamp(video.currentTime + seconds, 0, video.duration || Infinity));
    bind(playBtn, "click", togglePlay);
    bind(backBtn, "click", () => skip(-10));
    bind(fwdBtn, "click", () => skip(10));
    /* Fit window to video */
    const ratio = () => video.videoWidth / video.videoHeight || 0;
    const fitWindow = () => {
      const win = s.pipWin;
      const videoRatio = ratio();
      if (!videoRatio) return;
      const frameW = win.outerWidth - win.innerWidth;
      const frameH = win.outerHeight - win.innerHeight;
      let w = win.innerWidth;
      let h = Math.round(w / videoRatio);
      /* Keep window on screen */
      if (h + frameH > screen.availHeight) {
        h = win.innerHeight;
        w = Math.round(h * videoRatio);
      }
      try {
        win.resizeTo(w + frameW, h + frameH);
      } catch (e) {}
    };
    const syncFit = () => {
      const videoRatio = ratio();
      const wrongAspect = videoRatio && Math.abs(s.pipWin.innerWidth / s.pipWin.innerHeight - videoRatio) / videoRatio > 0.02;
      fitBtn.style.display = wrongAspect ? "" : "none";
    };
    bind(fitBtn, "click", fitWindow);
    bind(s.pipWin, "resize", syncFit);
    bind(video, "loadedmetadata", syncFit);
    bind(prevBtn, "click", () => msRun("previoustrack"));
    bind(nextBtn, "click", () => msRun("nexttrack"));
    bind(muteBtn, "click", () => {
      if (video.muted && video.volume === 0) video.volume = 1;
      video.muted = !video.muted;
    });
    bind(ccBtn, "click", () => {
      const open = panel.classList.toggle("cpip-open");
      ccBtn.classList.toggle("cpip-on", open);
      showCtrl();
    });
    /* Close panel on outside click */
    bind(wrap, "pointerdown", (e) => {
      if (!panel.classList.contains("cpip-open") || e.target.closest("#cpip-panel") || ccBtn.contains(e.target)) return;
      closePanel();
      s.skipToggle = true;
    });
    bind(ctrl, "click", (e) => {
      if (s.skipToggle) return (s.skipToggle = false);
      if (!e.target.closest(".cpip-btn,#cpip-bottom")) togglePlay();
    });

    /* Keep buttons in sync with the video */
    const syncPlay = () => {
      /* Replay icon when ended */
      const ended = video.ended;
      playBtn.innerHTML = ended ? CPIP.ICONS.RESTART : video.paused ? CPIP.ICONS.PLAY : CPIP.ICONS.PAUSE;
      playBtn.title = ended ? "Replay" : video.paused ? "Play" : "Pause";
      playBtn.classList.toggle("cpip-paused", video.paused && !ended);
      wrap.classList.toggle("cpip-is-paused", video.paused);
    };
    const syncVol = () => {
      const isMuted = video.muted || video.volume === 0;
      muteBtn.innerHTML = isMuted ? CPIP.ICONS.MUTED : CPIP.ICONS.VOL;
      muteBtn.title = isMuted ? "Unmute" : "Mute";
    };
    const syncTime = () => {
      const cur = video.currentTime || 0;
      const dur = video.duration || 0;
      time.textContent = formatTime(cur) + " / " + formatTime(dur);
      progress.set(dur > 0 ? cur / dur : 0);
      /* Show both buttons when either exists */
      const hasPrev = msHas("previoustrack");
      const hasNext = msHas("nexttrack");
      const tracks = hasPrev || hasNext;
      bottom.classList.toggle("cpip-tracks", tracks);
      prevBtn.style.display = nextBtn.style.display = tracks ? "" : "none";
      prevBtn.disabled = !hasPrev;
      nextBtn.disabled = !hasNext;
    };
    bind(video, "play", syncPlay);
    bind(video, "pause", syncPlay);
    bind(video, "ended", syncPlay);
    bind(video, "volumechange", syncVol);
    bind(video, "timeupdate", syncTime);
    bind(video, "seeked", syncTime);
    bind(video, "durationchange", syncTime);
    const timeTimer = setInterval(syncTime, 250);
    s.undo.push(() => clearInterval(timeTimer));
    syncPlay();
    syncVol();
    syncTime();
    syncFit();

    /* Auto hide controls */
    const hide = () => {
      if (video.paused || s.seeking || panel.classList.contains("cpip-open")) return;
      ctrl.classList.remove("cpip-show");
      wrap.classList.add("cpip-idle");
    };
    let controlTimer = 0;
    s.undo.push(() => clearTimeout(controlTimer));
    const showCtrl = () => {
      ctrl.classList.add("cpip-show");
      wrap.classList.remove("cpip-idle");
      clearTimeout(controlTimer);
      controlTimer = setTimeout(hide, HIDE_MS);
    };
    bind(wrap, "pointermove", showCtrl);
    bind(wrap, "pointerdown", showCtrl);
    bind(wrap, "mouseleave", () => {
      clearTimeout(controlTimer);
      hide();
    });
    bind(video, "pause", showCtrl);
    bind(video, "play", showCtrl);
    showCtrl();

    /* Keyboard shortcuts inside the PiP window */
    bind(s.pipWin, "keydown", (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyP") {
        e.preventDefault();
        CPIP.stop(s);
      } else if (e.code === "Space" || e.code === "KeyK") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        skip(-10);
        showCtrl();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        skip(10);
        showCtrl();
      } else if (e.key === "+" || e.key === "=") {
        changeScale(0.1);
      } else if (e.key === "-" || e.key === "_") {
        changeScale(-0.1);
      }
    });

    /* Scan captions */
    let scanTimer = 0;
    const scanLoop = () => {
      syncCaptions(s);
      scanTimer = setTimeout(scanLoop, video.paused ? SCAN_PAUSED_MS : SCAN_MS);
    };
    s.undo.push(() => clearTimeout(scanTimer));
    scanLoop();
    /* Wait for site cuechange */
    const syncSoon = () => setTimeout(() => syncCaptions(s), 0);
    bind(video, "seeked", syncSoon);
    bind(video, "play", syncSoon);
    const watchTrack = (track) => track && bind(track, "cuechange", syncSoon);
    for (const track of video.textTracks) watchTrack(track);
    bind(video.textTracks, "addtrack", (e) => watchTrack(e.track));
    s.pipWin.addEventListener("pagehide", () => CPIP.stop(s));
    CPIP.bindMediaSession(s, video);
    CPIP.updateButton();
  }

  /* Share with pip.js */
  CPIP.startDocPip = start;
})();
