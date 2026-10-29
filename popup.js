const byId = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = { enabled: true, bottom: true };

// Alt+Q demandé à l'instant sur une page de Chrome : la bulle s'ouvre sur la grille.
const GRID_REQUEST_MS = 3000;

let settings = { ...DEFAULT_SETTINGS };

const save = () => chrome.storage.local.set({ settings });

const drawStatus = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const web = /^https?:\/\//.test(url);

  byId('enabled').checked = settings.enabled;
  byId('bottom').checked = settings.bottom;
  byId('helpBottom').hidden = !settings.bottom;
  byId('status').textContent = !settings.enabled ? 'Désactivé' : web ? 'Actif' : 'Page de Chrome : fenêtre normale';
};

// Le raccourci réellement attribué : Alt+Q par défaut, modifiable dans Chrome.
const drawShortcut = async () => {
  const command = (await chrome.commands.getAll()).find((item) => item.name === 'tab-grid');
  const help = byId('helpGrid');
  const key = document.createElement('b');
  if (command?.shortcut) {
    key.textContent = command.shortcut;
    help.replaceChildren(key, ' : tous vos onglets');
  } else {
    key.textContent = 'chrome://extensions/shortcuts';
    help.replaceChildren('Grille d’onglets sans raccourci : à choisir dans ', key);
  }
};

const drawTrouble = (trouble) => {
  byId('trouble').hidden = !trouble;
  byId('trouble').textContent = trouble ? `Souci : ${trouble}` : '';
};

const drawNote = (note) => {
  byId('note').hidden = !note;
  byId('note').textContent = note ? `Diagnostic : ${note}` : '';
};

byId('enabled').addEventListener('change', () => {
  settings.enabled = byId('enabled').checked;
  save().then(drawStatus);
});

byId('bottom').addEventListener('change', () => {
  settings.bottom = byId('bottom').checked;
  save().then(drawStatus);
});

// F11 change aussi l'interrupteur : la bulle suit, même ouverte.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.trouble) drawTrouble(changes.trouble.newValue);
  if (area === 'session' && changes.bottomNote) drawNote(changes.bottomNote.newValue);
  if (area === 'local' && changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    drawStatus();
  }
});

/* ---------- Grille d'Alt+Q ---------- */

let grid = null;

const hostOf = (tab) => {
  const url = tab.pendingUrl || tab.url || '';
  if (/^chrome:\/\/newtab\/?$/.test(url)) return 'Nouvel onglet';
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : url.replace(/\/$/, '');
  } catch {
    return '';
  }
};

const faviconUrl = (url) => {
  const src = new URL(chrome.runtime.getURL('/_favicon/'));
  src.searchParams.set('pageUrl', url);
  src.searchParams.set('size', '32');
  return src.href;
};

const showGrid = async () => {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const thumbs = await chrome.storage.session.get(tabs.map((tab) => `thumb:${tab.id}`));
  tabs.sort((a, b) => (b.id === current?.id) - (a.id === current?.id) || (b.lastAccessed || 0) - (a.lastAccessed || 0));

  const style = document.createElement('style');
  style.textContent = PleinGrid.CSS;
  document.head.append(style);
  document.body.classList.add('grid');
  byId('settings').hidden = true;
  byId('gridView').hidden = false;

  grid = PleinGrid.build(
    tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || hostOf(tab) || 'Nouvel onglet',
      host: hostOf(tab),
      pinned: tab.pinned,
      current: tab.id === current?.id,
      icon: faviconUrl(tab.url || tab.pendingUrl || ''),
      thumb: thumbs[`thumb:${tab.id}`] && `data:image/jpeg;base64,${thumbs[`thumb:${tab.id}`].data}`,
    })),
    {
      pick: async (tab) => {
        const target = await chrome.tabs.get(tab.id).catch(() => null);
        if (target) {
          await chrome.tabs.update(target.id, { active: true });
          await chrome.windows.update(target.windowId, { focused: true });
        }
        window.close();
      },
      close: async (tab) => {
        await chrome.tabs.remove(tab.id).catch(() => {});
        if (!grid.remove(tab.id)) window.close();
      },
    },
  );
  byId('gridView').append(grid.element);

  // Mêmes touches que dans les pages ; lâcher Alt ouvre l'onglet choisi.
  addEventListener('keydown', (event) => {
    const moves = {
      ArrowRight: () => grid.next(1),
      ArrowLeft: () => grid.next(-1),
      ArrowDown: () => grid.down(1),
      ArrowUp: () => grid.down(-1),
      Tab: () => grid.next(event.shiftKey ? -1 : 1),
      Enter: () => grid.pick(),
      Escape: () => window.close(),
    };
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'q' && event.altKey) grid.next(event.shiftKey ? -1 : 1);
    else moves[key]?.();
    event.preventDefault();
  });
  addEventListener('keyup', (event) => {
    if (event.key === 'Alt') {
      event.preventDefault();
      grid.pick();
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'grid-next') grid.next(1);
  });
};

(async () => {
  const { gridAt = 0, trouble, bottomNote } = await chrome.storage.session.get(['gridAt', 'trouble', 'bottomNote']);
  if (Date.now() - gridAt < GRID_REQUEST_MS) {
    await chrome.storage.session.remove('gridAt');
    return showGrid();
  }
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get('settings')).settings };
  drawTrouble(trouble);
  drawNote(bottomNote);
  drawShortcut();
  await drawStatus();
})();
