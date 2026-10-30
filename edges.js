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
    .detail {
      display: flex;
      flex: 1;
      gap: 6px;
      min-width: 0;
      animation: detail-in 0.12s ease;
    }
    @keyframes detail-in { from { opacity: 0; } }
    .name { flex: 0 1 240px; padding-right: 12px; }
    .address {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 12px;
      border: 0;
      border-radius: 999px;
      outline: 0;
      background: var(--field);
      color: inherit;
      font: inherit;
      text-overflow: ellipsis;
    }
    .address:hover { background: color-mix(in srgb, var(--text) 9%, var(--field)); }
    .address:focus { background: var(--field); box-shadow: inset 0 0 0 2px var(--accent); }
    .add.on { background: color-mix(in srgb, var(--accent) 22%, var(--field)); }
    .favs, .menu {
      border-radius: 14px;
      background: var(--card);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.1);
      color: var(--text);
      font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
      pointer-events: auto;
      animation: detail-in 0.12s ease;
    }
    .favs {
      display: flex;
      gap: 4px;
      max-width: calc(100% - 16px);
      padding: 6px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .menu {
      position: fixed;
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 280px;
      padding: 6px;
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .fav, .item {
      display: flex;
      flex: none;
      align-items: center;
      gap: 7px;
      height: 30px;
      border: 0;
      background: var(--field);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .fav { max-width: 180px; padding: 0 11px 0 9px; border-radius: 999px; }
    .item { width: 100%; padding: 0 9px; border-radius: 9px; background: transparent; }
    .fav:hover, .item:hover { background: color-mix(in srgb, var(--text) 9%, var(--field)); }
    .fav.on { background: color-mix(in srgb, var(--accent) 22%, var(--field)); }
    .fav svg, .item svg { flex: none; width: 16px; height: 16px; color: var(--muted); }
    .empty { padding: 6px 10px; color: var(--muted); white-space: nowrap; }
  `;

  let host = null;
  let bar = null;
  let barFading = null; // barre fermée, pendant qu'elle remonte
  let opening = false;

  const { icon, favicon, t } = PleinGrid;

  const openTab = (tab) => {
    if (!tab.active) send({ type: 'activate', tabId: tab.id });
    closeBar();
  };

  /* ---------- Un onglet en détail ---------- */

  // La souris posée un moment sur un onglet le montre seul, son nom à gauche et son
  // adresse à modifier à côté. Quitter la barre ramène les onglets, sauf pendant
  // qu'on écrit : l'écriture finit par Entrée, Échap ou un clic ailleurs.
  const DETAIL_DWELL_MS = 700;
  // La page ne doit ni réagir aux touches (raccourcis du site) ni lire ce qu'on écrit.
  const TYPING_EVENTS = ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'cut', 'copy'];

  let detailTimer = 0;
  let backToTabs = null; // présent tant que le détail est affiché
  let editing = false;
  let endEdit = null;

  const cancelDwell = () => {
    clearTimeout(detailTimer);
    detailTimer = 0;
  };

  const dwell = (tab) => {
    cancelDwell();
    const timer = setTimeout(async () => {
      const url = await send({ type: 'tab-url', tabId: tab.id });
      if (detailTimer === timer && url && bar) showDetail(tab, url);
    }, DETAIL_DWELL_MS);
    detailTimer = timer;
  };

  const showTabs = () => {
    const back = backToTabs;
    backToTabs = null;
    back?.();
  };

  const showDetail = (tab, url) => {
    cancelDwell();
    const row = [...bar.children];
    const scroll = row[0].scrollLeft;
    // La barre ne fait que grandir : la souris reste dedans, où qu'était l'onglet.
    bar.style.width = `${Math.max(bar.offsetWidth, Math.min(720, innerWidth - 16))}px`;
    backToTabs = () => {
      bar.style.removeProperty('width');
      bar.replaceChildren(...row);
      row[0].scrollLeft = scroll;
    };

    const name = document.createElement('button');
    name.type = 'button';
    name.className = `tab name${tab.active ? ' active' : ''}`;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    name.append(favicon(tab.icon), title);
    name.addEventListener('click', () => openTab(tab));

    const address = document.createElement('input');
    address.type = 'text';
    address.className = 'address';
    address.value = url;
    address.dir = 'ltr';
    address.spellcheck = false;
    address.autocomplete = 'off';
    address.setAttribute('aria-label', t('tabAddress'));

    const onTyping = (event) => {
      event.stopImmediatePropagation();
      if (event.type !== 'keydown') return;
      // La touche relâchée après Entrée ou Échap arrive une fois l'écriture finie : elle reste cachée aussi.
      const hideRelease = () => addEventListener('keyup', (up) => up.stopImmediatePropagation(), { capture: true, once: true });
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        const text = address.value.trim();
        if (!text) return;
        hideRelease();
        send({ type: 'go', tabId: tab.id, text });
        closeBar();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideRelease();
        address.value = url;
        address.blur();
      }
    };
    // Le premier clic prend toute l'adresse, comme dans la barre de Chrome ; les suivants placent le curseur.
    address.addEventListener('mousedown', (event) => {
      if (editing) return;
      event.preventDefault();
      address.focus();
      address.select();
    });
    address.addEventListener('focus', () => {
      editing = true;
      for (const type of TYPING_EVENTS) addEventListener(type, onTyping, true);
      endEdit = () => {
        endEdit = null;
        editing = false;
        for (const type of TYPING_EVENTS) removeEventListener(type, onTyping, true);
        address.blur();
      };
    });
    address.addEventListener('blur', () => {
      endEdit?.();
      if (bar && !bar.matches(':hover')) showTabs();
    });

    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.append(name, address);
    bar.replaceChildren(detail);
  };

  /* ---------- Favoris ---------- */

  // Une extension ne peut pas ouvrir la barre de favoris de Chrome : le bouton étoile
  // en dessine une sous les onglets. Les favoris ne sont demandés qu'à ce moment-là.
  const FOLDER_ICON = 'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z';
  const STAR_ICON = 'M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.7l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z';
  const BACK_ICON = 'M10 3L5 8l5 5';

  let favs = null;
  let menu = null;
  let menuAnchor = null;

  const openBookmark = (item, newTab) => {
    send({ type: 'open-bookmark', id: item.id, newTab });
    if (!newTab) closeBar();
  };

  // Un favori ou un dossier, dans la rangée (fav) comme dans un dossier ouvert (item).
  const bookmarkButton = (item, className, onFolder) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', item.title || item.host);
    button.append(item.folder ? icon(FOLDER_ICON) : favicon(item.icon));
    if (item.title) {
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = item.title;
      button.append(title);
    }
    if (item.folder) {
      button.addEventListener('click', () => onFolder(button));
    } else {
      button.addEventListener('click', (event) => openBookmark(item, event.ctrlKey));
      button.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        openBookmark(item, true);
      });
    }
    return button;
  };

  const emptyLine = () => {
    const line = document.createElement('div');
    line.className = 'empty';
    line.textContent = t('noBookmarks');
    return line;
  };

  const closeMenu = () => {
    menuAnchor?.classList.remove('on');
    menu?.remove();
    menu = menuAnchor = null;
  };

  // trail : du dossier de la rangée jusqu'au dossier affiché.
  const showFolder = async (anchor, trail) => {
    menuAnchor = anchor;
    anchor.classList.add('on');
    const items = await send({ type: 'bookmarks', id: trail.at(-1).id });
    if (!items || menuAnchor !== anchor) return;
    if (!menu) {
      const top = favs.getBoundingClientRect().bottom + 6;
      menu = document.createElement('div');
      menu.className = 'menu';
      menu.style.top = `${top}px`;
      menu.style.left = `${Math.max(8, Math.min(anchor.getBoundingClientRect().left, innerWidth - 288))}px`;
      menu.style.maxHeight = `${innerHeight - top - 8}px`;
      bar.getRootNode().append(menu);
    }
    const lines = items.map((item) => bookmarkButton(item, 'item', () => showFolder(anchor, [...trail, item])));
    if (!lines.length) lines.push(emptyLine());
    if (trail.length > 1) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'item';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = trail.at(-1).title;
      back.append(icon(BACK_ICON), title);
      back.addEventListener('click', () => showFolder(anchor, trail.slice(0, -1)));
      lines.unshift(back);
    }
    menu.replaceChildren(...lines);
    menu.scrollTop = 0;
  };

  const closeFavs = () => {
    closeMenu();
    favs?.remove();
    favs = null;
  };

  const toggleFavs = async (star) => {
    if (favs) {
      closeFavs();
      star.classList.remove('on');
      return;
    }
    const owner = bar;
    const items = await send({ type: 'bookmarks' });
    if (!items || bar !== owner || favs) return;
    favs = document.createElement('div');
    favs.className = 'favs';
    const row = items.map((item) =>
      bookmarkButton(item, 'fav', (button) => {
        if (menuAnchor === button) return closeMenu();
        closeMenu();
        showFolder(button, [item]);
      }),
    );
    favs.append(...(row.length ? row : [emptyLine()]));
    scrollsSideways(favs);
    favs.addEventListener('scroll', closeMenu, { passive: true });
    bar.after(favs);
    star.classList.add('on');
  };

  // La molette fait défiler une rangée qui ne tient pas.
  const scrollsSideways = (row) => {
    row.addEventListener('wheel', (event) => {
      if (row.scrollWidth <= row.clientWidth || !event.deltaY) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    }, { passive: false });
  };

  const draw = (tabs) => {
    cancelDwell();
    const list = document.createElement('div');
    list.className = 'tabs';
    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab${tab.active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`;
      button.setAttribute('aria-label', tab.title); // pas de title : la bulle de Chrome passerait devant le détail
      button.append(favicon(tab.icon));
      button.addEventListener('mouseenter', () => dwell(tab));
      button.addEventListener('mouseleave', cancelDwell);
      if (!tab.pinned) {
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = tab.title;
        const close = document.createElement('span');
        close.className = 'close';
        close.setAttribute('role', 'button');
        close.setAttribute('aria-label', t('closeTab'));
        close.append(icon('M4.5 4.5l7 7M11.5 4.5l-7 7'));
        // Viser la croix ne doit pas la faire disparaître sous la souris.
        close.addEventListener('mouseenter', cancelDwell);
        close.addEventListener('mouseleave', () => dwell(tab));
        close.addEventListener('click', async (event) => {
          event.stopPropagation();
          const rest = await send({ type: 'close', tabId: tab.id });
          if (rest?.length) draw(rest);
          else closeBar();
        });
        button.append(title, close);
      }
      button.addEventListener('click', () => openTab(tab));
      button.addEventListener('auxclick', (event) => {
        if (event.button !== 1 || tab.pinned) return;
        event.preventDefault();
        send({ type: 'close', tabId: tab.id }).then((rest) => (rest?.length ? draw(rest) : closeBar()));
      });
      list.append(button);
    }
    scrollsSideways(list);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add';
    add.title = t('newTab');
    add.append(icon('M8 3v10M3 8h10'));
    add.addEventListener('click', () => {
      send({ type: 'new' });
      closeBar();
    });

    const star = document.createElement('button');
    star.type = 'button';
    star.className = `add${favs ? ' on' : ''}`;
    star.title = t('bookmarksBar');
    star.append(icon(STAR_ICON));
    star.addEventListener('click', () => toggleFavs(star));

    bar.replaceChildren(list, add, star);
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
      'flex-direction': 'column',
      'align-items': 'center',
      gap: '6px',
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
    // Filer vers le bord de l'écran, au-dessus de la barre, ne compte pas comme la quitter.
    bar.addEventListener('mouseleave', (event) => {
      if (!editing && event.clientY >= bar.getBoundingClientRect().top) showTabs();
    });
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
    cancelDwell();
    endEdit?.();
    backToTabs = null;
    closeFavs();
    const gone = host;
    bar.classList.remove('open');
    host = bar = null;
    barFading = gone;
    setTimeout(() => {
      gone.remove();
      if (barFading === gone) barFading = null;
    }, 200);
  };

  const barBottom = () => Math.max(0, ...[bar, favs, menu].filter(Boolean).map((part) => part.getBoundingClientRect().bottom));

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
    else if (host && !editing && y > barBottom() + 30) closeBar();
  };

  const onKey = (event) => {
    if (event.key === 'Escape' && host && !editing) closeBar();
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
    cancelDwell();
    endEdit?.();
    backToTabs = null;
    closeFavs();
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
