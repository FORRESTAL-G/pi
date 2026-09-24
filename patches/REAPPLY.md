# REAPPLY — ri-applicare le mod locali dopo un update di pi-coding-agent

Vedi anche: `patches/README` non serve — questo file è la procedura. Indice mod completo:
`C:/github/hv/PI-LOCAL-MODS.md`.

## Caso A — update NON ancora fatto, rollback / clonazione macchina (versione 0.84.2)

Snapshot live completo (dist + nested node_modules + tutti i .bak):

```bash
cd "C:/Users/manu9/AppData/Roaming/npm/node_modules/@earendil-works"
tar -xzf /c/github/pi-snapshots/pi-coding-agent-0.84.2-live-20260924.tgz
```

Fine. È la via più veloce SE la versione resta 0.84.2.

## Caso B — update a versione > 0.84.2: re-splice guidata

Precondizione: fresh install fatta (`npm i -g @earendil-works/pi-coding-agent@X`).
I .bak di riferimento sono andati col vecchio package: i "pristine" ora sono i file
appena installati. Rito per OGNI splice: `cp <file> <file>.bak-<tag>` prima di toccare,
`node --check <file>` dopo, verifica su pane fresco. (Rito MS5: commit 639fd2b9b di
questo repo.)

Ordine:

1. **ms-suite / MOD 1-2** (mid-sentence skill+prompt, verbatim, RAW same-turn)
   Fonte: branch `feat/ms5-verbatim-concat` di QUESTO repo — commit fe24de51e, a90ee83fe,
   9a30a7574, f5d6c8746, 1a1bc670b, 3b48184c3. File: `dist/core/{agent-session,skills,
   prompt-templates}.js(+.d.ts)`, `dist/core/extensions/{runner,types}`.
   Porting: diff dei commit verso la nuova versione (i file cambiano tra release: guida
   al diff, non copia-inciegnna cieca).

2. **mdw1 / MOD 4** (write/edit card collassate con toggle)
   Fonte: `feat/md-render` commit 800ae9867. File: `dist/core/tools/{write,edit}.js`.
   NOTA: `tool-execution.js.bak-mdw1` era fossile (splice non attiva) — NON ri-applicare.

3. **ts1+mdw2 / MOD 5** (marker tempo sotto i messaggi)
   Fonte PRIMARIA: `patches/ts1-mdw2-timestamp-marker.patch` +
   `patches/ts1-mdw2-interactive-mode-wiring.patch` (estratti dal live 0.84.2; il codice
   NON è in nessun commit — mdw2 a06cfbc0d contiene solo brief/report).
   File: `dist/modes/interactive/components/timestamp-marker.js` (nuovo file se non
   esiste: createlo dal patch) + 4 call-site in `interactive-mode.js`.

4. **foot1 / MOD 3** (alt+i toggle footer/status)
   Fonte PRIMARIA: `patches/foot1-keybindings.patch` + `patches/foot1-interactive-mode.patch`
   (anch'esse live-only, nessun commit).
   Gotcha noti: conflitto con reorderDown, herdr non usa alt+frecce (f37a6de agentic-studies).

5. **chrome hr2/hr2b/hr3/hr4 / MOD 6-7** (bordi ' + ', frameIndent, anti-crash larghezza)
   Fonte: commit di questo repo 066ee74f8, e30a72c08, 23c6f0409, d05615441.
   ATTENZIONE ai percorsi: `editor.js` e `tui-main-screen.js` vivono nel TUI nested
   `node_modules/@earendil-works/pi-tui/dist/` (NON in dist/ del package principale);
   `dynamic-border.js` (hr2b) è in `dist/modes/interactive/components/`.
   `markdown.js` hr1: fossile, NON ri-applicare.

6. **supergrok multi-agent / MOD 8**
   ```bash
   cp patches/supergrok/{provider,models}.ts ~/.pi/agent/npm/node_modules/pi-xai-supergrok/
   cp patches/supergrok/{provider,models}.ts ~/.pi/agent/git/github.com/preinpost/pi-xai-supergrok/
   ```
   (entrambe le copie: settings.json le carica tutte e due, l'ultima vince).
   Runbook completo + verifica curl: `C:/github/hv/RUNBOOK-grok-multiagent.md`.

## Checklist verifica finale (pane fresco)

- [ ] `/parola-che-invoke-una-skill` a metà frase → skill si attiva (ms5)
- [ ] alt+i → footer/status collassa (foot1)
- [ ] bordi input/banner a ` + ` (hr2-hr3)
- [ ] righe larghissime non crashano la sessione (hr4)
- [ ] marker tempo sotto i messaggi (mdw2)
- [ ] `/model supergrok/grok-4.20-multi-agent-0309` risponde (supergrok)
- [ ] tool use su grok-4.7 normale intoccato
