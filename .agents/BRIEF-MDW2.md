# BRIEF — MDW-2: marker tempo SOTTO al messaggio (divisore + freccia ▲)

> Supervisore: `ast10`. Worker: MDW (sessione ripresa, stesso contesto skew 0.84.2).
> Richiesta owner VERBATIM: i marker «▼ 22:04» stanno sopra i messaggi, li vuole SOTTO:
> «una prima riga di divisore, tipo ----, basta che si adatta alla pagina, e poi a seguire
> il marker con la data, l'ora e tutto quello che già abbiamo, e la freccia invertita,
> invece di puntare in basso deve puntare in alto. E' tutto qui.»

## Stato delle cose (verificato dal supervisore)

- Il marker vive in `dist/modes/interactive/components/timestamp-marker.js` del LIVE
  (0.84.2) — codice NOSTRO (commenti italiani, "rev2"), patch mai mergesata: nel fork
  0.85.1 il file NON esiste (verificato). Quindi: modifica SOLO live-install, documentata
  nel rito; il fork non si tocca (non ha la feature da modificare — verifica comunque con
  grep buildTimestampMarker e nota nel report).
- Il componente ha `render(_width)` → la larghezza per il divisore c'è già.

## Modifica (live 0.84.2, rito .bak-ts1 per OGNI file toccato)

1. `timestamp-marker.js`:
   - `formatTimestampMarker`: `▼` → `▲` (ora punta al messaggio SOPRA).
   - `TimestampMarkerComponent.render(width)`: ritorna DUE righe: prima il divisore
     (─ ripetuto a width, theme dim — o il tono più attenuato disponibile) poi il testo
     del marker (dim). Il divisore si ADATTA alla larghezza reale del riquadro.
2. CALL-SITE: trova chi inserisce `TimestampMarkerComponent` (grep TimestampMarkerComponent
   / buildTimestampMarker in dist/modes/interactive) e SPOSTA l'inserimento DOPO il
   componente del messaggio (oggi è sopra). Attenzione alla semantica di
   `previousTs` per il cambio-giorno: resta riferita all'ordine temporale dei messaggi,
   cambia solo la posizione visiva. Se il call-site costruisce marker PRIMA di pushare il
   messaggio, inverti l'ordine di push.
3. Verifica live (sessione herdr isolata R7 come la volta scorsa, oppure il metodo che
   preferisci MAI sulla default): pi fresco col dist patchato → manda un messaggio e
   falle rispondere → `pane read`: divisore + `▲ HH:MM` SOTTO il messaggio, sopra il
   successivo; frecce tutte ▲; divisore full-width. Screenshot testuale nel report.
4. Regole: backup .bak-ts1 uno-a-uno; MAI commit; timeout sui comandi; non toccare la
   sessione default; gli altri file .bak-mdw1 NON si toccano.
5. Report: file toccati (esatto), come funziona il call-site prima/dopo, verifica E2E,
   aggiornamento del rito post-update (nota su timestamp-marker: file nostro, vive solo
   nel live — va riportato a mano dopo update pi).
