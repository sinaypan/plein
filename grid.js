// La grille d'onglets d'Alt+Q, partagée par les pages (edges.js, dans une ombre
// fermée) et par la bulle de l'icône (sur les pages de Chrome, où rien ne peut
// être dessiné). Elle ne fait qu'afficher : choisir ou fermer un onglet est
// confié à qui l'a construite.
// eslint-disable-next-line no-var
var PleinGrid = (() => {
  // Textes dans la langue de Chrome (_locales) ; ce fichier tourne aussi dans les pages.
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

  const CSS = `
    :host, :root {
      --card: #ffffff;
      --field: #f2f2f7;
      --text: #1c1c1e;
      --muted: #8e8e93;
      --accent: #248a3d;
    }
    @media (prefers-color-scheme: dark) {
      :host, :root {
        --card: #1c1c1e;
        --field: #2c2c2e;
        --text: #f2f2f7;
        --accent: #30d158;
      }
    }
    .grid-card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border-radius: 14px;
      background: var(--card);
      color: var(--text);
      font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    .grid-card * { box-sizing: border-box; }
    .grid-tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .grid-tile {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      border: 0;
      border-radius: 12px;
      background: var(--field);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .grid-tile.selected {
      background: color-mix(in srgb, var(--accent) 22%, var(--field));
      box-shadow: inset 0 0 0 2px var(--accent);
    }
    .grid-shot {
      display: grid;
      place-items: center;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border-radius: 8px;
      background: color-mix(in srgb, var(--text) 5%, var(--card));
    }
    .grid-pic {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
    }
    .grid-big { width: 32px; height: 32px; }
    .grid-top {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      padding: 0 2px 2px 4px;
    }
    .grid-top canvas, .grid-top img { flex: none; width: 16px; height: 16px; }
    .grid-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .grid-close {
      display: grid;
      flex: none;
      place-items: center;
      width: 22px;
      height: 22px;
      margin: -3px -2px -3px 0;
      border-radius: 50%;
      color: var(--muted);
      visibility: hidden;
    }
    .grid-tile:hover .grid-close, .grid-tile.selected .grid-close { visibility: visible; }
    .grid-close:hover { background: color-mix(in srgb, var(--text) 12%, transparent); color: var(--text); }
    .grid-close svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
    .grid-hint {
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }
    .grid-hint b { color: var(--text); font-weight: 600; }
  `;

  const icon = (d) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  };

  // Dans une page : l'image arrive en données et se dessine sur un canvas (rien
  // à charger, la politique de sécurité du site ne peut pas la bloquer).
  // Dans la bulle : c'est une adresse (icône) ou une image en data:, chargée normalement.
  // size : côté fixe en px (icônes) ; sans size, le canvas prend la taille de l'image.
  const picture = (source, className, size) => {
    if (typeof source === 'string') {
      const img = document.createElement('img');
      img.src = source;
      img.alt = '';
      img.className = className;
      return img;
    }
    const canvas = document.createElement('canvas');
    canvas.className = className;
    if (size) canvas.width = canvas.height = size * Math.ceil(devicePixelRatio || 1);
    if (source) {
      try {
        const bytes = Uint8Array.from(atob(source.data), (c) => c.charCodeAt(0));
        createImageBitmap(new Blob([bytes], { type: source.type }))
          .then((image) => {
            if (!size) {
              canvas.width = image.width;
              canvas.height = image.height;
            }
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          })
          .catch(() => {});
      } catch {
        // image illisible : la place reste vide
      }
    }
    return canvas;
  };

  const favicon = (source, className = '') => picture(source, className, 16);

  const hint = () => {
    const line = document.createElement('div');
    line.className = 'grid-hint';
    const parts = [['Alt+Q', t('hintNext')], [t('keyEnter'), t('hintOpen')], [t('keyEsc'), t('hintClose')]];
    parts.forEach(([key, text], index) => {
      const b = document.createElement('b');
      b.textContent = key;
      line.append(...(index ? [' · '] : []), b, ' ', text);
    });
    return line;
  };

  // tabs : du plus récent au plus ancien, le premier est l'onglet affiché.
  // actions : { pick(tab), close(tab) }
  const build = (tabs, actions) => {
    let list = [...tabs];
    let selected = list.length > 1 ? 1 : 0;

    const card = document.createElement('div');
    card.className = 'grid-card';
    const tiles = document.createElement('div');
    tiles.className = 'grid-tiles';
    card.append(tiles, hint());

    const select = (index) => {
      if (!list.length) return;
      selected = (index + list.length) % list.length;
      tiles.querySelectorAll('.grid-tile').forEach((tile, i) => tile.classList.toggle('selected', i === selected));
      tiles.children[selected]?.scrollIntoView({ block: 'nearest' });
    };

    const draw = () => {
      tiles.replaceChildren(
        ...list.map((tab, index) => {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'grid-tile';
          tile.title = tab.host ? `${tab.title} · ${tab.host}` : tab.title;

          // L'aperçu : la page telle qu'elle a été vue en dernier, sinon sa grande icône.
          const shot = document.createElement('div');
          shot.className = 'grid-shot';
          shot.append(tab.thumb ? picture(tab.thumb, 'grid-pic') : picture(tab.icon, 'grid-big', 32));

          const top = document.createElement('div');
          top.className = 'grid-top';
          const title = document.createElement('span');
          title.className = 'grid-title';
          title.textContent = tab.title;
          top.append(favicon(tab.icon), title);
          if (!tab.pinned) {
            const close = document.createElement('span');
            close.className = 'grid-close';
            close.setAttribute('role', 'button');
            close.setAttribute('aria-label', t('closeTab'));
            close.append(icon('M4.5 4.5l7 7M11.5 4.5l-7 7'));
            close.addEventListener('click', (event) => {
              event.stopPropagation();
              actions.close(tab);
            });
            top.append(close);
          }

          tile.append(shot, top);
          tile.addEventListener('click', () => actions.pick(tab));
          tile.addEventListener('auxclick', (event) => {
            if (event.button !== 1 || tab.pinned) return;
            event.preventDefault();
            actions.close(tab);
          });
          tile.addEventListener('mousemove', () => {
            if (selected !== index) select(index);
          });
          return tile;
        }),
      );
      select(Math.min(selected, list.length - 1));
    };

    // Colonnes réellement affichées, pour monter et descendre d'une rangée.
    const columns = () => getComputedStyle(tiles).gridTemplateColumns.split(' ').filter(Boolean).length || 1;

    draw();

    return {
      element: card,
      next: (step = 1) => select(selected + step),
      down: (step = 1) => {
        const target = selected + step * columns();
        if (target >= 0 && target < list.length) select(target);
      },
      pick: () => list[selected] && actions.pick(list[selected]),
      remove: (tabId) => {
        list = list.filter((tab) => tab.id !== tabId);
        draw();
        return list.length;
      },
    };
  };

  return { CSS, build, favicon, picture, icon, t };
})();
