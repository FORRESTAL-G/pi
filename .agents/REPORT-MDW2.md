# REPORT-MDW2 — marker tempo SOTTO al messaggio (divisore full-width + ▲ + data sempre)

Worker: MDW. Supervisore: ast10. Richiesta owner: marker `▼ HH:MM` spostati SOTTO i messaggi come «divisore adattabile + marker + freccia invertita» (verbatim brief). Integrazione owner a lavoro in corso (07/09 ore 22): «va bene così [divisore pieno, niente tratteggiato], però la data completa SEMPRE, anche nello stesso giorno».

## File toccati (esatto, rito .bak-ts1)

Live install 0.84.2 — `C:/Users/manu9/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist`:

1. `modes/interactive/components/timestamp-marker.js` — backup `timestamp-marker.js.bak-ts1` (stato pre-MDW2). Modifiche:
   - `formatTimestampMarker`: freccia `▼` → `▲`.
   - `TimestampMarkerComponent.render(width)`: ora ritorna DUE righe — divisore `─` ripetuto a `width` reale (dim) + testo marker (dim). Il divisore si adatta al riquadro; `Math.max(1, width)` per sicurezza.
   - `buildTimestampMarker`: data completa SEMPRE (`formatTimestampMarker(ts, true)`), rev3. Firma invariata (`previousTs`/`now` restano per compat col call-site); `timestampMarkerNeedsDate` NON toccata — è ancora usata da `tree-selector.js` per le etichette `/tree`, che mantengono la logica cambio-giorno (l'owner chiedeva i marker del transcript).
   - Doc comment aggiornati (rev2→rev3, ▲ punta al messaggio sovrastante).
2. `modes/interactive/interactive-mode.js` — backup `interactive-mode.js.bak-ts1`. Call-site `addTimestampMarker` spostati DOPO il componente del messaggio (prima erano sopra). 4 siti:
   - `message_start` assistant streaming: `addChild(streamingComponent)` poi `addTimestampMarker`.
   - `addMessageToChat` case `custom`: costruisce+appende il componente, poi marker.
   - case `user`: marker dopo il blocco user message completo (skill card + eventuale user msg); Spacer(1) di testa invariato.
   - case `assistant` settled: componente poi marker.
   - Doc comment `addTimestampMarker` aggiornato: la semantica `previousTs`/`lastMarkerEligibleTs` resta l'ordine temporale dei messaggi, cambia solo la posizione visiva.

`.d.ts` e `.js.map` non toccati (nessun cambio di firma; map stale come nei rito precedenti). Rollback: `cp <file>.bak-ts1 <file>` per entrambi.

## Verifica E2E (sessione herdr isolata `mdwtest`, R7; stoppata + deleted, default intatta)

pi fresco nel pane (w1:p1), messaggi reali con risposta modello. Catena vista in `pane read` (turno 2, completa):

```
 test marker ok
─────────────────────────────────────────────────────────────────────────────────────────────
▲ 22:15
(blank x2)
 rispondi esattamente: secondo test
─────────────────────────────────────────────────────────────────────────────────────────────
▲ 22:18
(blank)
 The user wants an exact reply: "secondo test"
 secondo test
─────────────────────────────────────────────────────────────────────────────────────────────
▲ 22:18
```

Dopo integrazione data: `▲ 22:26 · Sep 07, 2026` su ENTRAMBI i marker (user e assistant), divisore full-width, freccia tutte ▲, nessun `▼` residuo. Locale data = sistema (en), come da formattatori Intl pre-esistenti.

## Incidente dischiarato (contenuto, nessuna perdita)

Durante il primo tentativo di riavvio pi ho mandato `/exit` via `herdr pane send-text`: git-bash MSYS l'ha trasformato in `C:/Program Files/Git/exit` → pi NON è uscito; ha interpretato la stringa + l'iniezione bord-aware ("1 messaggi in coda") ed ha eseguito `bord read` sulla board DEFAULT (il pane non ha BORD_SESSION), archiviando il report di mx--9 (21:34:50). NESSUNA PERDITA: `bord read` archivia in `~/.bord/board-history.md` (voce `archived 2026-09-07 22:22:51 by moon3--9064`, testo integrale leggibile lì). Nessun bord report pubblicato dal pi randagio; interrotto con escape+ctrl+c subito dopo. Nota per ast10: mx--9 probabilmente ha anche pokato i suoi destinatari, ma se qualcuno aspettava quel messaggio in coda board, ora è in history.

Lezione operativa (per il rito): per uscire da pi via herdr usare `ctrl+u` + `ctrl+d` (o doppio ctrl+c), MAI testo `/exit` da git-bash senza `MSYS_NO_PATHCONV=1`.

## Rito post-update pi (aggiornamento)

Il file `timestamp-marker.js` è NOSTRO (rev3, commenti italiani): NON esiste nel fork 0.85.1 (verificato: `grep -rn buildTimestampMarker packages/*/src` → nessun match). Ogni update/upgrade di pi CANCELLA la patch live. Dopo un update va riportato a mano dal backup piu' recente (`*.bak-ts1` = versione pre-MDW2 da NON usare cosi' com'è: ha ancora ▼ e marker sopra; ripartire dal .bak-ts1 applicando: freccia ▲, render(width) a 2 righe col divisore, buildTimestampMarker con data sempre, e i 4 call-site di interactive-mode.js invertiti (vedi sezione Modifiche) — un update ripristina anche `interactive-mode.js`.
