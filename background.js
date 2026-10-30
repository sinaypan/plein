// Plein : chaque fenêtre de Chrome reste en plein écran tant que la page affichée
// peut recevoir edges.js, qui ajoute les bords (barre d'onglets en haut, barre
// Windows en bas). Les pages de Chrome (nouvel onglet, paramètres), les pages
// d'erreur et les PDF n'acceptent pas ce script : la fenêtre y redevient normale,
// avec ses onglets et sa barre d'adresse.

const DEFAULT_SETTINGS = { enabled: true, bottom: true };

// Textes dans la langue de Chrome (_locales).
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

// Le Web Store refuse les scripts d'extension, comme les pages de Chrome.
const STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

// Après un changement demandé par Plein, Chrome peut signaler des tailles
// intermédiaires : on ne les prend pas pour un geste de l'utilisateur.
const SETTLE_MS = 1500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome refuse de toucher aux onglets tant qu'un bouton de la souris est
// enfoncé sur sa barre d'onglets (un clic ou un glisser en cours).
// On réessaie jusqu'à ce que le bouton soit relâché.
const BUSY = /cannot be edited right now/i;
const BUSY_MAX_MS = 20000;

const whenFree = async (job) => {
  const start = Date.now();
  for (;;) {
    try {
      return await job();
    } catch (error) {
      if (!BUSY.test(error?.message || '') || Date.now() - start > BUSY_MAX_MS) throw error;
      await wait(100);
    }
  }
};

// windows.update, lui, ne vérifie rien : passer en plein écran pendant un clic
// sur la barre d'onglets la fait disparaître avant que le bouton soit relâché,
// et Chrome croit ensuite qu'un glisser d'onglet dure toujours (plus aucun
// changement d'onglet possible). Déplacer l'onglet actif à sa propre place est
// refusé tant que le bouton est enfoncé : ce test dit quand la voie est libre.
const stripFree = (windowId) =>
  whenFree(async () => {
    const [tab] = await chrome.tabs.query({ windowId, active: true });
    if (!tab) return;
    try {
      await chrome.tabs.move(tab.id, { index: tab.index });
    } catch (error) {
      if (BUSY.test(error?.message || '')) throw error; // autre refus : le test ne dit rien, on continue
    }
  });

/* ---------- État ---------- */

// Gardé dans storage.session : le service worker peut s'arrêter à tout moment.
//   expected : l'état que Plein a demandé pour chaque fenêtre
//   revealed : fenêtres réduites pour montrer la barre Windows
//   noDraw   : onglets http où edges.js ne tourne pas (PDF, page d'erreur)
let memory = null;
const changedAt = {};

const state = async () => {
  if (!memory) {
    const stored = await chrome.storage.session.get(['expected', 'revealed', 'noDraw']);
    memory = { expected: {}, revealed: {}, noDraw: {}, ...stored };
  }
  return memory;
};

const save = () => chrome.storage.session.set(memory);

const settings = async () => ({ ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get('settings')).settings });

// Un souci est gardé pour la bulle de l'icône, qui l'affiche tel quel.
const report = (error) => {
  console.error(error);
  chrome.storage.session.set({ trouble: `${new Date().toLocaleTimeString(chrome.i18n.getUILanguage())} · ${error?.message || error}` });
};

// Les changements de fenêtre passent l'un après l'autre : deux événements
// rapprochés (changement d'onglet puis chargement) ne doivent pas se croiser.
let queue = Promise.resolve();
const serial = (job) => (queue = queue.then(job).catch(report));

/* ---------- Plein écran ---------- */

const drawable = (tab, memo) => {
  const url = tab.pendingUrl || tab.url || '';
  return /^https?:\/\//.test(url) && !STORE.test(url) && !memo.noDraw[tab.id];
};

const setState = async (windowId, wanted) => {
  const memo = await state();
  memo.expected[windowId] = wanted;
  await save();
  for (let tries = 0; tries < 4; tries++) {
    await stripFree(windowId);
    await whenFree(() => {
      changedAt[windowId] = Date.now();
      return chrome.windows.update(windowId, { state: wanted });
    });
    changedAt[windowId] = Date.now();
    if ((await chrome.windows.get(windowId)).state === wanted) return;
    await wait(250);
  }
  throw new Error(t('windowRefused', t(wanted === 'fullscreen' ? 'modeFullscreen' : 'modeNormal')));
};

