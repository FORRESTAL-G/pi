# BRIEF — MS5: consegna prompt mid-sentence verbatim + body concatenato (core pi)

Sei **MS5**, worker di **ast11** (supervisore, wM:pW). Repo: **C:/github/pi-core-fork**.
Base: branch **feat/ms4-unified** (`1a1bc67`). Crea branch **feat/ms5-verbatim-concat**.
Report: `BORD_SESSION=ms5 cmd //c bord report "<testo>" --poke ast11` (fire-and-forget).
NON fare bord read. Report finale = evidenza + diff + come verificare. Entro 60 min o PARTIAL.

## DESIGN OWNER (vincolante, dettato a voce 16/09 e su bord)
Il messaggio utente arriva **VERBATIM**: pre-testo + trigger `/nome` + args, esattamente come
digitato — ZERO riscritture, ZERO marker inline, ZERO sostituzioni nel testo.
SUBITO DOPO, **nello stesso turno**, arriva il body del template/prompt COSÌ COM'È
(placeholder NON sostituiti: gli args vivono nel messaggio utente e il modello li legge lì).
= la semantica che le skill GIÀ hanno nel core (blocco skill + contenuto, un turno): MS5
allinea i prompt, non inventa. Precedente corretto: la consegna dell'8/09 (custom-message
stesso turno, `customType: prompt-midsentence`).

## BUG (evidenze jsonl sessione ast11, file `~/.pi/agent/sessions/--C--github-agentic-studies--/2026-09-08T02-02-59-690Z_01a07ec1-*.jsonl`)
- 08/09 23:27:24Z: trigger consegnato con marker + custom-message body STESSO SECONDO (corretto).
- 16/09 09:55:50Z: template arrivato come user-message SEPARATA con placeholder `${@:...}` RAW.
- 16/09 09:56:34Z: args arrivati come ALTRA user-message (+44s), a-capo hard preservati.
- Il percorso core di oggi SPEZZA (template | args) e sostituisce; quello estensione dell'8/09 no.
- Difetto noto: `substituteArgs` core perde args senza placeholder espliciti (header di
  `prompt-args-uniform.ts` in ~/.pi/agent/extensions — da NON usare come modello: è wrapper).

## CONTRATTO MS5 (nel percorso mid-sentence dei PROMPT; le skill restano com'ericano v1.8)
1. testo utente: nessuna trasformazione (niente marker `[→ prompt: ...]`, niente normalizzazioni
   visibili — anche un nome parziale-univoco resta scritto com'è (nessuna normalizzazione nel testo del modello).
2. body del template: messaggio adiacente immediato, stesso turno (mecanismo esistente
   "separate message" della linea ms: a90ee83fe), content = template grezzo, senza sostituzioni
   ($@, $ARGUMENTS, $1..$9, ${...}, ${@:...}: NESSUNA viene toccata).
3. args = tutto ciò che segue il trigger fino a fine input, multi-riga inclusa: restano SOLO
   nel messaggio utente verbatim.
4. trigger non risolvibile (nome inesistente): testo intatto + warning UI come oggi (fail-soft).
5. FUORI SCOPO (comportamento attuale INVARIATO): comandi slash a posizione 0 nativi, skill
   mid-sentence (v1.8), case-insensitive univoco, tutto il resto del core.
6. Il core deve essere AUTOSUFFICIENTE: correttezza NON dipendente da
   `~/.pi/agent/extensions/prompt-midsentence.ts` (l'estensione resta installata ma il core
   con estensione disabilitata deve già comportarsi secondo questo contratto; l'estensione
   vedrà il trigger già gestito e tacerà — hook input: nessun doppio body).

## DOVE METTERE LE MANI (punti di partenza, non dogma)
- `packages/coding-agent/src/core/agent-session.ts` (`_expandSkillCommand` e il percorso
  prompt-templates), `src/core/skills.ts` / patch ms4 (vedi `git log feat/ms4-unified`),
  `src/core/prompt-templates.ts` (substituteArgs — per il percorso mid-sentence NON va invocata).
- La linea ms ha già "emit body as separate message" (`a90ee83fe`) e marker PRE (`f5d6c8746`):
  il marker inline per i PROMPT va ELIMINATO dal testo utente (resta eventualmente come UI-only
  se già esiste un canale di display separato — il jsonl del modello non deve contenerlo).

## TEST (minimi ma veri, vitest — vedi test esistenti della linea ms)
- input "ciao MIO_TRIGGER e poi altre cose\nseconda riga" con template "BODY": user message
  = input INALTERATO (byte-per-byte, newline inclusi); messaggio successivo stesso turno = "BODY";
  nessun terzo messaggio; nessuna sostituzione.
- args multi-riga interamente nel messaggio utente.
- template inesistente → testo intatto + warning (stato attuale).
- posizione-0 e skill mid-sentence: test esistenti VERDI (non regressione).
- Suite nota: alcuni fallimenti PRE-ESISTENTI su main (agent-session-concurrent, config,
  experimental-*) — confronta con base prima di dichiarare guasti (lezione PRMS).

## CONSEGNA
- Commit su branch `feat/ms5-verbatim-concat`, push SOLO su remote `fork` (FORRESTAL-G/pi).
  MAI `origin`/upstream. Messaggi stile linea ms (feat(ms5): ...).
- bord report finale (BORD_SESSION=ms5): hash commit, diff --stat, output test, ISTRUKTIONI
  di verifica manuale (build + repro con un template di prova). --poke ast11.
- NOT in scope: splice sul pi live 0.84.2 (rito separato post-ok owner), deploy npm.

## VINCOLI
- MAI heredoc/cat<<EOF per scrivere file: usa edit tool. Timeout (15-60s) su comandi
  sperimentali; `pi-test.sh`/`test.sh` esistono in root per il loop test.
- Nessun segreto in repo/log. Un restart = non-evento. In blocco → PARTIAL onesto su bord.
