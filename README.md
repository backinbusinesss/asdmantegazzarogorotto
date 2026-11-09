# ASD Mantegazza Rogorotto, sito della squadra

Sito statico (HTML, CSS, JavaScript) della squadra di pallavolo mista **ASD Mantegazza Rogorotto** di Vanzago (MI),
iscritta al campionato **Volley Cup, Top misto, girone A** (stagione 2026/27).

## Da dove arrivano i dati

Calendario e risultati arrivano dal portale ufficiale della Volley Cup
([Italian Volley League / US ACLI](https://ivl.usacli.it/CalendarioView?territorio_id=3&societa_id=421)).

- `scripts/sync.py` scarica tutte le partite del girone, tiene solo i dati pubblici
  (data, squadre, palestra, set) e scrive `data/season.json`, compresa la classifica calcolata.
- La GitHub Action `.github/workflows/sync.yml` lo esegue **ogni 30 minuti** e fa commit solo se qualcosa è cambiato.
  Si può lanciare a mano da *Actions → Aggiorna calendario e risultati → Run workflow*.
- La pagina ricarica i dati ogni 5 minuti senza bisogno di aggiornare il browser.
- Lo stesso script genera `calendar.ics` (il calendario a cui ci si iscrive da iPhone, Google Calendar o Outlook,
  che si aggiorna da solo se una partita viene spostata) e `cal/<id>.ics` per aggiungere una singola partita.

## Cosa modificare a mano

| File | Cosa contiene |
| --- | --- |
| `data/players.json` | La rosa. Ora è vuota (`[]`): finché resta vuota il sito mostra "Rosa in arrivo". |
| `data/config.json` | Squadra, girone e stagione. Da aggiornare a inizio di ogni stagione. |
| `index.html` | Testi, contatti, palestre. |

Formato di un giocatore in `data/players.json`:

```json
[
  { "name": "Nome Cognome", "role": "Palleggiatrice", "number": 7, "captain": false }
]
```

### Nuova stagione

1. Sul portale apri il calendario filtrato per la società "MANTEGAZZA ROGOROTTO".
2. Dagli strumenti sviluppatore del browser (scheda Rete) leggi il `girone_id` nella richiesta `PartiteData`.
3. Aggiorna `girone_id`, `season_start`, `season_end` e, se cambia categoria, `category_suffix` e `competition` in `data/config.json`.

## Provarlo in locale

```bash
python scripts/sync.py
python -m http.server 8765
```

Poi apri http://localhost:8765.
