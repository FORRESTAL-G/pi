# PRMS-STATE — PR upstream mid-sentence skill+prompt (earendil-works/pi #8457)

Ultimo aggiornamento: turno 1 CHIUSO — PR #9214 APERTA, report bord landed + poke ast9 delivered.
Audit AST--9: `bord sub ast9` timeout 300s (suo turno ancora aperto a budget scaduto) — verdetto pendente;
ast9 leggerà la board al prossimo giro. Nessuna azione bloccante pendente su PRMS.

## Esito

- **PR: https://github.com/earendil-works/pi/pull/9214** — titolo "Invoke skills and prompt templates mid-sentence",
  head `FORRESTAL-G:feat/midsentence-skill-prompt`, stato OPEN (gate auto-close non scattato al momento del check).
- Branch pushato SOLO su fork (remote `fork`); MAI push su origin. Commit: `feat(coding-agent): invoke skills and prompt templates mid-sentence`.

## File toccati (tutti nel commit)

- `packages/coding-agent/src/core/midsentence.ts` (NUOVO): scanner puro `expandMidsentence(text, {skills, templates}, deps)`
  + `buildSkillInvocation` (builder condiviso col nativo → byte-identico garantito).
- `packages/coding-agent/src/core/agent-session.ts`: `_expandMidsentence()` privato + chiamata in prompt()/steer()/followUp()
  PRIMA dei nativi (dentro il blocco expandPromptTemplates in prompt); `_expandSkillCommand` riusa buildSkillInvocation
  (rimossa duplicazione stringa blocco; stripFrontmatter import rimosso).
- `packages/coding-agent/test/midsentence.test.ts` (NUOVO, 30 test unit) + `test/midsentence-agent-session.test.ts` (NUOVO, 10 integrazione).
- `CHANGELOG.md` [Unreleased]/Added + `docs/skills.md` + `docs/prompt-templates.md`.

## Decisione semantica rilevante (documentata)

Il BRIEF diceva "scanner parte dopo il primo newline" ma l'ESEMPIO PR (mandato owner) ha il token
mid-line sulla riga 1 e deve espandersi. Semantica di casa (estensione v1.8 + fork `start === 0`):
**nativo è solo lo slash a position 0** (tutta la riga 1 saltata); mid-line su riga 1 ESPANDE.
Implementato così; test/docs/changelog coerenti. Da segnalare ad AST--9 nel report.

## Test (criterio Windows: zero nuovi fail vs baseline + nuovi verdi)

- Baseline main pulito (host Windows): 82 fail pre-esistenti coding-agent (path POSIX), 2 fail scripts
  (quoting `C:\Program`), fail anche in ai/agent-core/server — tutti PRE-ESISTENTI, documentati sotto.
- Post-implementazione: coding-agent 267 file (2 nuovi), 77 fail (5 in meno: 3 dati modelli stali fissati
  da `npm run generate-models`, 2 flaky concurrent passati) — **zero nuovi**, 2069 passati (baseline 2024 + 40 nuovi + 5 recuperati).
- Test mirati: midsentence 40/40 verdi; skills/prompt-templates/sdk-skills/export-html/retry 132/132 verdi.
- `npm run check` verde (gli errori tsgo zai visti a inizio turno erano cache dati modelli stali: dopo
  `generate-models` scomparsi anche su albero pulito — verificato parkando le modifiche).

## Note ambiente

- node_modules: `npm ci --ignore-scripts` a inizio turno (main da840b621).
- `npm run generate-models` (packages/ai) eseguito per idratare dati: NESSUN file tracked modificato.
- `.agents/` contiene: baseline-ws.log, post-ws.log, post2-ws.log, baseline/post fail lists, script
  baseline-workspaces.sh / coding-agent-test.sh, smoke-midsentence.mjs, pr-body.md, stash-ms/ (patch backup).
- Gate contributor: PR #9214 OPEN al check; se auto-chiusa dal bot è ATTESO, nessun commento di protesta.

## TODO turno prossimo (se AST--9 chiede follow-up)

- Rispondere a review upstream se arrivano; eventuali fix → stesso branch → push fork.
PRMS congedato 05/09 notte: pane chiuso post-audit VERDE. Riaccendibile: pi --session 01a072f4-f196-731e-b3b4-3c7fff673c98 (cwd C:/github/pi-core-fork).
