# REPORT-MS5 — splice live 0.84.2 (rito bak-ms5, 16/09, ast11)

## Cosa è live
Splice chirurgico su `dist/core/` del pi installato (npm global, 0.84.2):
- `prompt-templates.js`: append del blocco MS5 compilato (MIDSENCE_*_RE + resolvePromptTemplate + expandPromptMidsentence) dal fork dist.
- `agent-session.js`: 8 edit — import; collection `promptBlockMessages` dopo `_expandSkillCommand` e prima di `expandPromptTemplate`; streaming merged-blocks; postUser prompt loop; anti-doppio estensione by-name (`corePromptNames`); steer/followUp con merge+sort; metodo `_collectPromptMidsentence`.
- Backup: `agent-session.js.bak-ms5`, `prompt-templates.js.bak-ms5` (stato ms3/v1.8 pre-splice).

## RITO POST-UPDATE PI (se npm sovrascrive dist)
1. Ricompila il fork: `cd packages/coding-agent && npm run build` (nota: fallisce in coda su shx/chmod Windows — l'emit di dist/core è comunque completo e valido: `node --check`).
2. Ri-applica lo splice identico (questo file = procedura; diff di riferimento: commit `3b48184c3` su feat/ms5-verbatim-concat).
3. Verifica funzionale: creare `~/.pi/agent/prompts/test-ms5.md` (body: "RISPONDI SOLO CON: MS5-BODY-RICEVUTO (e cita l ultima parola del mio messaggio)"), poi `pi -p "Ciao bella. /test-ms5 e poi altre cose, multi parola"` → atteso "MS5-BODY-RICEVUTO — parola". Verifica jsonl sessione: user-msg verbatim (no marker) + body STESSO SECONDO. Rimuovere il template di prova.
4. Ripeti gli altri riti (ms4 v1.8 su skills.js, mdw su write/edit, ts1) — vedi REPORT-MDW/HANDOFF agentic-studies.

## Verifica 16/09 (fatta)
- node --check OK su entrambi i file live.
- One-shot sopra: pass (jsonl = contratto, stesso secondo, verbatim + body).
