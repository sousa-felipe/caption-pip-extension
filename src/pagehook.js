(() => {
  /* Record site media session actions, see documentpip.js */
  const media = navigator.mediaSession;
  if (!media || media.__cpip) return;
  media.__cpip = true;
  const orig = media.setActionHandler.bind(media);
  const handlers = {};
  const publish = () => document.documentElement && document.documentElement.setAttribute("data-cpip-ms", Object.keys(handlers).join(" "));
  media.setActionHandler = (action, fn) => {
    if (fn) handlers[action] = fn;
    else delete handlers[action];
    publish();
    return orig(action, fn);
  };
  window.addEventListener("cpip-ms", (e) => {
    if (e.detail === "restore") {
      for (const [action, fn] of Object.entries(handlers)) {
        try {
          orig(action, fn);
        } catch (err) {}
      }
      return;
    }
    const fn = handlers[e.detail];
    if (fn) {
      try {
        fn({ action: e.detail });
      } catch (err) {}
    }
  });
})();
