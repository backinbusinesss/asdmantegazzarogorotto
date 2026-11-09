(() => {
  "use strict";

  const API = "https://mr-admin.ulivinic.workers.dev";
  const TOKEN_KEY = "mr-admin-token";
  const MAX_SIDE = 1600;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => Math.random().toString(36).slice(2, 10);

  const LABELS = { players: "Rosa", news: "News", gallery: "Foto", club: "Contatti" };
  const state = {
    token: null,
    user: null,
    tab: "players",
    saved: {},     // ultima versione salvata
    data: {},      // versione che si sta modificando
    previews: {},  // anteprime locali delle immagini appena caricate
  };

  /* ---------- sessione ---------- */
  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(t, remember) {
      try { (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t); } catch { /* storage non disponibile */ }
    },
    clear() { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch { /* */ } },
  };

  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(opts.headers || {}) },
      });
    } catch {
      throw new Error("Connessione assente. Controlla internet e riprova.");
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/login") {
      logout("Sessione scaduta: accedi di nuovo.");
      throw new Error(body.error || "Sessione scaduta.");
    }
    if (!res.ok) throw new Error(body.error || `Errore ${res.status}`);
    return body;
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("is-on"), 3600);
  }

  /* ---------- login ---------- */
  $("pwToggle").addEventListener("click", () => {
    const pw = $("password");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    $("pwToggle").textContent = show ? "Nascondi" : "Mostra";
    $("pwToggle").setAttribute("aria-pressed", String(show));
    $("pwToggle").setAttribute("aria-label", show ? "Nascondi password" : "Mostra password");
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("loginError");
    err.hidden = true;
    const username = $("username").value.trim();
    const password = $("password").value;
    if (!username || !password) {
      err.textContent = "Inserisci nome utente e password.";
      err.hidden = false;
      (username ? $("password") : $("username")).focus();
      return;
    }
    const btn = $("loginBtn");
    btn.disabled = true;
    btn.textContent = "Accesso in corso…";
    try {
      const r = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
      state.token = r.token;
      state.user = r.user;
      store.set(r.token, $("remember").checked);
      $("password").value = "";
      await openApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      $("password").select();
    } finally {
      btn.disabled = false;
      btn.textContent = "Accedi";
    }
  });

  function logout(msg) {
    store.clear();
    state.token = null;
    $("appView").hidden = true;
    $("loginView").hidden = false;
    if (msg) { $("loginError").textContent = msg; $("loginError").hidden = false; }
    $("username").focus();
  }
  $("logoutBtn").addEventListener("click", () => {
    if (anyDirty() && !confirm("Hai modifiche non salvate. Uscire lo stesso?")) return;
    logout();
  });

  async function openApp() {
    $("loginView").hidden = true;
    $("appView").hidden = false;
    $("whoami").textContent = `(${state.user})`;
    $("loading").hidden = false;
    document.querySelectorAll(".panel").forEach((p) => { p.dataset.wasHidden = p.hidden; p.hidden = true; });
    try {
      const content = await api("/content");
      state.saved = {
        players: Array.isArray(content.players) ? content.players : [],
        news: Array.isArray(content.news) ? content.news : [],
        gallery: Array.isArray(content.gallery) ? content.gallery : [],
        club: content.club && typeof content.club === "object" ? content.club : {},
      };
      for (const k of ["players", "news", "gallery"]) state.saved[k].forEach((x) => { x._id = x._id || uid(); });
      state.data = clone(state.saved);
      $("loading").hidden = true;
      showTab(state.tab);
      renderAll();
    } catch (ex) {
      $("loading").textContent = ex.message;
    }
  }

  /* ---------- schede ---------- */
  const tabs = [...document.querySelectorAll(".tabs [role=tab]")];
  function showTab(name) {
    state.tab = name;
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
    updateSaveBar();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => showTab(t.dataset.tab));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const n = tabs[(i + d + tabs.length) % tabs.length];
      n.focus();
      showTab(n.dataset.tab);
    });
  });

  /* ---------- stato modifiche ---------- */
  const strip = (v) => JSON.stringify(v, (k, val) => (k === "_id" ? undefined : val));
  const isDirty = (k) => strip(state.data[k]) !== strip(state.saved[k]);
  const anyDirty = () => Object.keys(LABELS).some(isDirty);

  function updateSaveBar() {
    const dirty = Object.keys(LABELS).filter(isDirty);
    const bar = $("saveBar");
    if (bar.dataset.state !== "saving") bar.dataset.state = dirty.length ? "dirty" : "clean";
    $("saveStatus").textContent = dirty.length
      ? `Modifiche non salvate: ${dirty.map((k) => LABELS[k]).join(", ")}.`
      : "Nessuna modifica da salvare.";
    $("saveBtn").disabled = !dirty.length || bar.dataset.state === "saving";
    $("discardBtn").disabled = !dirty.length || bar.dataset.state === "saving";
    tabs.forEach((t) => {
      const has = isDirty(t.dataset.tab);
      let dot = t.querySelector(".dot");
      if (has && !dot) { dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-label", "modifiche non salvate"); t.appendChild(dot); }
      if (!has && dot) dot.remove();
    });
  }

  window.addEventListener("beforeunload", (e) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ""; } });

  $("discardBtn").addEventListener("click", () => {
    if (!confirm("Annullare tutte le modifiche non salvate?")) return;
    state.data = clone(state.saved);
    renderAll();
  });

  $("saveBtn").addEventListener("click", async () => {
    const dirty = Object.keys(LABELS).filter(isDirty);
    if (!dirty.length) return;
    const problem = check(dirty);
    if (problem) { toast(problem); return; }
    const bar = $("saveBar");
    bar.dataset.state = "saving";
    $("saveStatus").textContent = "Salvataggio in corso…";
    $("saveBtn").disabled = true;
    $("discardBtn").disabled = true;
    try {
      for (const k of dirty) {
        const payload = clean(k, state.data[k]);
        await api(`/content/${k}`, { method: "PUT", body: JSON.stringify(payload) });
        const removed = imagesOf(state.saved[k]).filter((p) => !imagesOf(state.data[k]).includes(p));
        state.saved[k] = clone(state.data[k]);
        for (const p of removed) if (!allImages().includes(p)) api(`/upload?path=${encodeURIComponent(p)}`, { method: "DELETE" }).catch(() => {});
      }
      bar.dataset.state = "clean";
      updateSaveBar();
      toast("Salvato. Sul sito tra circa un minuto.");
    } catch (ex) {
      bar.dataset.state = "dirty";
      updateSaveBar();
      toast(`Non salvato: ${ex.message}`);
    }
  });

  function check(keys) {
    if (keys.includes("players")) {
      const p = state.data.players.find((x) => !x.name.trim());
      if (p) { showTab("players"); return "Ogni giocatore deve avere un nome."; }
      const nums = state.data.players.map((x) => x.number).filter((n) => n !== null && n !== "");
      if (new Set(nums).size !== nums.length) { showTab("players"); return "Due giocatori hanno lo stesso numero di maglia."; }
    }
    if (keys.includes("club")) {
      const e = state.data.club.email;
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { showTab("club"); return "L'indirizzo email non è valido."; }
    }
    return null;
  }

  function clean(k, v) {
    if (k === "club") return v;
    return v.map(({ _id, ...rest }) => rest);
  }

  const imagesOf = (v) => (Array.isArray(v) ? v.map((x) => x.photo || x.image || x.src).filter(Boolean) : []);
  const allImages = () => [...imagesOf(state.data.players), ...imagesOf(state.data.news), ...imagesOf(state.data.gallery)];

  /* ---------- immagini ---------- */
  const imgUrl = (path) => state.previews[path] || `../${path}`;

  async function prepareImage(file) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error("Questo formato di immagine non è supportato. Usa JPG o PNG.");
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  }

  async function upload(file) {
    const { dataUrl, base64 } = await prepareImage(file);
    const r = await api("/upload", { method: "POST", body: JSON.stringify({ name: file.name, type: "image/jpeg", data: base64 }) });
    state.previews[r.path] = dataUrl;
    return r.path;
  }

  function avatarHTML(path, label) {
    return `${path ? `<img src="${esc(imgUrl(path))}" alt="">` : `<span>${label}</span>`}
      <input type="file" accept="image/*" aria-label="${path ? "Cambia foto" : "Aggiungi foto"}">`;
  }

  function bindAvatar(el, getPath, setPath, label) {
    el.querySelector("input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      el.classList.add("is-busy");
      try {
        const path = await upload(file);
        setPath(path);
        el.innerHTML = avatarHTML(path, label);
        bindAvatar(el, getPath, setPath, label);
        updateSaveBar();
      } catch (ex) {
        toast(ex.message);
      } finally {
        el.classList.remove("is-busy");
      }
    });
  }

  /* ---------- rosa ---------- */
  const TRASH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;
  const ROLES = ["", "Palleggiatore", "Palleggiatrice", "Schiacciatore", "Schiacciatrice", "Opposto", "Centrale", "Libero", "Allenatore", "Allenatrice"];

  function renderPlayers() {
    const list = $("playersList");
    const players = state.data.players;
    $("playersEmpty").hidden = players.length > 0;
    list.innerHTML = players.map((p) => `
      <li class="row" data-id="${p._id}">
        <label class="avatar" title="Foto">${avatarHTML(p.photo, "Foto")}</label>
        <label class="field f-num"><span>Numero</span><input type="number" inputmode="numeric" min="0" max="99" data-k="number" value="${p.number ?? ""}"></label>
        <label class="field f-name"><span>Nome e cognome</span><input type="text" maxlength="80" data-k="name" value="${esc(p.name)}" placeholder="Es. Giulia Rossi"></label>
        <label class="field f-role"><span>Ruolo</span>
          <select data-k="role">${ROLES.map((r) => `<option value="${r}" ${r === (p.role || "") ? "selected" : ""}>${r || "Nessun ruolo"}</option>`).join("")}
            ${p.role && !ROLES.includes(p.role) ? `<option selected>${esc(p.role)}</option>` : ""}</select></label>
        <label class="check"><input type="checkbox" data-k="captain" ${p.captain ? "checked" : ""}>Capitano</label>
        <button type="button" class="row__remove" aria-label="Rimuovi ${esc(p.name || "giocatore")}">${TRASH}</button>
      </li>`).join("");

    list.querySelectorAll(".row").forEach((row) => {
      const p = players.find((x) => x._id === row.dataset.id);
      row.querySelectorAll("[data-k]").forEach((input) => {
        input.addEventListener("input", () => {
          const k = input.dataset.k;
          if (k === "captain") {
            if (input.checked) players.forEach((x) => { x.captain = x === p; });
            else p.captain = false;
            list.querySelectorAll('[data-k="captain"]').forEach((c) => { c.checked = players.find((x) => x._id === c.closest(".row").dataset.id).captain; });
          } else if (k === "number") {
            p.number = input.value === "" ? null : Math.max(0, Math.min(99, parseInt(input.value, 10) || 0));
          } else {
            p[k] = input.value;
          }
          updateSaveBar();
        });
      });
      bindAvatar(row.querySelector(".avatar"), () => p.photo, (v) => { p.photo = v; }, "Foto");
      row.querySelector(".row__remove").addEventListener("click", () => {
        if (!confirm(`Rimuovere ${p.name || "questo giocatore"} dalla rosa?`)) return;
        state.data.players = players.filter((x) => x !== p);
        renderPlayers();
        updateSaveBar();
      });
    });
  }

  $("addPlayer").addEventListener("click", () => {
    state.data.players.push({ _id: uid(), name: "", number: null, role: "", captain: false, photo: "" });
    renderPlayers();
    updateSaveBar();
    const rows = $("playersList").querySelectorAll(".row");
    rows[rows.length - 1].querySelector('[data-k="name"]').focus();
  });

  /* ---------- news ---------- */
  const fmtDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });

  function renderNews() {
    const list = $("newsList");
    const news = state.data.news.slice().sort((a, b) => b.date.localeCompare(a.date));
    $("newsEmpty").hidden = news.length > 0;
    list.innerHTML = news.map((n) => `
      <li class="news-item" data-id="${n._id}">
        ${n.image ? `<img class="news-item__img" src="${esc(imgUrl(n.image))}" alt="">` : `<div class="news-item__img"></div>`}
        <div>
          <h3>${esc(n.title)}</h3>
          <p>${esc(fmtDate.format(new Date(n.date + "T12:00:00")))}${n.text ? `: ${esc(n.text)}` : ""}</p>
        </div>
        <div class="news-item__btns">
          <button type="button" class="btn btn--ghost btn--sm" data-act="edit">Modifica</button>
          <button type="button" class="btn btn--danger btn--sm" data-act="del">Elimina</button>
        </div>
      </li>`).join("");
    list.querySelectorAll(".news-item").forEach((li) => {
      const n = state.data.news.find((x) => x._id === li.dataset.id);
      li.querySelector('[data-act="edit"]').addEventListener("click", () => openNews(n));
      li.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (!confirm(`Eliminare la news "${n.title}"?`)) return;
        state.data.news = state.data.news.filter((x) => x !== n);
        renderNews();
        updateSaveBar();
      });
    });
  }

  let editingNews = null;
  let newsDraftImage = "";
  function openNews(n) {
    editingNews = n || null;
    const f = $("newsForm");
    $("newsDialogTitle").textContent = n ? "Modifica news" : "Nuova news";
    f.title.value = n ? n.title : "";
    f.date.value = n ? n.date : new Date().toISOString().slice(0, 10);
    f.text.value = n ? n.text || "" : "";
    newsDraftImage = n ? n.image || "" : "";
    renderNewsImg();
    $("newsError").hidden = true;
    $("newsDialog").showModal();
    f.title.focus();
  }
  function renderNewsImg() {
    const box = $("newsImgPick");
    box.innerHTML = `<label class="avatar">${avatarHTML(newsDraftImage, "Aggiungi foto")}</label>
      ${newsDraftImage ? `<button type="button" class="btn btn--danger btn--sm" id="newsImgRemove">Togli foto</button>` : ""}`;
    bindAvatar(box.querySelector(".avatar"), () => newsDraftImage, (v) => { newsDraftImage = v; renderNewsImg(); }, "Aggiungi foto");
    const rm = $("newsImgRemove");
    if (rm) rm.addEventListener("click", () => { newsDraftImage = ""; renderNewsImg(); });
  }
  $("addNews").addEventListener("click", () => openNews(null));
  $("newsCancel").addEventListener("click", () => $("newsDialog").close());
  $("newsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    if (!title || !f.date.value) {
      $("newsError").textContent = "Servono almeno titolo e data.";
      $("newsError").hidden = false;
      return;
    }
    const item = { title, date: f.date.value, text: f.text.value.trim(), image: newsDraftImage };
    if (editingNews) Object.assign(editingNews, item);
    else state.data.news.push({ _id: uid(), ...item });
    $("newsDialog").close();
    renderNews();
    updateSaveBar();
  });

  /* ---------- foto ---------- */
  function renderGallery() {
    const list = $("galleryList");
    const g = state.data.gallery;
    $("galleryEmpty").hidden = g.length > 0;
    list.innerHTML = g.map((s) => `
      <li class="shot ${s._busy ? "is-busy" : ""}" data-id="${s._id}">
        <div class="shot__img">
          ${s.src || s._preview ? `<img src="${esc(s._preview || imgUrl(s.src))}" alt="">` : ""}
          ${s._busy ? "" : `<button type="button" class="icon-btn" aria-label="Elimina foto">${TRASH}</button>`}
        </div>
        <label class="field"><span class="sr-only">Didascalia</span><input type="text" maxlength="200" placeholder="Didascalia (facoltativa)" value="${esc(s.caption || "")}"></label>
      </li>`).join("");
    list.querySelectorAll(".shot").forEach((li) => {
      const s = g.find((x) => x._id === li.dataset.id);
      li.querySelector("input").addEventListener("input", (e) => { s.caption = e.target.value; updateSaveBar(); });
      const del = li.querySelector(".icon-btn");
      if (del) del.addEventListener("click", () => {
        if (!confirm("Eliminare questa foto?")) return;
        state.data.gallery = g.filter((x) => x !== s);
        renderGallery();
        updateSaveBar();
      });
    });
  }

  $("galleryUpload").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const today = new Date().toISOString().slice(0, 10);
    const items = files.map((file) => ({ _id: uid(), _busy: true, _file: file, src: "", caption: "", date: today }));
    state.data.gallery.unshift(...items);
    renderGallery();
    let failed = 0;
    for (const it of items) {
      try {
        it.src = await upload(it._file);
      } catch (ex) {
        failed++;
        state.data.gallery = state.data.gallery.filter((x) => x !== it);
        toast(ex.message);
      }
      delete it._busy; delete it._file;
      renderGallery();
      updateSaveBar();
    }
    if (!failed) toast(`${items.length === 1 ? "Foto caricata" : `${items.length} foto caricate`}. Ricordati di salvare.`);
  });

  /* ---------- contatti ---------- */
  function renderClub() {
    const f = $("clubForm");
    const c = state.data.club;
    for (const el of f.elements) if (el.name) el.value = c[el.name] || "";
  }
  $("clubForm").addEventListener("input", (e) => {
    const el = e.target;
    if (!el.name) return;
    let v = el.value;
    if (el.name === "instagram") v = v.replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
    state.data.club[el.name] = v;
    updateSaveBar();
  });
  $("clubForm").addEventListener("submit", (e) => e.preventDefault());

  function renderAll() {
    renderPlayers();
    renderNews();
    renderGallery();
    renderClub();
    updateSaveBar();
  }

  /* ---------- avvio ---------- */
  state.token = store.get();
  if (state.token) {
    api("/me").then((r) => { state.user = r.user; openApp(); }).catch(() => logout());
  } else {
    $("loginView").hidden = false;
    $("username").focus();
  }
})();
