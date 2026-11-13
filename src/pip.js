(() => {
  if (window.__cpipLoaded) return;
  const CPIP = (window.CPIP = window.CPIP || {});

  const FPS = 60;
  const MAX_W = 1920;
  const MIN_W = 640;
  const STEP_W = 128;
  const SCAN_MS = 33;
  const BOOST = 1.2;
  const MIN_PX = 15;

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
    const fs = Math.max(b.fs * sx * BOOST, minFs);
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
    const minFs = MIN_PX * (cv.width / (s.win ? s.win.width : cv.width));
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

  function frame(s) {
    const t = performance.now();
    if (t - s.last < 1000 / FPS - 4) return;
    s.last = t;
    if (!s.video.isConnected) return stop(s);
    if (t - s.scanAt >= SCAN_MS) {
      s.scanAt = t;
      try {
        s.caps = CPIP.scan(s);
      } catch (e) {
        console.warn("[Caption pip] scan failed", e);
      }
      const k = s.video.videoWidth / s.video.videoHeight;
      if (k && Math.abs(s.canvas.width / s.canvas.height - k) > 0.01) sizeCanvas(s);
    }
    paint(s);
  }

  /* Session */
  function bind(s, target, type, fn) {
    target.addEventListener(type, fn);
    s.undo.push(() => target.removeEventListener(type, fn));
  }

  /* Anti low freq ticker */
  function startTicker(s) {
    const tick = () => frame(s);
    const ms = 1000 / FPS;
    s.timer = setInterval(tick, ms);
    try {
      const url = URL.createObjectURL(new Blob(["setInterval(()=>postMessage(0)," + Math.round(ms) + ")"]));
      s.worker = new Worker(url);
      s.worker.onmessage = tick;
      s.worker.onerror = () => s.worker && s.worker.terminate();
      URL.revokeObjectURL(url);
    } catch (e) {}
  }

  /* Open plain PiP without captions */
  async function startNative(video) {
    const s = { mode: "native", video, undo: [] };
    session = s;
    try {
      await video.requestPictureInPicture();
    } catch (e) {
      stop(s);
      return CPIP.toast("Could not open Caption pip", "Caption pip");
    }
    bind(s, video, "leavepictureinpicture", () => stop(s));
    CPIP.updateButton();
  }

  async function start(video) {
    if (!video) return CPIP.toast("No video found here", "Caption pip");
    if (video.mediaKeys) {
      CPIP.toast("protected by DRM", "Caption pip");
      return startNative(video);
    }
    if (!document.pictureInPictureEnabled) return CPIP.toast("Caption pip is not available", "Caption pip");
    const s = {
      video,
      canvas: document.createElement("canvas"),
      out: document.createElement("video"),
      caps: { blocks: [], layers: [] },
      undo: [],
      win: null,
      last: 0,
      scanAt: 0,
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
        throw new Error("This video blocks capture");
      }
      s.out.className = "cpip-out";
      s.out.muted = true;
      s.out.playsInline = true;
      s.out.srcObject = s.canvas.captureStream(FPS);
      document.documentElement.appendChild(s.out);
      await s.out.play();
      s.win = await s.out.requestPictureInPicture();
    } catch (e) {
      stop(s);
      return CPIP.toast(e && e.message ? e.message : "Could not open Caption pip", "Caption pip");
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
      if (!video.paused) return;
      s.nudge = true;
      s.out.play().catch(() => {});
      setTimeout(() => {
        s.out.pause();
        setTimeout(() => (s.nudge = false), 100);
      }, 300);
    });
    if (video.paused) s.out.pause();

    try {
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => video.play());
      ms.setActionHandler("pause", () => video.pause());
      ms.setActionHandler("seekbackward", () => (video.currentTime = Math.max(0, video.currentTime - 10)));
      ms.setActionHandler("seekforward", () => (video.currentTime = video.currentTime + 10));
    } catch (e) {}
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
      if (document.pictureInPictureElement === s.video) document.exitPictureInPicture().catch(() => {});
    } else {
      if (document.pictureInPictureElement === s.out) document.exitPictureInPicture().catch(() => {});
      if (s.out.srcObject) s.out.srcObject.getTracks().forEach((t) => t.stop());
      s.out.remove();
    }
    CPIP.updateButton();
  }

  CPIP.start = start;
  CPIP.stop = stop;
  CPIP.active = () => !!session;
})();