const applyNow = async (windowId) => {
  const memo = await state();
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (!win || win.type !== 'normal' || win.state === 'minimized') return;
  if (!(await settings()).enabled) return;
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  const wanted = tab && !memo.revealed[windowId] && drawable(tab, memo) ? 'fullscreen' : 'maximized';
  if (win.state === wanted) {
    if (memo.expected[windowId] !== wanted) {
      memo.expected[windowId] = wanted;
      await save();
    }
    return;
  }
  await setState(windowId, wanted);
};

const apply = (windowId) => serial(() => applyNow(windowId));

// keepFullscreen : Plein vient d'être activé par F11, peut-être sur une page de
// Chrome ; on ne défait pas ce geste.
const applyAll = ({ keepFullscreen = false } = {}) =>
  serial(async () => {
    for (const win of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
      if (!(keepFullscreen && win.state === 'fullscreen')) await applyNow(win.id);
    }
  });

// Plein désactivé : les fenêtres qu'il avait mises en plein écran en sortent.
const releaseAll = () =>
  serial(async () => {
    const memo = await state();
    for (const win of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
      if (memo.expected[win.id] && win.state === 'fullscreen') {
        await whenFree(() => {
          changedAt[win.id] = Date.now();
          return chrome.windows.update(win.id, { state: 'maximized' });
        });
      }
    }
    Object.assign(memo, { expected: {}, revealed: {} });
    await save();
  });

// La taille a changé sans que Plein l'ait demandé : c'est l'utilisateur.
// L'interrupteur suit son geste : sortir du plein écran (F11, menu de Chrome)
// désactive Plein, y entrer l'active.
const onBounds = (windowId) =>
  serial(async () => {
    if (Date.now() - (changedAt[windowId] || 0) < SETTLE_MS) return;
    const memo = await state();
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (!win || win.type !== 'normal' || win.state === 'minimized') return;
    const current = await settings();
    if (win.state === 'fullscreen') {
      delete memo.revealed[windowId];
      memo.expected[windowId] = 'fullscreen';
      await save();
      if (!current.enabled) await chrome.storage.local.set({ settings: { ...current, enabled: true } });
    } else if (memo.expected[windowId] === 'fullscreen' && current.enabled) {
      // Chrome rend la taille d'avant le plein écran, souvent un peu plus petite
      // que l'écran : la fenêtre ressort agrandie à la place.
      if (win.state === 'normal') {
        await whenFree(() => {
          changedAt[windowId] = Date.now();
          return chrome.windows.update(windowId, { state: 'maximized' });
        });
      }
      memo.expected[windowId] = 'maximized';
      await save();
      await chrome.storage.local.set({ settings: { ...current, enabled: false } });
    }
  });

/* ---------- Barre Windows en bas ---------- */

const reveal = (windowId) =>
  serial(async () => {
    const memo = await state();
    const { enabled, bottom } = await settings();
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (!enabled || !bottom || win?.state !== 'fullscreen') return false;
    // away : Chrome a perdu le focus depuis (passage par une autre application).
    memo.revealed[windowId] = { at: Date.now(), away: false };
    await save();
    await setState(windowId, 'maximized');
    return true;
  });

const CAUSES = { mouse: 'causeMouse', focus: 'causeFocus' };

// Diagnostic : une barre Windows refermée presque aussitôt est notée pour la bulle de l'icône.
const note = (shown, cause) => {
  const ms = Date.now() - (shown?.at || 0);
  if (ms < 1500) chrome.storage.session.set({ bottomNote: `${new Date().toLocaleTimeString(chrome.i18n.getUILanguage())} · ${t('bottomClosed', ms, t(CAUSES[cause]))}` });
};

const unreveal = (windowId, cause) =>
  serial(async () => {
    const memo = await state();
    const shown = memo.revealed[windowId];
    if (!shown || (cause === 'focus' && !shown.away)) return false;
    note(shown, cause);
    delete memo.revealed[windowId];
    await save();
    await applyNow(windowId);
    return true;
  });

// Le focus quitte une fenêtre révélée : l'utilisateur est passé ailleurs.
// Un simple déplacement du focus dans Chrome (vers sa barre d'adresse)
// ne compte pas : seul le retour après être parti remet le plein écran.
const onFocus = (windowId) =>
  serial(async () => {
    const memo = await state();
    let changed = false;
    for (const [id, shown] of Object.entries(memo.revealed)) {
      if (Number(id) !== windowId && !shown.away) {
        shown.away = true;
        changed = true;
      }
    }
    if (changed) await save();
  }).then(() => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) unreveal(windowId, 'focus');
  });

/* ---------- Barre d'onglets en haut ---------- */

