const listEl = document.getElementById("list");
const saveBtn = document.getElementById("saveBtn");
const emptyEl = document.getElementById("empty");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") node.appendChild(document.createTextNode(c));
    else if (c) node.appendChild(c);
  }
  return node;
}

async function fetchSavedHydrated() {
  const res = await browser.runtime.sendMessage({ type: "GET_SAVED_HYDRATED" });
  return res?.saved ?? [];
}

function renderList(items) {
  listEl.innerHTML = "";
  if (!items.length) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  items.forEach(item => {
    const fav = el("img", { class: "fav", src: item.favIconUrl || "", alt: "" });
    const title = el("div", { class: "title", onclick: () => focus(item) }, item.title || "(no title)");
    const url = el("div", { class: "url" }, item.url || "");
    // <<< Wrapper mit class "text" → greift CSS oben >>>
    const textWrap = el("div", { class: "text" }, title, url);
    const removeBtn = el("button", { class: "remove", title: "Remove", onclick: () => remove(item) }, "✕");
    const li = el("li", { class: "item" + (item.autoRepointed ? " repointed" : "") }, fav, textWrap, removeBtn);
    listEl.appendChild(li);
  });
}

async function reload() {
  const items = await fetchSavedHydrated();
  renderList(items);
}

async function focus(item) {
  await browser.runtime.sendMessage({ type: "FOCUS_TAB", tabId: item.tabId, windowId: item.windowId });
  await browser.runtime.sendMessage({ type: "CLEAR_REPOINTED_FLAG", tabId: item.tabId });
  window.close();
}

async function remove(item) {
  await browser.runtime.sendMessage({ type: "REMOVE_SAVED", tabId: item.tabId });
  await reload();
}

saveBtn.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "ADD_CURRENT_TAB" });
  await reload();
});

reload();