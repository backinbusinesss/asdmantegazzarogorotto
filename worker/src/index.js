/**
 * Admin API per il sito ASD Mantegazza Rogorotto.
 *
 * Il sito resta statico su GitHub Pages. Questo Worker:
 *  - controlla utente e password degli admin (hash PBKDF2 nel secret ADMIN_USERS)
 *  - rilascia un token di sessione firmato (HMAC con il secret SESSION_SECRET)
 *  - salva i file di contenuto nel repository GitHub (token nel secret GITHUB_TOKEN)
 *
 * Nessuna password o chiave è nel codice: stanno tutte nei secret di Cloudflare.
 */

const CONTENT_FILES = {
  players: "data/players.json",
  news: "data/news.json",
  gallery: "data/gallery.json",
  club: "data/club.json",
};
const UPLOAD_DIR = "assets/uploads/";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 200 * 1024;
const SESSION_HOURS = 24 * 7;
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

    if (origin && !allowed.includes(origin)) return json({ error: "Origine non autorizzata." }, 403);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/login" && request.method === "POST") return await login(request, env, json);

      const user = await auth(request, env);
      if (!user) return json({ error: "Sessione scaduta: accedi di nuovo." }, 401);

      if (url.pathname === "/me" && request.method === "GET") return json({ user });

      if (url.pathname === "/content" && request.method === "GET") {
        const out = {};
        await Promise.all(Object.entries(CONTENT_FILES).map(async ([key, path]) => {
          const f = await ghGet(env, path);
          out[key] = f ? JSON.parse(b64ToText(f.content)) : null;
        }));
        return json(out);
      }

      const m = url.pathname.match(/^\/content\/(players|news|gallery|club)$/);
      if (m && request.method === "PUT") {
        const raw = await request.text();
        if (raw.length > MAX_JSON_BYTES) return json({ error: "Contenuto troppo grande." }, 413);
        const data = JSON.parse(raw);
        const err = validate(m[1], data);
        if (err) return json({ error: err }, 400);
        const path = CONTENT_FILES[m[1]];
        const text = JSON.stringify(data, null, 1) + "\n";
        await ghPut(env, path, textToB64(text), `Admin (${user}): aggiorna ${m[1]}`);
        return json({ ok: true });
      }

      if (url.pathname === "/upload" && request.method === "POST") {
        const { name, type, data } = await request.json();
        const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
        if (!ext) return json({ error: "Formato non supportato: usa JPG, PNG o WebP." }, 400);
        const bytes = Math.floor((String(data).length * 3) / 4);
        if (bytes > MAX_UPLOAD_BYTES) return json({ error: "Immagine troppo grande (massimo 4 MB)." }, 413);
        const slug = String(name || "foto").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foto";
        const path = `${UPLOAD_DIR}${new Date().toISOString().slice(0, 10)}-${slug}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
        await ghPut(env, path, String(data), `Admin (${user}): carica ${path}`);
        return json({ ok: true, path });
      }

      if (url.pathname === "/upload" && request.method === "DELETE") {
        const path = url.searchParams.get("path") || "";
        if (!path.startsWith(UPLOAD_DIR) || path.includes("..")) return json({ error: "Percorso non valido." }, 400);
        const f = await ghGet(env, path);
        if (f) await ghDelete(env, path, f.sha, `Admin (${user}): elimina ${path}`);
        return json({ ok: true });
      }

      return json({ error: "Non trovato." }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.publicMessage || "Errore del server. Riprova tra poco." }, e.status || 500);
    }
  },
};

/* ---------------- login e sessione ---------------- */

async function login(request, env, json) {
  if (env.LOGIN_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.LOGIN_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "Troppi tentativi. Aspetta un minuto e riprova." }, 429);
  }
  const { username = "", password = "" } = await request.json().catch(() => ({}));
  const users = JSON.parse(env.ADMIN_USERS || "{}");
  const record = users[String(username).trim().toLowerCase()];
  // calcola comunque un hash per non rivelare se l'utente esiste
  const ok = await verifyPassword(String(password), record || "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!record || !ok) {
    await new Promise((r) => setTimeout(r, 600));
    return json({ error: "Utente o password non corretti." }, 401);
  }
  const user = String(username).trim().toLowerCase();
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp })));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return json({ token: `${payload}.${sig}`, user, exp });
}

async function auth(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(env.SESSION_SECRET, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  const { u, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (!u || Date.now() > exp) return null;
  const users = JSON.parse(env.ADMIN_USERS || "{}");
  return users[u] ? u : null; // utente rimosso = sessione non più valida
}

async function verifyPassword(password, record) {
  const [alg, iter, saltB64, hashB64] = record.split("$");
  if (alg !== "pbkdf2") return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64url(saltB64), iterations: Number(iter) }, key, 256);
  return timingSafeEqual(b64url(new Uint8Array(bits)), hashB64);
}

async function hmac(secret, data) {
  if (!secret) throw Object.assign(new Error("SESSION_SECRET mancante"), { publicMessage: "Server non configurato." });
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------------- validazione ---------------- */

const isStr = (v, max = 2000) => typeof v === "string" && v.length <= max;
const isOptStr = (v, max) => v === undefined || v === null || isStr(v, max);
const isImg = (v) => v === undefined || v === null || v === "" || (isStr(v, 200) && v.startsWith(UPLOAD_DIR) && !v.includes(".."));

function validate(kind, d) {
  if (kind === "players") {
    if (!Array.isArray(d) || d.length > 60) return "Rosa non valida.";
    for (const p of d) {
      if (!isStr(p.name, 80) || !p.name.trim()) return "Ogni giocatore deve avere un nome.";
      if (p.number !== null && p.number !== undefined && p.number !== "" && !(Number.isInteger(p.number) && p.number >= 0 && p.number <= 99)) return `Numero non valido per ${p.name}.`;
      if (!isOptStr(p.role, 40) || !isImg(p.photo)) return `Dati non validi per ${p.name}.`;
    }
  } else if (kind === "news") {
    if (!Array.isArray(d) || d.length > 200) return "News non valide.";
    for (const n of d) {
      if (!isStr(n.title, 140) || !n.title.trim()) return "Ogni news deve avere un titolo.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date || "")) return `Data non valida per "${n.title}".`;
      if (!isStr(n.text || "", 5000) || !isImg(n.image)) return `Dati non validi per "${n.title}".`;
    }
  } else if (kind === "gallery") {
    if (!Array.isArray(d) || d.length > 500) return "Galleria non valida.";
    for (const g of d) {
      if (!isImg(g.src) || !g.src) return "Ogni foto deve avere un'immagine.";
      if (!isOptStr(g.caption, 200)) return "Didascalia troppo lunga.";
    }
  } else if (kind === "club") {
    if (typeof d !== "object" || Array.isArray(d)) return "Contatti non validi.";
    for (const k of ["email", "instagram", "facebook", "home_gym_name", "home_gym_address", "training", "seat", "invite"]) {
      if (!isOptStr(d[k], 600)) return `Campo ${k} non valido.`;
    }
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "Indirizzo email non valido.";
    if (d.facebook && !/^(https:\/\/(www\.|m\.)?facebook\.com\/)?[\w.\-\/?=&%]+$/.test(d.facebook)) return "Link Facebook non valido.";
  }
  return null;
}

/* ---------------- GitHub ---------------- */

async function gh(env, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH || "main"}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mr-admin-worker",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  return res;
}

async function ghGet(env, path) {
  const res = await gh(env, path);
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`GitHub GET ${res.status}`), { publicMessage: "Non riesco a leggere i dati da GitHub." });
  return res.json();
}

async function ghPut(env, path, contentB64, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await ghGet(env, path);
    const res = await gh(env, path, {
      method: "PUT",
      body: JSON.stringify({ message, content: contentB64, branch: env.GITHUB_BRANCH || "main", ...(current ? { sha: current.sha } : {}) }),
    });
    if (res.ok) return;
    if (res.status !== 409 && res.status !== 422) {
      throw Object.assign(new Error(`GitHub PUT ${res.status}: ${await res.text()}`), { publicMessage: "Salvataggio su GitHub non riuscito." });
    }
  }
  throw Object.assign(new Error("GitHub PUT conflict"), { publicMessage: "Qualcun altro sta salvando: riprova tra qualche secondo." });
}

async function ghDelete(env, path, sha, message) {
  const res = await gh(env, path, { method: "DELETE", body: JSON.stringify({ message, sha, branch: env.GITHUB_BRANCH || "main" }) });
  if (!res.ok && res.status !== 404) throw Object.assign(new Error(`GitHub DELETE ${res.status}`), { publicMessage: "Eliminazione non riuscita." });
}

/* ---------------- base64 ---------------- */

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function textToB64(text) {
  let s = "";
  enc.encode(text).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
function b64ToText(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}
