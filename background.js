// ===== Storage Helpers =====
const STORAGE_KEY = "savedTabs";

async function getSaved() {
  const obj = await browser.storage.local.get(STORAGE_KEY);
  return Array.isArray(obj[STORAGE_KEY]) ? obj[STORAGE_KEY] : [];
}

async function setSaved(list) {
  await browser.storage.local.set({ [STORAGE_KEY]: list });
}

// Nur schreiben, wenn sich wirklich etwas geändert hat → vermeidet Storage-Loops
async function setSavedIfChanged(next) {
  const prev = await getSaved();
  const same = JSON.stringify(prev) === JSON.stringify(next);
  if (!same) {
    await browser.storage.local.set({ [STORAGE_KEY]: next });
  }
}

// ===== Core Helpers =====
async function updateEntry(partial) {
  const list = await getSaved();
  const idx = list.findIndex(x => x.tabId === (partial.matchTabId ?? partial.tabId));
  if (idx >= 0) {
    const { matchTabId, ...rest } = partial;
    list[idx] = { ...list[idx], ...rest };
    await setSavedIfChanged(list);
  }
}

async function removeByTabId(tabId) {
  const list = await getSaved();
  const filtered = list.filter(x => x.tabId !== tabId);
  if (filtered.length !== list.length) {
    await setSavedIfChanged(filtered);
  }
}

async function addCurrentTab() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const list = await getSaved();
  if (list.some(x => x.tabId === activeTab.id && x.windowId === activeTab.windowId)) return;

  const entry = {
    tabId: activeTab.id,
    windowId: activeTab.windowId,
    url: activeTab.url,
    title: activeTab.title,
    favIconUrl: activeTab.favIconUrl,
    index: activeTab.index ?? 0,
    savedAt: Date.now(),
    autoRepointed: false
  };

  list.unshift(entry);
  await setSavedIfChanged(list);
}

async function focusSavedTab(tabId, windowId) {
  try {
    await browser.windows.update(windowId, { focused: true });
    await browser.tabs.update(tabId, { active: true });
  } catch {}
}

// ===== Tab Events =====

// Titel/Icon/URL aktuell halten, wenn wir ohnehin informiert werden
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!("title" in changeInfo) && !("favIconUrl" in changeInfo) && !("url" in changeInfo)) return;
  await updateEntry({ tabId, title: tab.title, favIconUrl: tab.favIconUrl, url: tab.url });
});

// Tab verschoben → Index aktualisieren
browser.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  await updateEntry({ tabId, index: moveInfo.toIndex });
});

// Beim Schließen: Einträge, die auf das Tab zeigen, auf den Nachfolger umbiegen
browser.tabs.onRemoved.addListener(async (closedTabId, removeInfo) => {
  const list = await getSaved();

  // alle betroffenen Einträge sammeln
  const affectedIdxs = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].tabId === closedTabId) affectedIdxs.push(i);
  }
  if (!affectedIdxs.length) return;

  // Fenster schließt komplett → Einträge entfernen
  if (removeInfo.isWindowClosing) {
    const filtered = list.filter(e => e.tabId !== closedTabId);
    await setSavedIfChanged(filtered);
    return;
  }

  const windowId = removeInfo.windowId ?? list[affectedIdxs[0]].windowId;
  let tabs = await browser.tabs.query({ windowId });
  tabs.sort((a, b) => a.index - b.index);

  const toRemove = [];
  for (const idx of affectedIdxs) {
    const entry = list[idx];
    const oldIndex = entry.index ?? 0;

    let replacement = tabs.find(t => t.index === oldIndex);
    if (!replacement && tabs.length) {
      replacement = tabs[Math.min(oldIndex, tabs.length - 1)];
    }

    if (!replacement) { toRemove.push(idx); continue; }

    // Live-Tab-Daten ziehen
    let live = replacement;
    try { live = await browser.tabs.get(replacement.id); } catch {}

    list[idx] = {
      ...entry,
      tabId: live.id,
      windowId: live.windowId,
      url: live.url,
      title: live.title,
      favIconUrl: live.favIconUrl,
      index: live.index,
      autoRepointed: true
    };
  }

  if (toRemove.length) {
    toRemove.sort((a, b) => b - a).forEach(i => list.splice(i, 1));
  }

  await setSavedIfChanged(list);
});

// ===== Messaging (keine Storage-Schreibvorgänge in GET_SAVED!) =====
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "ADD_CURRENT_TAB") {
    await addCurrentTab();
    return { ok: true };
  }

  if (msg?.type === "GET_SAVED") {
    const list = await getSaved();
    return { saved: list };
  }

  // Hydrierte (Live-)Daten für UI, ohne sie zu speichern
  if (msg?.type === "GET_SAVED_HYDRATED") {
    const list = await getSaved();
    const hydrated = await Promise.all(list.map(async (it) => {
      try {
        const t = await browser.tabs.get(it.tabId);
        return {
          ...it,
          title: t.title ?? it.title,
          url: t.url ?? it.url,
          favIconUrl: t.favIconUrl ?? it.favIconUrl,
          index: t.index ?? it.index
        };
      } catch {
        return it; // Tab existiert nicht mehr
      }
    }));
    return { saved: hydrated };
  }

  if (msg?.type === "FOCUS_TAB") {
    await focusSavedTab(msg.tabId, msg.windowId);
    return { ok: true };
  }

  if (msg?.type === "REMOVE_SAVED") {
    await removeByTabId(msg.tabId);
    return { ok: true };
  }

  if (msg?.type === "CLEAR_REPOINTED_FLAG") {
    await updateEntry({ tabId: msg.tabId, autoRepointed: false });
    return { ok: true };
  }
});