// L'icône du site est lue ici et envoyée en données à la page : celle-ci n'a
// aucune adresse d'extension à charger, et aucun site ne peut interroger les
// icônes de l'extension.
const icons = new Map();
const faviconOf = async (url) => {
  if (icons.has(url)) return icons.get(url);
  try {
    const response = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const icon = { type: response.headers.get('content-type') || 'image/png', data: btoa(String.fromCharCode(...bytes)) };
    if (icons.size > 300) icons.clear();
    icons.set(url, icon);
    return icon;
  } catch {
    return null;
  }
};

const titleOf = (tab) => {
  if (tab.title) return tab.title;
  try {
    return new URL(tab.pendingUrl || tab.url).hostname || t('newTab');
  } catch {
    return t('newTab');
  }
};

// La page ne reçoit que ce qu'elle affiche : titre, icône, identifiant. Pas d'adresse.
const tabsOf = async (windowId) => {
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (win?.state !== 'fullscreen') return null;
  const tabs = await chrome.tabs.query({ windowId });
  return Promise.all(
    tabs.map(async (tab) => ({
      id: tab.id,
      title: titleOf(tab),
      active: tab.active,
      pinned: tab.pinned,
      icon: await faviconOf(tab.url || tab.pendingUrl || ''),
    })),
  );
};

// Un onglet désigné par la page doit être dans la fenêtre de cette page.
const ownTab = async (tabId, windowId) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return tab?.windowId === windowId ? tab : null;
};

