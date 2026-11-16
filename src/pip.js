(() => {
  const loaded = (window.__cpipLoaded = window.__cpipLoaded || {});
  if (loaded.pip || document.documentElement.hasAttribute("data-cpip-pip")) return;
  loaded.pip = true;
  const CPIP = (window.CPIP = window.CPIP || {});

  const FPS = 60;
  const MAX_W = 1920;
  const MIN_W = 640;
  const STEP_W = 128;
  const SCAN_MS = 100;
  const SCAN_PAUSED_MS = 500;
  const KEEPALIVE_MS = 500;
  const STALL_MS = 500;
  const FONT_BOOST = 1.2;
  const MIN_FONT_PX = 15;

  let session = null;

  /* Drawing */
  function wrap(ctx, text, maxW) {
    const lines = [];
    for (const para of text.split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const test = line ? line + " " + word : word;
        if (line && ctx.measureText(test).width > maxW) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function drawBlock(ctx, cv, b, c, sx, sy, minFs) {
    const fs = Math.max(b.fs * sx * FONT_BOOST, minFs);
    ctx.font = `${b.weight} ${fs}px ${b.font}`;
    ctx.textAlign = b.leftAlign ? "left" : "center";
    ctx.textBaseline = "alphabetic";
    const maxW = CPIP.clamp(b.width * sx, cv.width * 0.25, cv.width * 0.94);
    const lines = wrap(ctx, b.text, maxW);
    const lh = fs * 1.25;
    const cx = CPIP.clamp((b.left + b.width / 2 - c.left) * sx, maxW / 2, cv.width - maxW / 2);
    const lx = CPIP.clamp((b.left - c.left) * sx, fs * 0.2, Math.max(fs * 0.2, cv.width - maxW));
    const x = b.leftAlign ? lx : cx;
    const last = CPIP.clamp((b.bottom - c.top) * sy - fs * 0.28, lines.length * lh, cv.height - fs * 0.3);
    ctx.lineJoin = "round";
    lines.forEach((line, i) => {
      const y = last - (lines.length - 1 - i) * lh;
      if (b.bg) {
        const w = ctx.measureText(line).width;
        ctx.fillStyle = b.bg;
        ctx.fillRect((b.leftAlign ? x : cx - w / 2) - fs * 0.2, y - fs * 0.95, w + fs * 0.4, fs * 1.2);
      } else {
        ctx.lineWidth = fs * 0.14;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = b.color;
      ctx.fillText(line, x, y);
    });
  }

  function paint(s) {
    const { video, canvas: cv, ctx } = s;
    const c = CPIP.content(video);
    if (!c.width || !c.height) return;
    s.dirty = false;
    s.paintAt = performance.now();
    const sx = cv.width / c.width;
    const sy = cv.height / c.height;
    try {
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, cv.width, cv.height);
    } catch (e) {}
    for (const l of s.caps.layers) {
      const r = l.getBoundingClientRect();
      try {
        ctx.drawImage(l, (r.left - c.left) * sx, (r.top - c.top) * sy, r.width * sx, r.height * sy);
      } catch (e) {}
    }
    /* Scale font to PiP window width */
    const minFs = MIN_FONT_PX * (cv.width / (s.win ? s.win.width : cv.width));
    for (const b of s.caps.blocks) drawBlock(ctx, cv, b, c, sx, sy, minFs);
  }

  /* Resize canvas to video and PiP window */
  function sizeCanvas(s) {
    const vw = s.video.videoWidth || 1280;
    const vh = s.video.videoHeight || 720;
    const px = s.win ? s.win.width * (window.devicePixelRatio || 1) : vw;
    const target = CPIP.clamp(px, MIN_W, MAX_W);
    /* Avoid shaking */
    const cur = s.canvas.width;
    const sameAspect = s.sized && Math.abs(cur / s.canvas.height - vw / vh) < 0.01;
    if (sameAspect && cur >= target && cur - target < STEP_W * 2) return;
    const w = Math.min(MAX_W, Math.ceil(target / STEP_W) * STEP_W);
    const h = Math.round((w * vh) / vw / 2) * 2;
    if (s.canvas.width === w && s.canvas.height === h) return;
    s.sized = true;
    s.canvas.width = w;
    s.canvas.height = h;
    paint(s);
  }

  /* Get caption fingerprint */
  const sigOf = (caps) =>
    caps.layers.length + "|" + caps.blocks.map((b) => `${b.text}@${Math.round(b.left)},${Math.round(b.bottom)},${Math.round(b.width)}`).join("|");

  /* Count decoded frames */
  function frameCount(v) {
    try {
      return v.getVideoPlaybackQuality().totalVideoFrames;
    } catch (e) {
      return v.currentTime;
    }
  }

  function tick(s) {
    if (session !== s) return;
    const t = performance.now();
    if (!s.video.isConnected) return stop(s);
    const playing = !s.video.paused;
    if (t - s.scanAt >= (playing ? SCAN_MS : SCAN_PAUSED_MS)) {
      s.scanAt = t;
      try {
        s.caps = CPIP.scan(s);
        const sig = sigOf(s.caps);
        if (sig !== s.sig) {
          s.sig = sig;
          s.dirty = true;
        }
      } catch (e) {
        console.warn("[Caption pip] scan failed", e);
      }
      const k = s.video.videoWidth / s.video.videoHeight;
      if (k && Math.abs(s.canvas.width / s.canvas.height - k) > 0.01) sizeCanvas(s);
    }
    /* Paint at video frame rate */
    const fc = frameCount(s.video);
    if (fc !== s.fc) {
      s.fc = fc;
      s.fcAt = t;
      s.dirty = true;
    } else if (playing && t - s.fcAt > STALL_MS) {
      /* Paint every tick if counter stalls */
      s.dirty = true;
    }
    /* Paint canvas subtitles every tick */
    if (playing && s.caps.layers.length) s.dirty = true;
    if (s.dirty || t - s.paintAt >= KEEPALIVE_MS) paint(s);
  }

  /* Session */
  function bind(s, target, type, fn) {
    target.addEventListener(type, fn);
    s.undo.push(() => target.removeEventListener(type, fn));
  }

  /* Anti low freq ticker */
  function startTicker(s) {
    const onTick = () => tick(s);
    const ms = Math.round(1000 / FPS);
    try {
      const url = URL.createObjectURL(new Blob(["setInterval(()=>postMessage(0)," + ms + ")"]));
      s.worker = new Worker(url);
      URL.revokeObjectURL(url);
      s.worker.onmessage = onTick;
      s.worker.onerror = () => {
        s.worker.terminate();
        s.worker = null;
        if (session === s && !s.timer) s.timer = setInterval(onTick, ms);
      };
    } catch (e) {
      s.timer = setInterval(onTick, ms);
    }
  }

  /* Bind media keys to video */
  function bindMediaSession(s, video) {
    const media = navigator.mediaSession;
    if (!media) return;
    const acts = {
      play: () => video.play(),
      pause: () => video.pause(),
      seekbackward: () => (video.currentTime = Math.max(0, video.currentTime - 10)),
      seekforward: () => (video.currentTime = video.currentTime + 10),
      seekto: (d) => {
        if (d.seekTime == null) return;
        if (d.fastSeek && typeof video.fastSeek === "function") video.fastSeek(d.seekTime);
        else video.currentTime = d.seekTime;
      },
    };
    for (const [name, fn] of Object.entries(acts)) {
      try {
        media.setActionHandler(name, fn);
        s.undo.push(() => {
          try {
            media.setActionHandler(name, null);
          } catch (e) {}
        });
      } catch (e) {}
    }
    /* Restore site handlers */
    s.undo.push(() => window.dispatchEvent(new CustomEvent("cpip-ms", { detail: "restore" })));

    /* Report original video position to show a timeline */
    if (typeof media.setPositionState !== "function") return;
    const sync = () => {
      try {
        media.playbackState = video.paused ? "paused" : "playing";
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) return media.setPositionState();
        media.setPositionState({
          duration,
          position: CPIP.clamp(video.currentTime || 0, 0, duration),
          playbackRate: video.playbackRate || 1,
        });
      } catch (e) {}
    };
    for (const type of ["durationchange", "ratechange", "seeked", "play", "pause", "timeupdate"]) bind(s, video, type, sync);
    s.undo.push(() => {
      try {
        media.setPositionState();
        media.playbackState = "none";
      } catch (e) {}
    });
    sync();
  }

  const exitIf = (el) => document.pictureInPictureElement === el && document.exitPictureInPicture().catch(() => {});

  /* Open plain PiP without captions */
  async function startNative(video) {
    const s = { mode: "native", video, undo: [] };
    session = s;
    try {
      /* Avoid players block PiP */
      video.disablePictureInPicture = false;
      video.removeAttribute("disablepictureinpicture");
      await video.requestPictureInPicture();
    } catch (e) {
      if (session !== s) return;
      stop(s);
      return CPIP.toast("Could not open", "Caption pip");
    }
    /* Exit if stopped while opening */
    if (session !== s) return exitIf(video);
    bind(s, video, "leavepictureinpicture", () => stop(s));
    CPIP.updateButton();
  }

  /* Protected video, use Document PiP */
  function startProtected(video) {
    if (!window.documentPictureInPicture) return startNative(video);
    if (CPIP.hasCaptions(video)) return CPIP.startDocPip(video);
    CPIP.toast("No captions found", "Caption pip");
    return startNative(video);
  }

  async function start(video) {
    if (!video) return CPIP.toast("No video found here", "Caption pip");
    if (video.mediaKeys) return startProtected(video);
    if (!document.pictureInPictureEnabled) return CPIP.toast("Not available in this browser", "Caption pip");
    const s = {
      video,
      canvas: document.createElement("canvas"),
      out: document.createElement("video"),
      caps: { blocks: [], layers: [] },
      undo: [],
      win: null,
      scanAt: 0,
      paintAt: 0,
      fc: -1,
      fcAt: 0,
      sig: "",
      dirty: true,
      nudge: false,
    };
    session = s;
    try {
      s.ctx = s.canvas.getContext("2d", { alpha: false });
      sizeCanvas(s);
      s.caps = CPIP.scan(s);
      paint(s);
      try {
        s.ctx.getImageData(0, 0, 1, 1);
      } catch (e) {
        stop(s);
        return startProtected(video);
      }
      s.out.className = "cpip-out";
      s.out.muted = true;
      s.out.playsInline = true;
      s.out.srcObject = s.canvas.captureStream(FPS);
      document.documentElement.appendChild(s.out);
      await s.out.play();
      if (session !== s) return;
      s.win = await s.out.requestPictureInPicture();
      /* Close PiP if stopped while opening */
      if (session !== s) return exitIf(s.out);
    } catch (e) {
      /* Ignore stop while opening */
      if (session !== s) return;
      stop(s);
      return startNative(video);
    }

    startTicker(s);
    sizeCanvas(s);
    bind(s, s.win, "resize", () => {
      clearTimeout(s.resizeTimer);
      s.resizeTimer = setTimeout(() => sizeCanvas(s), 150);
    });
    bind(s, s.out, "leavepictureinpicture", () => stop(s));
    bind(s, video, "loadedmetadata", () => sizeCanvas(s));

    /* Keep PiP controls and player in sync */
    bind(s, s.out, "play", () => !s.nudge && video.paused && video.play().catch(() => {}));
    bind(s, s.out, "pause", () => !s.nudge && !video.paused && video.pause());
    bind(s, video, "play", () => s.out.paused && s.out.play().catch(() => {}));
    bind(s, video, "pause", () => !s.out.paused && s.out.pause());
    bind(s, video, "seeked", () => {
      s.dirty = true;
      if (!video.paused) return;
      s.nudge = true;
      s.out.play().catch(() => {});
      setTimeout(() => {
        s.out.pause();
        setTimeout(() => (s.nudge = false), 100);
      }, 300);
    });
    if (video.paused) s.out.pause();

    bindMediaSession(s, video);
    CPIP.updateButton();
  }

  function stop(s = session) {
    if (!s || session !== s) return;
    session = null;
    clearInterval(s.timer);
    clearTimeout(s.resizeTimer);
    if (s.worker) s.worker.terminate();
    s.undo.forEach((fn) => fn());
    if (s.mode === "native") {
      exitIf(s.video);
    } else if (s.close) {
      /* Document PiP */
      s.close();
    } else {
      exitIf(s.out);
      if (s.out.srcObject) s.out.srcObject.getTracks().forEach((t) => t.stop());
      s.out.remove();
    }
    CPIP.updateButton();
  }

  /* Share with other files */
  Object.assign(CPIP, {
    start,
    stop,
    startNative,
    bind,
    bindMediaSession,
    active: () => !!session,
    begin: (s) => (session = s),
    current: (s) => session === s,
  });
})();
