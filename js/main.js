(() => {
  "use strict";

  const REFRESH_MS = 5 * 60 * 1000;
  const MATCH_LENGTH_MS = 2.5 * 60 * 60 * 1000;
  const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;
  const $ = (id) => document.getElementById(id);

  const state = { season: null, players: [], filter: "all" };

  /* ---------- utilità ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const title = (s) => String(s || "").toLowerCase().replace(/(^|[\s'.-])\p{L}/gu, (m) => m.toUpperCase());
  const pad = (n) => String(n).padStart(2, "0");
  const when = (m) => new Date(m.datetime);

  const fmtWeekday = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
  const fmtShort = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
  const fmtStamp = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const shortDay = (d) => cap(fmtShort.format(d).replace(/\./g, ""));

  const isUs = (name) => state.season && name === state.season.team;
  const isHome = (m) => isUs(m.home);
  const opponent = (m) => (isHome(m) ? m.away : m.home);
  const ourSets = (m) => (isHome(m) ? m.result : [m.result[1], m.result[0]]);
  const won = (m) => { const [a, b] = ourSets(m); return a > b; };
  const mapsUrl = (v) => (v.lat && v.lng)
    ? `https://www.google.com/maps/search/?api=1&query=${Number(v.lat)},${Number(v.lng)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name} ${v.address} ${v.city}`)}`;
  const matchTitle = (m) => `${title(m.home)} - ${title(m.away)}`;
  const venueText = (v) => [v.name, v.address, v.city].filter(Boolean).join(", ");

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("is-on"), 3200);
  }

  /* ---------- link calendario ---------- */
  const feedHttps = new URL("calendar.ics", location.href).href;
  const feedWebcal = feedHttps.replace(/^https?:/, "webcal:");

  const ICON = {
    google: `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#4285F4" stroke-width="2"/><path d="M3 9h18" stroke="#4285F4" stroke-width="2"/><text x="12" y="18.5" text-anchor="middle" font-size="8" font-weight="700" fill="#4285F4" font-family="Arial">31</text></svg>`,
    apple: `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#0C2237" stroke-width="2"/><path d="M3 9h18" stroke="#E5483B" stroke-width="3"/><text x="12" y="18.5" text-anchor="middle" font-size="8" font-weight="700" fill="#0C2237" font-family="Arial">31</text></svg>`,
    outlook: `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#0F6CBD" stroke-width="2"/><path d="M3 9h18" stroke="#0F6CBD" stroke-width="2"/><circle cx="12" cy="15" r="3" fill="none" stroke="#0F6CBD" stroke-width="2"/></svg>`,
  };

  function gcalDates(m) {
    const s = when(m);
    const e = new Date(s.getTime() + MATCH_DURATION_MS);
    const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    return `${f(s)}/${f(e)}`;
  }
  function localIso(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }

  function calLinks(m) {
    const details = `${state.season.competition}, giornata ${m.round}\n${location.href.split("#")[0]}`;
    const google = "https://calendar.google.com/calendar/render?" + new URLSearchParams({
      action: "TEMPLATE", text: matchTitle(m), dates: gcalDates(m), ctz: "Europe/Rome",
      location: venueText(m.venue), details,
    });
    const s = when(m);
    const outlook = "https://outlook.live.com/calendar/0/deeplink/compose?" + new URLSearchParams({
      path: "/calendar/action/compose", rru: "addevent", subject: matchTitle(m),
      startdt: localIso(s), enddt: localIso(new Date(s.getTime() + MATCH_DURATION_MS)),
      location: venueText(m.venue), body: details,
    });
    const apple = new URL(`cal/${m.id}.ics`, location.href).href;
    return { google, outlook, apple };
  }

  function calMenuHTML(m) {
    const l = calLinks(m);
    return `
      <a href="${esc(l.google)}" target="_blank" rel="noopener">${ICON.google}Google Calendar</a>
      <a href="${esc(l.apple)}">${ICON.apple}iPhone e Mac</a>
      <a href="${esc(l.outlook)}" target="_blank" rel="noopener">${ICON.outlook}Outlook</a>`;
  }

  function setupFollow() {
    $("subApple").href = feedWebcal;
    $("subGoogle").href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedWebcal)}`;
    $("subOutlook").href = "https://outlook.live.com/calendar/0/addfromweb?" + new URLSearchParams({ url: feedHttps, name: "Mantegazza Rogorotto" });
    $("copyFeed").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(feedHttps);
        toast("Link del calendario copiato");
      } catch {
        prompt("Copia questo link del calendario:", feedHttps);
      }
    });
  }

  // un solo menu calendario aperto alla volta; chiusura con click fuori o Esc
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.cal[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll("details.cal[open]").forEach((d) => { d.open = false; d.querySelector("summary").focus(); });
  });
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("cal") || !d.open) return;
    document.querySelectorAll("details.cal[open]").forEach((o) => { if (o !== d) o.open = false; });
    const menu = d.querySelector(".cal__menu");
    menu.style.left = "0"; menu.style.right = "auto";
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 12) { menu.style.left = "auto"; menu.style.right = "0"; }
  }, true);

  /* ---------- dati ---------- */
  async function getJSON(url) {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  async function load() {
    try {
      const [season, players] = await Promise.all([
        getJSON("data/season.json"),
        getJSON("data/players.json").catch(() => []),
      ]);
      state.season = season;
      state.players = Array.isArray(players) ? players : [];
      render();
    } catch (err) {
      console.error(err);
      if (!state.season) {
        $("lastResult").textContent = "Il calendario non si è caricato. Ricarica la pagina o apri il calendario ufficiale Volley Cup.";
        $("fixtures").innerHTML = "";
      }
    }
  }

  /* ---------- render ---------- */
  function render() {
    const s = state.season;
    document.querySelectorAll(".sk").forEach((el) => el.classList.remove("sk"));
    $("leagueLine").textContent = `${s.competition}, ${s.group}`;
    $("groupName").textContent = `${s.competition}, ${s.group}`;
    $("sourceLink").href = s.source;
    $("fixtures").setAttribute("aria-busy", "false");
    if (s.updated_at) $("updated").textContent = `Dati aggiornati il ${fmtStamp.format(new Date(s.updated_at))}.`;
    renderBoard();
    renderRecord();
    renderTicker();
    renderFixtures();
    renderStandings();
    renderRoster();
  }

  function nextMatch() {
    const now = Date.now();
    return state.season.matches.find((m) => !m.result && when(m).getTime() + MATCH_LENGTH_MS > now) || null;
  }
  function lastPlayed() {
    const played = state.season.matches.filter((m) => m.result);
    return played[played.length - 1] || null;
  }

  let clockTimer = null;
  let boardMatchId = null;
  function renderBoard() {
    const m = nextMatch() || lastPlayed();
    clearInterval(clockTimer);
    if (!m) return;
    const first = boardMatchId !== m.id;
    boardMatchId = m.id;

    const d = when(m);
    $("boardLabel").textContent = m.result ? "Ultima partita" : "Prossima partita";
    const side = $("boardSide");
    side.textContent = isHome(m) ? "In casa" : "In trasferta";
    side.classList.toggle("is-away", !isHome(m));
    const wd = fmtWeekday.format(d);
    $("boardDate").textContent = `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ore ${fmtTime.format(d)}`;
    $("boardHome").textContent = title(m.home);
    $("boardAway").textContent = title(m.away);
    $("boardHome").classList.toggle("is-us", isUs(m.home));
    $("boardAway").classList.toggle("is-us", isUs(m.away));
    const score = $("boardScore");
    score.textContent = m.result ? `${m.result[0]}-${m.result[1]}` : "vs";
    score.classList.toggle("is-score", !!m.result);

    const venue = $("boardVenue");
    venue.querySelector("span").textContent = `${m.venue.name}, ${m.venue.city}`;
    venue.href = mapsUrl(m.venue);
    venue.setAttribute("aria-label", `Apri su Google Maps: ${venueText(m.venue)}`);

    $("boardCal").hidden = !!m.result;
    $("boardCalMenu").innerHTML = m.result ? "" : calMenuHTML(m);
    $("boardShare").onclick = () => shareMatch(m);

    const clock = $("boardClock");
    if (m.result) { clock.hidden = true; return; }
    clock.hidden = false;

    const digits = { d: $("cdD"), h: $("cdH"), m: $("cdM"), s: $("cdS") };
    const set = (el, v, animate) => {
      if (el.textContent === v) return;
      el.textContent = v;
      if (animate) { el.classList.remove("flip"); void el.offsetWidth; el.classList.add("flip"); }
    };
    const tick = (animate) => {
      const diff = d.getTime() - Date.now();
      if (diff <= 0) {
        clock.innerHTML = `<div class="board__live" style="grid-column:1/-1">Si gioca adesso</div>`;
        clearInterval(clockTimer);
        return;
      }
      const sec = Math.floor(diff / 1000);
      set(digits.d, pad(Math.floor(sec / 86400)), animate);
      set(digits.h, pad(Math.floor((sec % 86400) / 3600)), animate);
      set(digits.m, pad(Math.floor((sec % 3600) / 60)), animate);
      set(digits.s, pad(sec % 60), false);
    };
    tick(first);
    clockTimer = setInterval(() => tick(true), 1000);
  }

  async function shareMatch(m) {
    const d = when(m);
    const what = m.result
      ? `${matchTitle(m)} ${m.result[0]}-${m.result[1]}`
      : `${matchTitle(m)}, ${fmtWeekday.format(d)} ore ${fmtTime.format(d)} a ${m.venue.city}`;
    const text = `🏐 ${what}`;
    const url = location.href.split("#")[0];
    if (navigator.share) {
      try { await navigator.share({ title: "Mantegazza Rogorotto", text, url }); } catch { /* annullato */ }
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
  }

  function renderRecord() {
    const row = state.season.standings.find((r) => isUs(r.team));
    if (!row) return;
    $("recW").textContent = row.won;
    $("recL").textContent = row.lost;
    $("recS").textContent = `${row.sets_won}-${row.sets_lost}`;
    $("recP").textContent = `${row.pos}°`;
  }

  function renderTicker() {
    const last = lastPlayed();
    if (!last) {
      $("lastResult").textContent = "La stagione è appena iniziata.";
      return;
    }
    const [a, b] = ourSets(last);
    const w = won(last);
    $("lastResult").innerHTML =
      `<span class="tag ${w ? "tag--win" : "tag--loss"}">${w ? "Vinta" : "Persa"}</span>` +
      `Ultima: <strong>${a}-${b}</strong> ${isHome(last) ? "in casa contro" : "in casa di"} ${esc(title(opponent(last)))}`;
  }

  function renderFixtures() {
    const list = $("fixtures");
    const matches = state.season.matches;
    const next = nextMatch();
    const rounds = state.season.group_matches.map((m) => m.round).filter(Number.isFinite);
    const maxRound = rounds.length ? Math.max(...rounds) : 0;
    const half = Math.ceil(maxRound / 2);
    const homeCount = matches.filter(isHome).length;
    $("fixturesSub").textContent = `Stagione 2026/27: ${matches.length} partite, ${homeCount} in casa a Vanzago.`;

    const byRound = new Map(matches.map((m) => [m.round, m]));
    let html = "";
    for (let r = 1; r <= maxRound; r++) {
      if (r === 1) html += `<li class="phase" data-phase>Andata</li>`;
      if (r === half + 1) html += `<li class="phase" data-phase>Ritorno</li>`;
      const m = byRound.get(r);
      html += m ? fixtureRow(m, m === next)
        : `<li class="fx fx--rest" data-side="rest"><div class="fx__round">${r}</div><div>Turno di riposo</div></li>`;
    }
    list.innerHTML = html;
    applyFilter();
  }

  function fixtureRow(m, isNext) {
    const d = when(m);
    const cls = ["fx"];
    if (m.result) cls.push(won(m) ? "is-win" : "is-loss");
    if (isNext) cls.push("is-next");

    let score;
    if (m.result) {
      const [a, b] = m.result;
      const sets = m.sets.map((s) => `${s[0]}-${s[1]}`).join(", ");
      score = `<span class="res">${won(m) ? "Vinta" : "Persa"}</span><span>${a}-${b}</span><small>${esc(sets)}</small>`;
    } else {
      score = `<span class="pending">${isNext ? "Prossima" : "Da giocare"}</span>`;
    }

    const teamSpan = (n) => `<span class="${isUs(n) ? "us" : ""}">${esc(title(n))}</span>`;
    const chips = [
      isHome(m) ? `<span class="chip chip--home">In casa</span>` : `<span class="chip">In trasferta</span>`,
      m.postponed ? `<span class="chip">Rinviata</span>` : "",
    ].join("");

    const cal = m.result ? "" : `
      <details class="cal">
        <summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Aggiungi al calendario</summary>
        <div class="cal__menu">${calMenuHTML(m)}</div>
      </details>`;

    return `<li class="${cls.join(" ")}" data-side="${isHome(m) ? "home" : "away"}">
      <div class="fx__round">${m.round}<small>giornata</small></div>
      <div class="fx__date">${esc(shortDay(d))}<span>ore ${fmtTime.format(d)}</span></div>
      <div class="fx__teams">${teamSpan(m.home)}<span class="dash">-</span>${teamSpan(m.away)}<div class="fx__meta">${chips}</div></div>
      <div class="fx__score">${score}</div>
      <div class="fx__where">
        <a href="${mapsUrl(m.venue)}" target="_blank" rel="noopener">${esc(m.venue.name)}, ${esc(m.venue.city)}</a>
        ${cal}
      </div>
    </li>`;
  }

  function applyFilter() {
    const f = state.filter;
    $("fixtures").querySelectorAll(".fx").forEach((li) => li.classList.toggle("is-hidden", f !== "all" && li.dataset.side !== f));
    $("fixtures").querySelectorAll("[data-phase]").forEach((li) => li.classList.toggle("is-hidden", f !== "all"));
  }

  document.querySelectorAll(".filters button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll(".filters button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      applyFilter();
    });
  });

  function renderStandings() {
    $("standings").innerHTML = state.season.standings.map((r) => `
      <tr class="${isUs(r.team) ? "is-us" : ""}">
        <td class="pos">${r.pos}</td>
        <th scope="row" class="team">${esc(title(r.team))}</th>
        <td class="pts">${r.points}</td>
        <td>${r.played}</td>
        <td>${r.won}</td>
        <td>${r.lost}</td>
        <td class="hide-sm">${r.sets_won}-${r.sets_lost}</td>
        <td class="hide-sm"><span class="form">${r.form.map((f) => `<i class="${f}" title="${f === "W" ? "Vinta" : "Persa"}">${f === "W" ? "V" : "P"}</i>`).join("")}</span></td>
      </tr>`).join("");
  }

  const SHIRT = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 6l-14 8 5 12 6-3v35h26V23l6 3 5-12-14-8c-2 5-6 8-10 8s-8-3-10-8z" fill="#0A2540" stroke="#00D4AA" stroke-width="2.5" stroke-linejoin="round"/><text x="32" y="46" text-anchor="middle" font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="900" font-size="18" fill="#F4C95D">?</text></svg>`;

  function renderRoster() {
    const box = $("roster");
    const players = state.players.slice().sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
    if (!players.length) {
      box.innerHTML = `<div class="roster-empty">
        <div class="roster-empty__shirts">${SHIRT.repeat(4)}</div>
        <div>
          <h3>Rosa in arrivo</h3>
          <p>Stiamo preparando le schede di giocatrici e giocatori della stagione 2026/27. Nel frattempo ci trovi in campo il venerdì sera alla palestra Airaghi.</p>
          <a class="btn btn--navy" href="#contatti">Vuoi giocare con noi?</a>
        </div>
      </div>`;
      return;
    }
    box.innerHTML = players.map((p) => `
      <article class="player">
        <span class="player__num">${esc(p.number ?? "")}</span>
        <span class="player__name">${esc(p.name)}</span>
        <span class="player__role">${esc(p.role || "")}</span>
        ${p.captain ? `<span class="player__cap" title="Capitano" aria-label="Capitano">C</span>` : ""}
      </article>`).join("");
  }

  /* ---------- nav attiva ---------- */
  const navLinks = [...document.querySelectorAll(".nav a")];
  const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
  const markNav = (id) => navLinks.forEach((a) => {
    if (id && a.getAttribute("href") === `#${id}`) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) markNav(en.target.id); });
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((s) => s && spy.observe(s));
  const hero = document.querySelector(".hero");
  new IntersectionObserver(([en]) => { if (en.isIntersecting) markNav(null); }, { rootMargin: "-45% 0px -50% 0px" }).observe(hero);

  setupFollow();
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
})();
