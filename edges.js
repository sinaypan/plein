// Les bords de l'écran, dans chaque page : la souris tout en haut ouvre la barre
// d'onglets, la souris tout en bas demande à background.js de montrer la barre Windows.
// Alt+Q y ouvre aussi la grille de tous les onglets (grid.js).
(() => {
  const EDGE = 2; // px depuis le bord
  const BOTTOM_DWELL_MS = 180; // un bref arrêt en bas, pour ne pas sortir en frôlant le bord
  const RESTORE_AFTER_MS = 400;
  const RESTORE_MARGIN = 120; // remonter de 120 px dans la page rend le plein écran

  const alive = () => !!chrome.runtime?.id;

  const send = (message) => (alive() ? chrome.runtime.sendMessage(message).catch(() => null) : Promise.resolve(null));

  /* ---------- Barre d'onglets ---------- */

  const CSS = `
    :host {
      --card: #ffffff;
      --field: #f2f2f7;
      --text: #1c1c1e;
      --muted: #8e8e93;
      --accent: #248a3d;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --card: #1c1c1e;
        --field: #2c2c2e;
        --text: #f2f2f7;
        --accent: #30d158;
      }
    }
    * { box-sizing: border-box; }
    .bar {
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: calc(100% - 16px);
      padding: 6px;
      border-radius: 14px;
      background: var(--card);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.1);
      color: var(--text);
      font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
      pointer-events: auto;
      transform: translateY(calc(-100% - 12px));
      transition: transform 0.18s ease;
    }
    .bar.open { transform: none; }
    .tabs {
      display: flex;
      gap: 4px;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab {
      display: flex;
      flex: 0 1 190px;
      align-items: center;
      gap: 7px;
      min-width: 110px;
      height: 30px;
      padding: 0 4px 0 9px;
      border: 0;
      border-radius: 999px;
      background: var(--field);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .tab:hover { background: color-mix(in srgb, var(--text) 9%, var(--field)); }
    .tab.active { background: color-mix(in srgb, var(--accent) 22%, var(--field)); }
    .tab.pinned { flex: none; min-width: 0; width: 30px; padding: 0; justify-content: center; }
    canvas { flex: none; width: 16px; height: 16px; }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .close {
      display: grid;
      flex: none;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      color: var(--muted);
      visibility: hidden;
    }
    .tab:hover .close, .tab.active .close { visibility: visible; }
    .close:hover { background: color-mix(in srgb, var(--text) 12%, transparent); color: var(--text); }
    .add {
      display: grid;
      flex: none;
      place-items: center;
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 50%;
      background: var(--field);
      color: var(--accent);
      cursor: pointer;
    }
    .add:hover { background: color-mix(in srgb, var(--text) 9%, var(--field)); }
    svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
    .add svg { width: 14px; height: 14px; }
  `;

  let host = null;
  let bar = null;
  let barFading = null; // barre fermée, pendant qu'elle remonte
  let opening = false;

  const { icon, favicon, t } = PleinGrid;

  const draw = (tabs) => {
    const list = document.createElement('div');
    list.className = 'tabs';
    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab${tab.active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`;
      button.title = tab.title;
      button.append(favicon(tab.icon));
      if (!tab.pinned) {
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = tab.title;
        const close = document.createElement('span');
        close.className = 'close';
        close.setAttribute('role', 'button');
        close.setAttribute('aria-label', t('closeTab'));
        close.append(icon('M4.5 4.5l7 7M11.5 4.5l-7 7'));
        close.addEventListener('click', async (event) => {
          event.stopPropagation();
          const rest = await send({ type: 'close', tabId: tab.id });
          if (rest?.length) draw(rest);
          else closeBar();
        });
        button.append(title, close);
      }
      button.addEventListener('click', () => {
        if (!tab.active) send({ type: 'activate', tabId: tab.id });
        closeBar();
      });
      button.addEventListener('auxclick', (event) => {
        if (event.button !== 1 || tab.pinned) return;
        event.preventDefault();
        send({ type: 'close', tabId: tab.id }).then((rest) => (rest?.length ? draw(rest) : closeBar()));
      });
      list.append(button);
    }
    // La molette fait défiler la rangée quand les onglets ne tiennent pas.
    list.addEventListener('wheel', (event) => {
      if (list.scrollWidth <= list.clientWidth || !event.deltaY) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY;
    }, { passive: false });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add';
    add.title = t('newTab');
    add.append(icon('M8 3v10M3 8h10'));
    add.addEventListener('click', () => {
      send({ type: 'new' });
      closeBar();
    });

    bar.replaceChildren(list, add);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };

  const openBar = async () => {
    if (host || opening) return;
    opening = true;
    const tabs = await send({ type: 'tabs' });
    opening = false;
    if (!tabs?.length || host) return;

    host = document.createElement('div');
    // !important partout : la page ne doit pas pouvoir déformer la barre.
    const hostStyle = {
      all: 'initial',
      display: 'flex',
      'justify-content': 'center',
      position: 'fixed',
      top: '8px',
      left: '0',
      right: '0', // sans width: 100vw, qui passerait sous la barre de défilement
      'pointer-events': 'none',
      'z-index': '2147483647',
    };
    for (const [property, value] of Object.entries(hostStyle)) host.style.setProperty(property, value, 'important');

    // Fermée : la page ne peut lire ni les titres des autres onglets ni cliquer dedans.
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    bar = document.createElement('div');
    bar.className = 'bar';
    root.append(bar);
    draw(tabs);
    document.documentElement.append(host);

    // Couche supérieure du navigateur : passe au-dessus des fenêtres modales de la page.
    try {
      host.popover = 'manual';
      host.showPopover();
    } catch {
      // popover indisponible : le z-index suffit
    }
    requestAnimationFrame(() => requestAnimationFrame(() => bar?.classList.add('open')));
  };

  const closeBar = () => {
    if (!host) return;
    const gone = host;
    bar.classList.remove('open');
    host = bar = null;
    barFading = gone;
    setTimeout(() => {
      gone.remove();
      if (barFading === gone) barFading = null;
    }, 200);
  };

  const barBottom = () => (bar ? bar.getBoundingClientRect().bottom : 0);

  /* ---------- Grille d'onglets (Alt+Q) ---------- */

  const GRID_CSS = `
    .grid-backdrop {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(0, 0, 0, 0.28);
      opacity: 0;
      transition: opacity 0.14s ease;
    }
    .grid-backdrop.open { opacity: 1; }
    .grid-backdrop .grid-card {
      width: min(940px, calc(100% - 32px));
      max-height: calc(100% - 64px);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.1);
      transform: scale(0.97);
      transition: transform 0.14s ease;
    }
    .grid-backdrop.open .grid-card { transform: none; }
  `;

  let gridHost = null;
  let gridBack = null;
  let grid = null;
  let fading = null; // grille fermée, pendant son fondu

  // Comme Alt+Tab : Alt gardé enfoncé, chaque Q avance, lâcher Alt ouvre l'onglet
  // choisi. Un Alt+Q bref (Alt déjà relâché à l'ouverture) laisse la grille ouverte.
  const onGridKey = (event) => {
    if (!grid) return;
    const moves = {
      ArrowRight: () => grid.next(1),
      ArrowLeft: () => grid.next(-1),
      ArrowDown: () => grid.down(1),
      ArrowUp: () => grid.down(-1),
      Tab: () => grid.next(event.shiftKey ? -1 : 1),
      Enter: () => grid.pick(),
      Escape: () => closeGrid(),
    };
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'q' && event.altKey) grid.next(event.shiftKey ? -1 : 1);
    else moves[key]?.();
    // La page ne voit aucune touche tant que la grille est ouverte.
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onGridKeyUp = (event) => {
    if (!grid) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Alt') grid.pick();
  };

  const openGrid = (tabs) => {
    closeBar();
    gridHost = document.createElement('div');
    const hostStyle = {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      'z-index': '2147483647',
    };
    for (const [property, value] of Object.entries(hostStyle)) gridHost.style.setProperty(property, value, 'important');

    // Fermée, comme la barre : les titres des autres onglets ne regardent pas la page.
    const root = gridHost.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PleinGrid.CSS + GRID_CSS);
    root.adoptedStyleSheets = [sheet];

    grid = PleinGrid.build(tabs, {
      pick: (tab) => {
        if (!tab.current) send({ type: 'switch', tabId: tab.id });
        closeGrid();
      },
      close: async (tab) => {
        if (!(await send({ type: 'grid-close', tabId: tab.id }))) return;
        if (grid && !grid.remove(tab.id)) closeGrid();
      },
    });
    gridBack = document.createElement('div');
    gridBack.className = 'grid-backdrop';
    gridBack.append(grid.element);
    gridBack.addEventListener('click', (event) => {
      if (event.target === gridBack) closeGrid();
    });
    root.append(gridBack);
    document.documentElement.append(gridHost);
    try {
      gridHost.popover = 'manual';
      gridHost.showPopover();
    } catch {
      // popover indisponible : le z-index suffit
    }
    addEventListener('keydown', onGridKey, true);
    addEventListener('keyup', onGridKeyUp, true);
    requestAnimationFrame(() => requestAnimationFrame(() => gridBack?.classList.add('open')));
  };

  const closeGrid = () => {
    if (!gridHost) return;
    removeEventListener('keydown', onGridKey, true);
    removeEventListener('keyup', onGridKeyUp, true);
    const gone = gridHost;
    gridBack.classList.remove('open');
    gridHost = gridBack = grid = null;
    // Le fondu ne doit rien bloquer, et un onglet caché (Chrome y ralentit les
    // minuteurs) ne garde pas la grille jusqu'au retour.
    gone.style.setProperty('pointer-events', 'none', 'important');
    if (document.hidden) return gone.remove();
    fading = gone;
    setTimeout(() => {
      gone.remove();
      if (fading === gone) fading = null;
    }, 160);
  };

  /* ---------- Voile ---------- */

  // Windows redessine la fenêtre d'un coup quand elle sort du plein écran ou y
  // revient : un voile flou fondu par-dessus la page adoucit ce saut.
  const VEIL_MS = 110;
  let veil = null;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const showVeil = async () => {
    if (veil) return;
    veil = document.createElement('div');
    const veilStyle = {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      'z-index': '2147483647',
      'pointer-events': 'none',
      background: 'rgba(128, 128, 128, 0.08)',
      'backdrop-filter': 'blur(16px)',
      opacity: '0',
      transition: `opacity ${VEIL_MS}ms ease`,
    };
    for (const [property, value] of Object.entries(veilStyle)) veil.style.setProperty(property, value, 'important');
    document.documentElement.append(veil);
    veil.getBoundingClientRect(); // part bien de 0 pour le fondu
    veil.style.setProperty('opacity', '1', 'important');
    await wait(VEIL_MS);
  };

  const hideVeil = () => {
    if (!veil) return;
    const gone = veil;
    veil = null;
    gone.style.setProperty('opacity', '0', 'important');
    setTimeout(() => gone.remove(), VEIL_MS + 20);
  };

  // La fenêtre a fini de changer de taille (ou n'a pas bougé du tout).
  const resized = () =>
    new Promise((resolve) => {
      const done = () => {
        removeEventListener('resize', done);
        clearTimeout(timer);
        setTimeout(resolve, 120);
      };
      const timer = setTimeout(done, 700);
      addEventListener('resize', done);
    });

  // Le voile monte, la fenêtre change, le voile s'efface une fois la page redessinée.
  const veiled = async (message) => {
    await showVeil();
    const settled = resized();
    const changed = await send(message);
    if (changed) await settled;
    hideVeil();
    return changed;
  };

  /* ---------- Souris ---------- */

  let bottomTimer = 0;
  let revealedAt = 0;

  const onMove = (event) => {
    if (!alive()) return stop();
    if (!event.isTrusted) return; // un faux mouvement envoyé par la page ne compte pas
    if (document.fullscreenElement) return; // une vidéo en plein écran garde la main
    const y = event.clientY;
    const height = innerHeight;

    if (y >= height - EDGE) {
      if (!bottomTimer && !revealedAt) {
        bottomTimer = setTimeout(async () => {
          bottomTimer = 0;
          revealedAt = Date.now(); // pas de second déclenchement pendant le changement
          if (!(await veiled({ type: 'bottom' }))) revealedAt = 0;
          else revealedAt = Date.now();
        }, BOTTOM_DWELL_MS);
      }
    } else if (bottomTimer) {
      clearTimeout(bottomTimer);
      bottomTimer = 0;
    }

    // Retour dans la page après être passé par la barre Windows.
    if (revealedAt && Date.now() - revealedAt > RESTORE_AFTER_MS && y < height - RESTORE_MARGIN) {
      revealedAt = 0;
      veiled({ type: 'restore' });
    }

    if (y <= EDGE - 1) openBar();
    else if (host && y > barBottom() + 30) closeBar();
  };

  const onKey = (event) => {
    if (event.key === 'Escape' && host) closeBar();
  };

  const onHide = () => {
    closeBar();
    closeGrid();
    // Grille en train de s'effacer quand l'onglet passe en arrière-plan.
    if (document.hidden && fading) {
      fading.remove();
      fading = null;
    }
    if (bottomTimer) clearTimeout(bottomTimer);
    bottomTimer = 0;
  };

  const onMessage = (message, sender, sendResponse) => {
    if (message?.type === 'ping') sendResponse(true);
    // Photo de l'onglet pour l'aperçu : rien n'est pris tant que la barre, la
    // grille ou le voile sont à l'écran (même en train de s'effacer). La photo
    // attendra le prochain passage.
    if (message?.type === 'quiet') sendResponse(!(host || grid || veil || fading || barFading));
    // Alt+Q de nouveau, grille ouverte : on avance.
    if (message?.type === 'grid-next') {
      if (grid) grid.next(1);
      sendResponse(!!grid);
    }
    if (message?.type === 'grid' && !document.hidden) {
      if (grid) grid.next(1);
      else openGrid(message.tabs);
      sendResponse(true);
    }
  };

  // Extension rechargée : ce script n'a plus de lien avec elle et s'efface.
  const stop = () => {
    removeEventListener('mousemove', onMove, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('blur', onHide);
    document.removeEventListener('visibilitychange', onHide);
    closeGrid();
    host?.remove();
    veil?.remove();
    host = bar = veil = null;
  };

  addEventListener('mousemove', onMove, { capture: true, passive: true });
  addEventListener('keydown', onKey, true);
  addEventListener('blur', onHide);
  document.addEventListener('visibilitychange', onHide);
  chrome.runtime.onMessage.addListener(onMessage);

  // Un PDF n'a pas de bords utilisables : background.js y remet une fenêtre normale.
  send({ type: 'hello', pdf: document.contentType === 'application/pdf' });
})();
