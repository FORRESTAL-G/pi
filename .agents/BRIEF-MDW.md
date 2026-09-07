# BRIEF — MDW: rendering Markdown full-stack (user+assistant) + anteprima file scrivibili collassata

> Supervisore: `ast10` (pane wM:pP). Worker: `MDW`, BORD_SESSION=`mdw`.
> Repo: `C:/github/pi-core-fork` (fork FORRESTAL-G di earendil-works/pi). Mandato owner
> 07/09, in parallelo al lavoro LN-W3 (gx — NON toccare quel repo).
> NOTA OWNER VERBATIM: «vorrei modificare il mio herdr locale per permettere di passare
> il rendering di pi, che a sua volta va modificato, per poter supportare full stack la
> formattazione del testo generato dall'ai o scritto dall'umano, quindi in entrambi i
> tipi di oggetti messaggio, dicevo RENDERING MARKDOWN. Per quando scrive i file invece
> vorrei l'anteprima compressa a prescindere con un toggle per aprirli e chiuderli,
> niente modifiche profonde allo scorrimento live dei caratteri, solo wrapper visivo.»

## Verdetto supervisore su herdr (NON discutere, già comunicato all'owner)

herdr locale = binario standalone compilato (`AppData/Local/Programs/Herdr/bin/herdr`,
releases in `~/.herdr/packages/standalone/`), NESSUN sorgente sul disco → il lato herdr
NON si tocca. I panes herdr sono terminali (ConPTY passthrough): il rendering avviene
TUTTO in pi, che disegna nel pane. Il tuo lavoro = solo lato pi. Se durante i test
emerge che qualche vista pi degrada dentro herdr mentre in standalone funziona →
reportalo nel bord report (non "riparare" herdr).

## Missione (2 deliverable, fork branch)

Parti da branch fresco su origin/main: `feat/md-render` (MAI committare né pushare: commit+push
fa il supervisore a fine audit — lavora e lascia il worktree sporco).

### D1 — Markdown full-stack su ENTRAMBI i tipi di messaggio

Entry points (verifica col codice reale, questa è la mappa di partenza):
- `packages/coding-agent/src/modes/interactive/components/user-message.ts`
- `packages/coding-agent/src/modes/interactive/components/assistant-message.ts`
- pipeline condivisa: `markdown-transform.ts` (+ componenti in `packages/tui/src/components/`
  del framework TUI).
Stato attuale (verifica!): l'assistantmessage renderizza markdown; lo user message
molto probabilmente è testo verbatim. Obiettivo: ENTRAMBI gli oggetti messaggio passano
dalla STESSA pipeline markdown "full": headers, bold/italic/strike, inline code, code
fences con linguaggio, liste (anche task), tabelle, blockquote, link (label cliccabile
o visibile se il TUI non supporta link). Se la pipeline copre già tutto per l'assistant,
il lavoro reale è portare lo user message sulla stessa pipeline SENZA rompere
l'evidenza visiva del confine utente/assistente (mantieni il prefisso/pattern che
distingue lo user message, es. colore/bordo come oggi). Riusa, non riscrivere: la
pipeline markdown esiste, si estende solo se manca copertura (prima verifica COSA
manca con un test di resa, poi decide se serve estendere).

### D2 — Anteprima compressa dei FILE SCRITTI con toggle

- Quando un tool scrive/crea file (write/edit; vedi `tool-execution.ts`, `diff.ts`,
  `visual-truncate.ts`): rendering DI DEFAULT compresso = riga/e di anteprima (path +
  stats tipo +N/−M o n righe + primo snippet breve), col contenuto completo COLLPASABILE
  con toggle (apri/chiudi la STESSA card, nessun scrollback cannibalizzato).
- Se esiste già infrastruttura di collasso (es. ctrl+O globale o per-componente):
  riUsala e rendi il toggle disponibile a livello singolo oggetto. Pattern di casa
  da studiare (già fatto in questo fork): `registerMessageRenderer` + custom-message
  collassabile (cerca "registerMessageRenderer" in src/core/extensions/).
- VINCOLO DURE: NESSUNA modifica allo scorrimento live dei caratteri (streaming
  dell'editor/output) — solo wrapper visivo attorno al risultato. Il diff deve restare
  leggibile quando espanso.

### Verifica (tutta obbligatoria prima del report)

1. Test suite del repo per i componenti toccati (scopri il runner: vitest; lancia solo
   i file correlati + la suite tui se c'è). Numeri nel report.
2. Build: `npm run build` (o il task del workspace giusto — guarda package.json) →
   OTP elenco file dist prodotti.
3. SWAP LIVE col rito (precedente ms4, documentato in C:/github/agentic-studies/HANDOFF.md):
   backup `.bak-mdw1` dei file dist che sostituisci → cp dei nuovi → annota l'elenco
   ESATTO dei file swappati nel report (serve il rito post-update pi).
4. E2E in sessione herdr ISOLATA (ricetta R7 della skill herdr-control:
   `herdr --session mdwtest` + launcher .cmd via explorer per finestra visibile, oppure
   headless con `HERDR_SOCKET_PATH`): dentro un pane di quella sessione spawna pi nuovo
   (usa il dist swappato), mandagli un messaggio utente con markdown (grasso, tabella,
   code fence) e fai scrivere un file piccolo → `herdr pane read` per verificare resa
   compressa + toggle (il toggle va verificato visivamente: fai lo screenshot testuale
   pre/post invio della chiave toggle via `send-keys`) → `herdr session stop mdwtest`
   (uccide SOLO la sessione di test).
5. Smoke di non-regressione: la sessione corrente dell'owner NON si tocca; verifica che
   un `pi -p "dimmi ciao"` headless funzioni col dist nuovo.

## Regole dure

- MAI committare / pushare / toccare remote (audit + commit = supervisore).
- MAI chiudere pane/tab/workspace herdr esistenti; solo la sessione `mdwtest` si crea e si stoppa.
- Timeout SEMPRE sui comandi sperimentali (lezione 23h).
- La live install tocca SOLO i file dist necessari, con backup .bak-mdw1 uno-a-uno.
- Segreti: nessuno in questo lavoro. Se nel repo capita un file con credenziali di test
  preesistente: non rinominare, non toccare.

## Comunicazione

`BORD_SESSION=mdw cmd //c bord report "…"` (board default) — report finale DONE con
`--poke ast10`. Report = D1 cosa coperto dalla pipeline (prima/dopo), D2 pattern di
collasso riusato, test (numeri), file dist swappati (elenco esatto), esito E2E, dubbi.
Se il contesto stringe: PARTIAL onesto (D1 e D2 sono consegnabili separati).
