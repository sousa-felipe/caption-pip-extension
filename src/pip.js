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

  function drawBlock(ctx, canvas, block, content, scaleX, scaleY, minFontSize) {
    const fontSize = Math.max(block.fs * scaleX * FONT_BOOST, minFontSize);
    ctx.font = `${block.weight} ${fontSize}px ${block.font}`;
    ctx.textAlign = block.leftAlign ? "left" : "center";
    ctx.textBaseline = "alphabetic";
    const maxW = CPIP.clamp(block.width * scaleX, canvas.width * 0.25, canvas.width * 0.94);
    const lines = wrap(ctx, block.text, maxW);
    const lineHeight = fontSize * 1.25;
    const centerX = CPIP.clamp((block.left + block.width / 2 - content.left) * scaleX, maxW / 2, canvas.width - maxW / 2);
    const leftX = CPIP.clamp((block.left - content.left) * scaleX, fontSize * 0.2, Math.max(fontSize * 0.2, canvas.width - maxW));
    const x = block.leftAlign ? leftX : centerX;
    const last = CPIP.clamp((block.bottom - content.top) * scaleY - fontSize * 0.28, lines.length * lineHeight, canvas.height - fontSize * 0.3);
    ctx.lineJoin = "round";
    lines.forEach((line, i) => {
      const y = last - (lines.length - 1 - i) * lineHeight;
      if (block.bg) {
        const textW = ctx.measureText(line).width;
        ctx.fillStyle = block.bg;
        ctx.fillRect((block.leftAlign ? x : centerX - textW / 2) - fontSize * 0.2, y - fontSize * 0.95, textW + fontSize * 0.4, fontSize * 1.2);
      } else {
        ctx.lineWidth = fontSize * 0.14;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = block.color;
      ctx.fillText(line, x, y);
    });
  }

  function paint(s) {
    const { video, canvas, ctx } = s;
    const content = CPIP.content(video);
    if (!content.width || !content.height) return;
    s.dirty = false;
    s.paintAt = performance.now();
    const scaleX = canvas.width / content.width;
    const scaleY = canvas.height / content.height;
    try {
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {}
    for (const layer of s.caps.layers) {
      const box = layer.getBoundingClientRect();
      try {
        ctx.drawImage(layer, (box.left - content.left) * scaleX, (box.top - content.top) * scaleY, box.width * scaleX, box.height * scaleY);
      } catch (e) {}
    }
    /* Scale font to PiP window width */
    const minFontSize = MIN_FONT_PX * (canvas.width / (s.win ? s.win.width : canvas.width));
    for (const block of s.caps.blocks) drawBlock(ctx, canvas, block, content, scaleX, scaleY, minFontSize);
  }

  /* Resize canvas to video and PiP window */
  function sizeCanvas(s) {
    const vw = s.video.videoWidth || 1280;
    const vh = s.video.videoHeight || 720;
    const px = s.win ? s.win.width * (window.devicePixelRatio || 1) : vw;
    const target = CPIP.clamp(px, MIN_W, MAX_W);
    /* Avoid shaking */
    const currentW = s.canvas.width;
    const sameAspect = s.sized && Math.abs(currentW / s.canvas.height - vw / vh) < 0.01;
    if (sameAspect && currentW >= target && currentW - target < STEP_W * 2) return;
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
    caps.layers.length + "|" + caps.blocks.map((block) => `${block.text}@${Math.round(block.left)},${Math.round(block.bottom)},${Math.round(block.width)}`).join("|");

  /* Count decoded frames */
  function frameCount(video) {
    try {
      return video.getVideoPlaybackQuality().totalVideoFrames;
    } catch (e) {
      return video.currentTime;
    }
  }

  function tick(s) {
    if (session !== s) return;
    const time = performance.now();
    if (!s.video.isConnected) return stop(s);
    const playing = !s.video.paused;
    if (time - s.scanAt >= (playing ? SCAN_MS : SCAN_PAUSED_MS)) {
      s.scanAt = time;
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
      const aspect = s.video.videoWidth / s.video.videoHeight;
      if (aspect && Math.abs(s.canvas.width / s.canvas.height - aspect) > 0.01) sizeCanvas(s);
    }
    /* Track caption motion */
    else if (playing && s.caps.blocks.length) {
      try {
        if (CPIP.trackBlocksMotion(s.caps)) s.dirty = true;
      } catch (e) {}
    }
    /* Paint at video frame rate */
    const frames = frameCount(s.video);
    if (frames !== s.fc) {
      s.fc = frames;
      s.fcAt = time;
      s.dirty = true;
    } else if (playing && time - s.fcAt > STALL_MS) {
      /* Paint every tick if counter stalls */
      s.dirty = true;
    }
    /* Paint canvas subtitles every tick */
    if (playing && s.caps.layers.length) s.dirty = true;
    if (s.dirty || time - s.paintAt >= KEEPALIVE_MS) paint(s);
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
      seekto: (details) => {
        if (details.seekTime == null) return;
        if (details.fastSeek && typeof video.fastSeek === "function") video.fastSeek(details.seekTime);
        else video.currentTime = details.seekTime;
      },
    };
    for (const [name, handler] of Object.entries(acts)) {
      try {
        media.setActionHandler(name, handler);
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

  const exitIf = (video) => document.pictureInPictureElement === video && document.exitPictureInPicture().catch(() => {});

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
      if (s.out.srcObject) s.out.srcObject.getTracks().forEach((track) => track.stop());
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
