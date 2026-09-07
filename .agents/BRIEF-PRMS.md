# BRIEF — PRMS: PR upstream mid-sentence (skill + prompt templates) per earendil-works/pi

Sei il worker **PRMS** (label herdr `prms`). Lavori in `C:/github/pi-core-fork` (clone di
`earendil-works/pi`, monorepo). Mandato owner via AST--9: aprire una **PR completa** che porta
in core pi l'invocazione **mid-sentence** di skill E prompt template, con **richiamo multiplo**,
usando la semantica collaudata di casa (branch locale `feat/ms4-unified`, HEAD `1a1bc67`, +
estensione prompt-midsentence v1.8 nel mirror `C:/github/agentic-studies/mirror/pi-user/`).

## Contratto

1. **Branch nuovo `feat/midsentence-skill-prompt` da `origin/main`** (già fetched, HEAD
   `da840b621`, v0.85.1+unreleased). NON toccare i branch esistenti (feat/ms4-unified ecc. =
   riferimento read-only, sono la nostra installazione VIVA).
2. **MAI push su `origin`** (è upstream, non nostro). Push SOLO sul fork: `gh repo fork
   earendil-works/pi --clone=false` → `git remote add fork https://github.com/FORRESTAL-G/pi.git`
   → push lì.
3. **Semantiche** (da v1.8 di casa, adattate al PR upstream — NIENTE marker/label/`/?`/warning
   NEITHER, restano nella nostra estensione):
   - Confine-di-parola: lo slash scatta SOLO se preceduto da whitespace o newline. `C:/x`,
     `:/x`, `a/b`, `n/d`, `km/h` mai.
   - **Riga 1 intoccata** (zona nativa): lo scanner parte dopo il primo newline. `/skill:name
     args` e `/template args` a inizio input restano ESATTAMENTE come oggi.
   - Args = resto della riga dopo il nome (escluso); il testo dopo il newline resta.
   - Guardia `:`: se dopo il nome c'è `:` il token resta letterale (niente `/skill:foo`
     mid-sentence).
   - Ladder di risoluzione: exact-case vince → case-variant UNIVOCO normalizza → prefisso
     UNIVOCO. Collisione template/skill stesso nome: **vince il template** (documentare).
   - Skill → blocco inline **byte-identico** a `_expandSkillCommand` (`<skill name=... location=
     ...>\nReferences are relative to ...\n\n<body>\n</skill>` + `\n\nargs`).
   - Template → body inline con args sostituiti (**riusa** `parseCommandArgs`/`substituteArgs`
     di `src/core/prompt-templates.ts`; output identico a `expandPromptTemplate` riga-1).
   - **Multi-invocazione**: tutti i token in UNA passata, ordine di posizione, output MAI
     riscansionato (single-pass).
   - Fail-soft silente: nome non risolvibile → testo letterale, zero errori.
   - Punti di allaccio: `prompt()` (rispetta l'opzione `expandPromptTemplates` come i nativi),
     `steer()`, `followUp()` — lo scanner gira PRIMA dei nativi (così il body espanso da un
     nativo in riga 1 non viene riscansionato).
4. **Architettura**: funzione pura in un NUOVO file piccolo `src/core/midsentence.ts` (es.
   `expandMidsentence(text, {skills, templates}, deps) → string`) — tiene il diff di skills.ts/
   agent-session.ts minimale (filosofia repo: "core minimal", AGENTS.md vincola stile). In
   agent-session: un metodo privato che raccoglie skills+templates e chiama il puro, nei 3 punti.
5. **Test** (vitest, `packages/coding-agent/test/`): unit dello scanner (trigger mid-sentence,
   non-trigger path/frazioni, riga-1 intatta, args-EOL, multilinea preservata, token multipli
   stessa riga/righe diverse, ladder ci, guardia `:`, confine fine-nome, fail-soft, no-ricorsione,
   disable-model-invocation espandibile, collisione template>skill) + integrazione AgentSession
   con streamFn mock (prompt/steer/followUp portano i blocchi al modello; nativo riga-1 invariato;
   expandPromptTemplates:false disattiva). Riusa adatta i nostri 745 righe di test dai branch
   locali (reference-only). **Prima** di toccare codice: `npm ci` a root se serve + `npm test`
   su main pulito, registra il conteggio baseline (dev'essere tutto verde PRIMA delle modifiche).
6. **Docs/changelog**: guarda le PR recenti mergiate (gh pr list --state merged --limit 10): se
   aggiornano CHANGELOG [Unreleased] / docs, fai lo stesso (stile loro). AGENTS.md della root
   vale per stile codice e prosa: niente emoji, prosa tecnica secca, "problema → esempio →
   soluzione".
7. **Testo PR** (draft qui sotto, rifinisci mantenendo lo stile AGENTS.md; titolo e body in
   inglese; riferisce l'issue #8457; **solo esempio skill** nel body + nota finale per i prompt,
   come da mandato owner):

   Title: `Invoke skills and prompt templates mid-sentence`

   Body (struttura):
   - Problem: `/skill:name args` and `/template args` only expand at the start of the input
     (#8457). Skills with `disable-model-invocation: true` cannot be invoked at all unless the
     token is at position 0 (the model can't discover them). Extensions cannot fix this: the
     extension API exposes no way to read loaded skills (only to contribute paths via
     `resources_discover`), so an extension would have to duplicate the skill loader and drift.
   - Example (SKILL ONLY, per mandato):
     ```
     User input:
       can you check the build please run /verify-build on the current branch and summarize

     Model receives (at the invocation site):
       can you check the build please run <skill name="verify-build" location="...">
       References are relative to ...

       (skill body)
       </skill>

        on the current branch and summarize
     ```
     Multiple tokens in one message all expand, in position order.
   - Solution: single-pass scanner over lines 2+, word-boundary guarded, expansion byte-identical
     to the native line-1 paths, fail-soft (unresolvable names stay literal). Wired into
     prompt/steer/followUp before the native expansions.
   - Closing note (mandato): *The same works for prompt templates: `/templatename args` anywhere
     after the first line expands the template body with the arguments, identical to line-1
     behavior. If a skill and a template share a name, the template wins.*
8. **Apertura PR**: `gh pr create --repo earendil-works/pi --head FORRESTAL-G:feat/midsentence-skill-prompt
   --title ... --body-file ...`. NOTA GATE: le PR di contributori nuovi vengono AUTO-CHIUSE dal
   loro bot — è ATTESO e ok (l'issue #8457 è nella stessa condizione; i maintainer rivedono
   ogni giorno). NON fare commenti di protesta. Aperta la PR: riporta il numero.
9. **Igiene**: timeout SEMPRE su comandi sperimentali (lezione 23h); nessun segreto; il tuo
   fork GitHub è pubblico di default — il repo upstream è open, ok. Fine turno = `BORD_SESSION=prms
   cmd //c bord report "..."` + poke alla label `ast9`. Stato intermedio su disco in
   `C:/github/pi-core-fork/.agents/PRMS-STATE.md` (un restart dev'essere un non-evento).

## Criteri di fine

- Baseline main verde registrata → implementazione → tutti i test verdi (baseline + nuovi).
- Branch pushed sul fork `FORRESTAL-G/pi`, PR aperta su earendil-works/pi con il testo approvato.
- Report bord DONE con: numero PR, conteggi test, file toccati, dubbi. AST--9 audita prima
  che tu chiuda il turno.
