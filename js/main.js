(() => {
  "use strict";

  const REFRESH_MS = 5 * 60 * 1000;
  const MATCH_LENGTH_MS = 2.5 * 60 * 60 * 1000;
  const $ = (id) => document.getElementById(id);

  const state = { season: null, players: [], filter: "all" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const title = (s) => String(s || "").toLowerCase().replace(/(^|[\s'.-])\p{L}/gu, (m) => m.toUpperCase());
  const pad = (n) => String(n).padStart(2, "0");
  const when = (m) => new Date(m.datetime);

  const fmtDay = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
  const fmtStamp = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const day = (d) => fmtDay.format(d).replace(".", "");

  const isUs = (name) => state.season && name === state.season.team;
  const isHome = (m) => isUs(m.home);
  const opponent = (m) => (isHome(m) ? m.away : m.home);
  const ourSets = (m) => (isHome(m) ? m.result : [m.result[1], m.result[0]]);
  const won = (m) => { const [a, b] = ourSets(m); return a > b; };
  const mapsUrl = (v) => v.lat && v.lng
    ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name} ${v.address} ${v.city}`)}`;

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
      $("lastResult").textContent = "Non riesco a caricare il calendario. Riprova tra poco o apri il calendario ufficiale.";
    }
  }

  /* ---------- render ---------- */
  function render() {
    const s = state.season;
    $("leagueLine").textContent = `${s.competition}, ${s.group}`;
    $("groupName").textContent = s.group;
    $("sourceLink").href = s.source;
    if (s.updated_at) $("updated").textContent = `Ultimo aggiornamento dati: ${fmtStamp.format(new Date(s.updated_at))}.`;
    renderBoard();
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

  function teamHTML(name) {
    return `<span class="${isUs(name) ? "is-us" : ""}">${esc(title(name))}</span>`;
  }

  let clockTimer = null;
  function renderBoard() {
    const m = nextMatch() || lastPlayed();
    clearInterval(clockTimer);
    if (!m) return;

    const d = when(m);
    $("boardLabel").textContent = m.result ? "Ultima partita" : "Prossima partita";
    $("boardDate").textContent = `${day(d)}, ore ${fmtTime.format(d)}`;
    $("boardHome").textContent = title(m.home);
    $("boardAway").textContent = title(m.away);
    $("boardHome").classList.toggle("is-us", isUs(m.home));
    $("boardAway").classList.toggle("is-us", isUs(m.away));
    const score = $("boardScore");
    score.textContent = m.result ? `${m.result[0]}-${m.result[1]}` : "vs";
    score.classList.toggle("is-score", !!m.result);

    $("boardVenue").textContent = `${m.venue.name}, ${m.venue.city}`;
    $("boardVenue").href = mapsUrl(m.venue);
    $("boardIcs").hidden = !!m.result;
    $("boardIcs").onclick = () => downloadIcs([m], `partita-${m.id}.ics`);

    const clock = $("boardClock");
    if (m.result) {
      clock.hidden = true;
      return;
    }
    clock.hidden = false;
    const tick = () => {
      const diff = d.getTime() - Date.now();
      if (diff <= 0) {
        clock.classList.add("is-live");
        clock.innerHTML = `<div>Si gioca adesso</div>`;
        clearInterval(clockTimer);
        return;
      }
      const sec = Math.floor(diff / 1000);
      $("cdD").textContent = pad(Math.floor(sec / 86400));
      $("cdH").textContent = pad(Math.floor((sec % 86400) / 3600));
      $("cdM").textContent = pad(Math.floor((sec % 3600) / 60));
      $("cdS").textContent = pad(sec % 60);
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function renderTicker() {
    const last = lastPlayed();
    if (last) {
      const [a, b] = ourSets(last);
      $("lastResult").innerHTML =
        `<span class="tag ${won(last) ? "tag--win" : "tag--loss"}">${won(last) ? "Vinta" : "Persa"}</span>` +
        `Ultima: <strong>${a}-${b}</strong> ${isHome(last) ? "contro" : "in casa di"} ${esc(title(opponent(last)))}`;
    } else {
      $("lastResult").textContent = "Stagione appena iniziata: nessun risultato ancora.";
    }
    const row = state.season.standings.find((r) => isUs(r.team));
    if (row) {
      $("tablePos").innerHTML = `<strong>${row.pos}°</strong> in classifica con <strong>${row.points}</strong> ${row.points === 1 ? "punto" : "punti"}`;
    }
  }

  function renderFixtures() {
    const list = $("fixtures");
    const matches = state.season.matches;
    const next = nextMatch();
    const rounds = state.season.group_matches.map((m) => m.round).filter(Number.isFinite);
    const maxRound = rounds.length ? Math.max(...rounds) : 0;
    const half = Math.ceil(maxRound / 2);

    const byRound = new Map(matches.map((m) => [m.round, m]));
    let html = "";
    for (let r = 1; r <= maxRound; r++) {
      if (r === 1) html += `<li class="phase" data-phase>Andata</li>`;
      if (r === half + 1) html += `<li class="phase" data-phase>Ritorno</li>`;
      const m = byRound.get(r);
      if (!m) {
        html += `<li class="fx fx--rest" data-side="rest"><div class="fx__round">${r}</div><div class="fx__teams">Turno di riposo</div></li>`;
        continue;
      }
      html += fixtureRow(m, m === next);
    }
    list.innerHTML = html;
    list.querySelectorAll("[data-ics]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = matches.find((x) => String(x.id) === btn.dataset.ics);
        if (m) downloadIcs([m], `partita-${m.id}.ics`);
      });
    });
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
      score = `<span aria-label="${a} a ${b}, ${won(m) ? "vinta" : "persa"}">${a}-${b}</span><small>${esc(sets)}</small>`;
    } else {
      score = `<span class="pending">${isNext ? "Prossima" : "Da giocare"}</span>`;
    }

    const teamSpan = (n) => `<span class="${isUs(n) ? "us" : ""}">${esc(title(n))}</span>`;
    return `<li class="${cls.join(" ")}" data-side="${isHome(m) ? "home" : "away"}">
      <div class="fx__round">${m.round}<small>giornata</small></div>
      <div class="fx__date">${esc(day(d))}<span>ore ${fmtTime.format(d)}${m.postponed ? ", rinviata" : ""}</span></div>
      <div class="fx__teams">${teamSpan(m.home)}<span class="dash">-</span>${teamSpan(m.away)}</div>
      <div class="fx__score">${score}</div>
      <div class="fx__where">
        <a href="${mapsUrl(m.venue)}" target="_blank" rel="noopener">${esc(m.venue.name)}, ${esc(m.venue.city)}</a>
        ${m.result ? "" : `<br><button type="button" class="fx__ics" data-ics="${m.id}">Aggiungi al calendario</button>`}
      </div>
    </li>`;
  }

  function applyFilter() {
    const f = state.filter;
    $("fixtures").querySelectorAll(".fx").forEach((li) => {
      const side = li.dataset.side;
      li.classList.toggle("is-hidden", f !== "all" && side !== f);
    });
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
        <td class="team">${esc(title(r.team))}</td>
        <td class="pts">${r.points}</td>
        <td>${r.played}</td>
        <td>${r.won}</td>
        <td>${r.lost}</td>
        <td>${r.sets_won}-${r.sets_lost}</td>
        <td><span class="form" aria-label="Ultime partite: ${r.form.map((f) => (f === "W" ? "vinta" : "persa")).join(", ") || "nessuna"}">${r.form.map((f) => `<i class="${f}"></i>`).join("")}</span></td>
      </tr>`).join("");
  }

  const SHIRT = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 6l-14 8 5 12 6-3v35h26V23l6 3 5-12-14-8c-2 5-6 8-10 8s-8-3-10-8z" fill="#1D3F91" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><text x="32" y="46" text-anchor="middle" font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="900" font-size="18" fill="#E8BF86">?</text></svg>`;

  function renderRoster() {
    const box = $("roster");
    const players = state.players.slice().sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
    if (!players.length) {
      box.innerHTML = `<div class="roster-empty">
        <div class="roster-empty__shirts">${SHIRT.repeat(4)}</div>
        <p><strong>Rosa in arrivo</strong>Stiamo preparando le schede di giocatrici e giocatori della stagione 2026/27. Nel frattempo ci trovi in campo il venerdì sera alla palestra Airaghi.</p>
      </div>`;
      return;
    }
    box.innerHTML = players.map((p) => `
      <article class="player">
        <span class="player__num">${p.number ?? ""}</span>
        <span class="player__name">${esc(p.name)}</span>
        <span class="player__role">${esc(p.role || "")}</span>
        ${p.captain ? `<span class="player__cap">Capitano</span>` : ""}
      </article>`).join("");
  }

  /* ---------- calendario .ics ---------- */
  function icsDate(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  }
  const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

  function downloadIcs(matches, filename) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mantegazza Rogorotto//Calendario//IT", "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:Mantegazza Rogorotto",
    ];
    matches.forEach((m) => {
      const start = when(m);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      lines.push(
        "BEGIN:VEVENT",
        `UID:volleycup-${m.id}@mantegazzarogorotto`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Europe/Rome:${icsDate(start)}`,
        `DTEND;TZID=Europe/Rome:${icsDate(end)}`,
        `SUMMARY:${icsText(`${title(m.home)} - ${title(m.away)}`)}`,
        `LOCATION:${icsText(`${m.venue.name}, ${m.venue.address}, ${m.venue.city}`)}`,
        `DESCRIPTION:${icsText(`${state.season.competition}, giornata ${m.round}`)}`,
        "END:VEVENT",
      );
    });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  $("seasonIcs").addEventListener("click", () => {
    if (!state.season) return;
    downloadIcs(state.season.matches.filter((m) => !m.result), "mantegazza-rogorotto-calendario.ics");
  });

  load();
  setInterval(load, REFRESH_MS);
})();
