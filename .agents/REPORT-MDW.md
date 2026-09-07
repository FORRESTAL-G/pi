# REPORT-MDW — rendering Markdown full-stack + anteprima file collassata

Worker: MDW. Supervisore: ast10. Branch: `feat/md-render` da `origin/main` (da840b621), worktree sporco, nessun commit (commit+push = supervisore).

## D1 — Markdown full-stack su user+assistant

**Esito: già full-stack su origin/main; lavoro reale = verifica + test di resa che lo pina.**

- `UserMessageComponent` (`packages/coding-agent/src/modes/interactive/components/user-message.ts`): passa dal componente `Markdown` del TUI con tema `userMessageBg`/`userMessageText` (il confine visivo utente/assistente è preservato: box con background dedicato) e opzioni `preserveOrderedListMarkers` + `preserveBackslashEscapes`, transform `createMarkdownTransform("user", ...)`.
- `AssistantMessageComponent`: stesso componente `Markdown`, transform `createMarkdownTransform("assistant", ...)` per il testo, `"assistant-thinking"` per il thinking.
- Pipeline condivisa: `packages/tui/src/components/markdown.ts` (marked + strikethrough strict + estensioni LaTeX + highlight). `markdown-transform.ts` è solo il passaggio estensioni.

Cosa certifica il test (`packages/tui/test/markdown.test.ts`, suite `Full-stack message pipeline`): un singolo documento con **heading, bold, italic, strikethrough, inline code, code fence con linguaggio, lista non ordinata, task list aperta/chiusa, blockquote, tabella 2x2, link con fallback URL (no-hyperlinks)** esce dallo stesso `Markdown.render()` con struttura corretta (asserzioni sul testo stripped) e styling applicato (assi ANSI `\x1b[1m` bold, `\x1b[3m` italic, `\x1b[9m` strike, `\x1b[33m` codespan). Nessuna estensione di pipeline necessaria: prima/dopo identici per l'assistant; lo user message era già a valle.

## D2 — Anteprima compressa dei file scritti con toggle

Pattern riusato (niente di nuovo inventato): il flag `expanded` di `ToolExecutionComponent` — toggle globale `ctrl+o` (`app.tools.expand`, default ctrl+o) e, nel codice repo, toggle per-oggetto via mouse (`createResultRegion`/`MouseRegion`, già presente upstream). I renderer ricevono `{ expanded, isPartial }`.

- `packages/coding-agent/src/core/tools/renderers/write.ts`: da settled (`isPartial=false, expanded=false`) la card è **compressa a prescindere**: `write <path>` + `N lines` + snippet prime 3 righe (`WRITE_COLLAPSED_SNIPPET_LINES`) + hint expand. Expanded = contenuto pieno. Durante lo streaming degli arg resta il preview live a 10 righe (vincolo dure: nessuna modifica allo scorrimento live dei caratteri).
- `packages/coding-agent/src/core/tools/renderers/edit.ts`: **prima ignorava `expanded` e mostrava sempre il diff completo**. Ora: collassato = header + stats `+N −M` (`countDiffChanges` sul diff, formato `+<ln> / -<ln>` per riga) + hint; expanded = diff completo leggibile; errori di preview sempre visibili anche collassati.

Nessuna modifica allo streaming editor/output; solo wrapper visivo attorno al risultato della tool call.

## Test (numeri)

- `packages/tui`: markdown.test.ts **82/82** (incluso il nuovo test full-stack).
- `packages/coding-agent`: tool-renderers-collapse.test.ts **3/3** (nuovo: write collassato/espanso, streaming live invariato, edit stats/diff); edit-tool-no-full-redraw.test.ts **3/3** (aggiornato al nuovo contratto: collassato di default, `+10`/`+2` stats, expand mostra il diff, no-full-redraw e ricostruzione da result intatti); tool-execution-component + edit-tool-legacy-input + default-tools-setting + tools-manager **50/50**.
- Pre-esistenti NON miei: 4 fail in tools.test.ts (EACCES/cwd, specifici Windows — riprodotti su origin/main pulito con stash) + i 5 della suite tui segnalati dall'audit (symlink fd, imageFallback OSC8).
- `npm run check` pulito (exit 0, no fix). `npm run build` OK (bundle 51 file, 7.5 MiB).

## Swap live — elenco ESATTO (rito .bak-mdw1)

Live install = `C:/Users/manu9/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist` (0.84.2, renderer INLINE in core/tools/*.js, layout diverso dal 0.85.1). Quindi **splice chirurgico delle funzioni compilate**, non cp integrale:

1. `dist/core/tools/write.js` — sostituita `formatWriteCall` + aggiunta `const WRITE_COLLAPSED_SNIPPET_LINES = 3`. Backup: `dist/core/tools/write.js.bak-mdw1`.
2. `dist/core/tools/edit.js` — sostituita `buildEditCallComponent` (signature +expanded, branch stats/error/diff) + aggiunta `countDiffChanges` + import `keyHint` da keybinding-hints.js + 2 call site con `context.expanded`. Backup: `dist/core/tools/edit.js.bak-mdw1`.
3. `dist/modes/interactive/components/tool-execution.js` — splice MouseRegion tentato e **ROLLBACK immediato dal backup**: la tui bundled del live (0.84.2) non esporta `MouseRegion` e non ha dispatch mouse verso i componenti. Il file live è tornato identico al pre-swap; backup `tool-execution.js.bak-mdw1` lasciato sul disco.

Rollback completo: `cp <file>.bak-mdw1 <file>` per write.js ed edit.js.

## E2E (sessione herdr isolata, ricetta R7)

Sessione `mdwtest` creata via launcher .cmd + explorer (finestra visibile), socket `HERDR_SOCKET_PATH`, pane `w1:p1`, `herdr pane run` pi (dist swappato, banner "0.85.1 available" = 0.84.2 live):

- Messaggio utente con markdown inline + richiesta: resa markdown assistant corretta nel pane (header, bold/italic, fence ```bash, tabella ┌─┬─┐).
- Write di 20 righe: card **collassata** = `write ~\...\demo.md` / `20 lines` / riga01-03 / `... (17 more lines, 20 total, ctrl+o to expand)`.
- Toggle visivo via `send-keys ctrl+o`: pre = card compressa, post = tutte le 20 righe senza hint; secondo ctrl+o = stessa card ricompressa (nessuno scrollback cannibalizzato). File su disco corretto.
- Edit (`riga20`→`FINE`): card collassata = `edit <path>` / `+1 −1 ctrl+o to expand`; ctrl+o = diff completo con context e `-20 riga20` / `+20 FINE`.
- Chiusura: `herdr session stop mdwtest` + `session delete mdwtest`. Sessione default dell'owner mai toccata. Smoke non-regressione: `pi -p "dimmi ciao"` OK col dist nuovo.

## Lezione

Skew repo/live: il fork a 0.85.1 ha i renderer estratti in `core/tools/renderers/*`, il live 0.84.2 li ha inline — un cp integrale dei file 0.85.1 avrebbe trascinato import assenti nel live (`utils/text.js`/`splitBom`). E il splice di feature TUI va precosto dal check delle export della tui bundled del live: `MouseRegion` non esiste in 0.84.2, quindi il toggle per-oggetto col mouse non è backportabile senza bumpare `pi-tui` — resta nel codice repo (dove upstream ce l'ha già) per quando l'owner aggiorna il pacchetto.
