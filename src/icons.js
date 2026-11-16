(() => {
  /* Icons */
  const loaded = (window.__cpipLoaded = window.__cpipLoaded || {});
  if (loaded.icons || document.documentElement.hasAttribute("data-cpip-pip")) return;
  loaded.icons = true;
  const CPIP = (window.CPIP = window.CPIP || {});

  /* Shared pieces */
  const ARROW_BACK = '<path d="M4 13a8 8 0 1 0 8-8H9.5M12 2.5 9.5 5 12 7.5"/>';
  const TEN = '<path d="M8.25 10.75H9v4.5"/><rect x="12.25" y="10.75" width="2.5" height="4.5" rx=".25"/>';
  const SPEAKER = '<path d="M3.75 8.75h2.6l3.05-4.45v11.4l-3.05-4.45h-2.6z"/>';
  const WAVES = '<path d="M11.5 7.15a3.03 3.03 0 0 1 0 5.7z" fill="currentColor" stroke="none"/><path d="M12.4 4.3a6.1 6.1 0 0 1 0 11.4"/>';

  CPIP.ICONS = {
    /* Caption Pip extension buttons */
    PIP:
      '<svg viewBox="0 0 36 36" aria-hidden="true">' +
      '<rect x="3" y="6" width="30" height="24" rx="1.5" fill="none" stroke="#fff" stroke-width="3"/>' +
      '<rect x="18" y="18" width="10.5" height="7.5" fill="#fff"/></svg>',

    PICK:
      '<svg viewBox="0 0 36 36" aria-hidden="true">' +
      '<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M13.5 19.5V8.25a2.25 2.25 0 0 1 4.5 0V9.5h2a1.75 1.75 0 0 1 1.75 1.75h1.75a1.75 1.75 0 0 1 1.75 1.75' +
      'h1.75a1.75 1.75 0 0 1 1.75 1.75V23.5c0 3.5-2 6-4.5 7H15C12.5 27.5 9.5 23 7.5 19c-.6-1.2.4-2.3 1.6-2' +
      'c1.8.4 3.4 1.3 4.4 2.5Z"/>' +
      '<path d="M18 9.5v5.5M21.75 11.25v4.25M25.25 13v3"/></g></svg>',

    PLUS: '<svg viewBox="0 0 9 9" aria-hidden="true"><path d="M4.5 1v7M1 4.5h7" fill="none" stroke="#fff" stroke-width="1"/></svg>',

    /* Document PiP buttons */
    PLAY:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M9.22 7.9v8.2l7.77-4.1z" fill="currentColor" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/></svg>',

    PAUSE:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g fill="currentColor"><rect x="8.5" y="6.5" width="1.5" height="11" rx=".75"/><rect x="14" y="6.5" width="1.5" height="11" rx=".75"/></g></svg>',

    RESTART:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      ARROW_BACK +
      "</g></svg>",

    BACK10:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<g stroke-width="2">' +
      ARROW_BACK +
      "</g>" +
      TEN +
      "</g></svg>",

    FWD10:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 13a8 8 0 1 1-8-8h2.5M12 2.5 14.5 5 12 7.5" stroke-width="2"/>' +
      TEN +
      "</g></svg>",

    PREV:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5.5 6.4v11.2"/>' +
      '<path d="M9.33 11.12 16.77 6.55Q18.2 5.67 18.2 7.65v8.69Q18.2 18.33 16.77 17.45L9.33 12.88Q7.9 12 9.33 11.12z" stroke-width="1.25"/>' +
      "</g></svg>",

    NEXT:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M18.5 6.4v11.2"/>' +
      '<path d="M14.67 11.12 7.23 6.55Q5.8 5.67 5.8 7.65v8.69Q5.8 18.33 7.23 17.45l7.44-4.57Q16.1 12 14.67 11.12z" stroke-width="1.25"/>' +
      "</g></svg>",

    VOL:
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      SPEAKER +
      WAVES +
      "</g></svg>",

    MUTED:
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<mask id="cpip-cut"><rect width="20" height="20" fill="#fff"/><path d="M3 3.5l13.3 13.3" stroke="#000" stroke-width="4" stroke-linecap="round"/></mask>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<g mask="url(#cpip-cut)">' +
      SPEAKER +
      WAVES +
      "</g>" +
      '<path d="M3 3.5l13.3 13.3"/>' +
      "</g></svg>",

    CC:
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<rect x="2.75" y="4.75" width="14.5" height="10.5" rx=".75" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<g fill="currentColor"><rect x="5" y="8" width="4" height="2" rx=".3"/><rect x="10" y="8" width="5" height="2" rx=".3"/>' +
      '<rect x="5" y="11" width="7" height="2" rx=".3"/><rect x="13" y="11" width="2" height="2" rx=".3"/></g></svg>',

    FIT:
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="2.75" y="4.75" width="14.5" height="10.5" rx=".75"/><path d="M5.75 9.75v-2h2M14.25 10.25v2h-2"/>' +
      "</g></svg>",
  };
})();