// Ce qui est écrit dans l'adresse d'un onglet : une adresse, sinon null (une recherche).
// Les autres schémas (javascript:, data:) ne passent pas.
const addressOf = (text) => {
  const value = text.trim();
  let address = null;
  if (/^(https?|file|chrome|about):/i.test(value)) address = value;
  else if (/^localhost(:\d+)?([/?#]|$)/i.test(value)) address = `http://${value}`;
  else if (/^([^\s/?#:]+\.\p{L}[\p{L}\d-]+|\d+\.\d+\.\d+\.\d+)(:\d+)?([/?#]\S*)?$/iu.test(value)) address = `https://${value}`;
  try {
    return address && new URL(address).href;
  } catch {
    return null;
  }
};

// Les favoris que la barre sait ouvrir : pas les bookmarklets (javascript:).
const BOOKMARK_LINK = /^(https?|file|chrome):/i;

// La barre de favoris ; Chrome en a deux quand une partie est gardée dans le compte Google.
const bookmarksBar = async () => {
  const [root] = await chrome.bookmarks.getTree();
  const bars = root.children.filter((node) => node.folderType === 'bookmarks-bar');
  return (bars.length ? bars : root.children.slice(0, 1)).flatMap((node) => node.children || []);
};

const bookmarkItems = (nodes) =>
  Promise.all(
    nodes
      .filter((node) => !node.url || BOOKMARK_LINK.test(node.url))
      .map(async (node) => ({
        id: node.id,
        title: node.title,
        folder: !node.url,
        host: node.url ? URL.parse(node.url)?.hostname || '' : '',
        icon: node.url ? await faviconOf(node.url) : null,
      })),
  );

/* ---------- Aperçus des onglets ---------- */

// Chrome ne photographie que l'onglet affiché : chaque onglet garde l'image de
// la dernière fois qu'il a été vu. Les images, réduites, restent dans
// storage.session (vidé à la fermeture de Chrome, illisible pour les pages) et
// sont effacées avec leur onglet.
const THUMB_WIDTH = 400;
const CAPTURE_GAP_MS = 550; // Chrome accepte au plus deux captures par seconde
const thumbKey = (tabId) => `thumb:${tabId}`;

let lastCapture = 0;
let captures = Promise.resolve();

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const shrink = async (dataUrl) => {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const height = Math.round((bitmap.height * THUMB_WIDTH) / bitmap.width);
  const canvas = new OffscreenCanvas(THUMB_WIDTH, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, THUMB_WIDTH, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  return { type: 'image/jpeg', data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
};

// Photo de l'onglet tabId s'il est toujours celui affiché dans sa fenêtre.
// Les pages de Chrome ne se laissent pas photographier : elles gardent leur icône.
const capture = (windowId, tabId) =>
  (captures = captures
    .then(async () => {
      const gap = lastCapture + CAPTURE_GAP_MS - Date.now();
      if (gap > 0) await wait(gap);
      const [shown] = await chrome.tabs.query({ windowId, active: true });
      if (shown?.id !== tabId || !/^https?:\/\//.test(shown.url || '') || STORE.test(shown.url)) return;
      if ((await chrome.windows.get(windowId)).state === 'minimized') return;
      // La page range la barre de Plein avant la photo (false : grille ouverte, pas de photo).
      const ready = await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'quiet' }).catch(() => true), wait(300).then(() => true)]);
      if (ready === false) return;
      lastCapture = Date.now();
      const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
      const [still] = await chrome.tabs.query({ windowId, active: true });
      if (still?.id !== tabId) return; // l'onglet a changé pendant la photo
      await chrome.storage.session.set({ [thumbKey(tabId)]: { at: Date.now(), ...(await shrink(shot)) } });
    })
    .catch(() => {}));

// Un peu après l'arrivée sur l'onglet, le temps que la page soit dessinée.
const captureSoon = (windowId, tabId, delay) => setTimeout(() => capture(windowId, tabId), delay);

/* ---------- Grille d'onglets (Alt+Q) ---------- */

const hostOf = (tab) => {
  const url = tab.pendingUrl || tab.url || '';
  if (/^chrome:\/\/newtab\/?$/.test(url)) return t('newTab');
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : url.replace(/\/$/, '');
  } catch {
    return '';
  }
};

// Tous les onglets de toutes les fenêtres, du plus récemment vu au plus ancien,
// celui qui est affiché en premier. Comme pour la barre : titre, site, icône, pas d'adresse.
const gridTabs = async (current) => {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  tabs.sort((a, b) => (b.id === current?.id) - (a.id === current?.id) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const memo = await state();
  memo.gridIds = tabs.map((tab) => tab.id);
  await save();
  const thumbs = await chrome.storage.session.get(tabs.map((tab) => thumbKey(tab.id)));
  return Promise.all(
    tabs.map(async (tab) => {
      const thumb = thumbs[thumbKey(tab.id)];
      return {
        id: tab.id,
        title: titleOf(tab),
        host: hostOf(tab),
        pinned: tab.pinned,
        current: tab.id === current?.id,
        icon: await faviconOf(tab.url || tab.pendingUrl || ''),
        thumb: thumb && { type: thumb.type, data: thumb.data },
      };
    }),
  );
};

const tellTab = (tab, message) => chrome.tabs.sendMessage(tab.id, message).catch(() => false);

const showGrid = async (tab) => {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  // Bulle déjà ouverte sur sa grille : Alt+Q y avance.
  if ((await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length) {
    return chrome.runtime.sendMessage({ type: 'grid-next' }).catch(() => {});
  }
  if (!tab) return;
  if (await tellTab(tab, { type: 'grid-next' })) return;
  // L'onglet affiché vient d'être vu : sa photo est remise à jour avant d'ouvrir,
  // sauf si Chrome ferait attendre (photo prise il y a moins d'une demi-seconde).
  if (Date.now() - lastCapture > CAPTURE_GAP_MS) await Promise.race([capture(tab.windowId, tab.id), wait(300)]);
  if (await tellTab(tab, { type: 'grid', tabs: await gridTabs(tab) })) return;
  // Page où rien ne peut être dessiné (paramètres de Chrome…) : la grille s'ouvre dans la bulle.
  await chrome.storage.session.set({ gridAt: Date.now() });
  await chrome.action.openPopup();
};

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'tab-grid') showGrid(tab).catch(report);
});

// Un onglet choisi dans la grille doit faire partie de la dernière liste envoyée.
const gridTab = async (tabId) => {
  if (!(await state()).gridIds?.includes(tabId)) return null;
  return chrome.tabs.get(tabId).catch(() => null);
};

/* ---------- Messages de edges.js ---------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tab = sender.tab;
  if (!tab || sender.id !== chrome.runtime.id) return;
  const windowId = tab.windowId;

  const answer = (job) => {
    job()
      .then(sendResponse, (error) => {
        report(error);
        sendResponse(null);
      });
    return true;
  };

  switch (message?.type) {
    case 'hello':
      return answer(async () => {
        const memo = await state();
        const pdf = message.pdf === true;
        if (!!memo.noDraw[tab.id] !== pdf) {
          if (pdf) memo.noDraw[tab.id] = true;
          else delete memo.noDraw[tab.id];
          await save();
          if (tab.active) apply(windowId);
        }
        return true;
      });
    case 'bottom':
      return answer(() => reveal(windowId));
    case 'restore':
      return answer(() => unreveal(windowId, 'mouse'));
    case 'tabs':
      return answer(() => tabsOf(windowId));
    case 'activate':
      return answer(async () => {
        if (await ownTab(message.tabId, windowId)) await whenFree(() => chrome.tabs.update(message.tabId, { active: true }));
        return true;
      });
    case 'close':
      return answer(async () => {
        if (await ownTab(message.tabId, windowId)) await whenFree(() => chrome.tabs.remove(message.tabId));
        return tabsOf(windowId);
      });
    case 'tab-url':
      return answer(async () => {
        const target = await ownTab(message.tabId, windowId);
        return target ? target.pendingUrl || target.url || '' : null;
      });
    case 'go':
      return answer(async () => {
        const text = String(message.text ?? '');
        if (!text.trim() || !(await ownTab(message.tabId, windowId))) return false;
        const url = addressOf(text);
        await whenFree(() => chrome.tabs.update(message.tabId, url ? { url, active: true } : { active: true }));
        if (!url) await chrome.search.query({ text: text.trim(), tabId: message.tabId });
        return true;
      });
    case 'bookmarks':
      return answer(async () => bookmarkItems(message.id ? await chrome.bookmarks.getChildren(String(message.id)) : await bookmarksBar()));
    case 'open-bookmark':
      return answer(async () => {
        const [node] = await chrome.bookmarks.get(String(message.id)).catch(() => []);
        if (!node?.url || !BOOKMARK_LINK.test(node.url)) return false;
        await whenFree(() =>
          message.newTab
            ? chrome.tabs.create({ windowId, url: node.url, index: tab.index + 1, active: false })
            : chrome.tabs.update(tab.id, { url: node.url }),
        );
        return true;
      });
    case 'new':
      return answer(async () => {
        await whenFree(() => chrome.tabs.create({ windowId }));
        return true;
      });
    case 'switch':
      return answer(async () => {
        const target = await gridTab(message.tabId);
        if (!target) return false;
        await whenFree(() => chrome.tabs.update(target.id, { active: true }));
        if (target.windowId !== windowId) await whenFree(() => chrome.windows.update(target.windowId, { focused: true }));
        return true;
      });
    case 'grid-close':
      return answer(async () => {
        const target = await gridTab(message.tabId);
        if (!target) return false;
        await whenFree(() => chrome.tabs.remove(target.id));
        return true;
      });
  }
});

/* ---------- Événements de Chrome ---------- */

// Une page http sans edges.js (page d'erreur, script refusé) : la fenêtre doit
// redevenir normale, sinon on n'aurait plus aucun moyen de changer d'onglet.
const check = async (tabId) => {
  for (const delay of [0, 600]) {
    await wait(delay);
    const alive = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => false);
    if (alive) return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !/^https?:\/\//.test(tab.url || '') || STORE.test(tab.url)) return;
  const memo = await state();
  memo.noDraw[tabId] = true;
  await save();
  if (tab.active) apply(tab.windowId);
};

chrome.tabs.onActivated.addListener(({ windowId, tabId }) => {
  apply(windowId);
  captureSoon(windowId, tabId, 400);
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.url) {
    const memo = await state();
    if (memo.noDraw[tabId]) {
      delete memo.noDraw[tabId];
      await save();
    }
    if (tab.active) apply(tab.windowId);
  }
  if (change.status === 'complete' && tab.active && /^https?:\/\//.test(tab.url || '')) {
    check(tabId).catch(report);
    captureSoon(tab.windowId, tabId, 300);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  chrome.storage.session.remove(thumbKey(tabId));
  const memo = await state();
  if (memo.noDraw[tabId]) {
    delete memo.noDraw[tabId];
    await save();
  }
});

// Deux temps : une fenêtre créée directement en plein écran peut garder sa barre de favoris.
chrome.windows.onCreated.addListener((win) => {
  if (win.type === 'normal') apply(win.id);
}, { windowTypes: ['normal'] });

chrome.windows.onRemoved.addListener(async (windowId) => {
  const memo = await state();
  for (const key of ['expected', 'revealed']) delete memo[key][windowId];
  delete changedAt[windowId];
  await save();
});

chrome.windows.onBoundsChanged.addListener((win) => onBounds(win.id));

// Retour sur Chrome après être passé par la barre Windows : plein écran de nouveau.
chrome.windows.onFocusChanged.addListener(onFocus);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = { ...DEFAULT_SETTINGS, ...changes.settings.oldValue };
  const after = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  if (before.enabled && !after.enabled) releaseAll();
  else if (after.enabled) applyAll({ keepFullscreen: !before.enabled });
});

// Les onglets ouverts avant l'installation n'ont pas encore edges.js.
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (tab.discarded || STORE.test(tab.url)) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['grid.js', 'edges.js'] }).catch(() => {});
  }
  applyAll();
});

chrome.runtime.onStartup.addListener(() => applyAll());
