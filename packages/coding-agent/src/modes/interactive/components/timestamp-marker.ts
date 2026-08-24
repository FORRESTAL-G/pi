import type { Component } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

// Formattatori Intl condivisi: costosi da creare, localizzati con locale di sistema e TZ locale.
let timeFormatter: Intl.DateTimeFormat | undefined;
let dateFormatter: Intl.DateTimeFormat | undefined;

function getTimeFormatter(): Intl.DateTimeFormat {
	timeFormatter ??= new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	return timeFormatter;
}

function getDateFormatter(): Intl.DateTimeFormat {
	dateFormatter ??= new Intl.DateTimeFormat(undefined, {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
	return dateFormatter;
}

/** Chiave del giorno locale (anno-mese-giorno) per confronti di cambio giorno. */
function localDayKey(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * La data compare nel marker solo quando serve disambiguare: giorno diverso dal
 * messaggio precedente, oppure — per il primo messaggio della vista, es. sessione
 * ripresa, o per le etichette per-nodo del /tree — giorno diverso da oggi.
 */
export function timestampMarkerNeedsDate(previousTs: number | null, ts: number, now: number = Date.now()): boolean {
	if (previousTs !== null) return localDayKey(previousTs) !== localDayKey(ts);
	return localDayKey(ts) !== localDayKey(now);
}

/** Formatta solo l'ora locale `HH:MM` (usata anche dall'header della modale thinking). */
export function formatLocalTime(ts: number): string {
	return getTimeFormatter().format(new Date(ts));
}

/**
 * Etichetta temporale inline senza freccia: `HH:MM` oppure `HH:MM · GG MMM AAAA`.
 * Usata dal /tree; il marker del transcript aggiunge la freccia `▼`.
 */
export function formatTimestampLabel(ts: number, withDate: boolean): string {
	const time = getTimeFormatter().format(new Date(ts));
	if (!withDate) return time;
	return `${time} · ${getDateFormatter().format(new Date(ts))}`;
}

/** Formatta il testo del marker: `▼ HH:MM` oppure `▼ HH:MM · GG MMM AAAA`. */
export function formatTimestampMarker(ts: number, withDate: boolean): string {
	return `▼ ${formatTimestampLabel(ts, withDate)}`;
}

/**
 * Testo del marker rev2: OGNI messaggio eleggibile (user, assistant, custom
 * visibile) ha il proprio marker; il timestamp del messaggio precedente serve
 * solo a decidere se aggiungere la data al cambio giorno.
 */
export function buildTimestampMarker(previousTs: number | null, ts: number, now: number = Date.now()): string {
	return formatTimestampMarker(ts, timestampMarkerNeedsDate(previousTs, ts, now));
}

/**
 * Riga marker temporale dim appesa sopra un messaggio.
 * La freccia ▼ indica che il timestamp è del messaggio sottostante.
 */
export class TimestampMarkerComponent implements Component {
	private readonly text: string;

	constructor(text: string) {
		this.text = text;
	}

	invalidate(): void {
		// Nessuno stato cacheato: il testo è immutabile.
	}

	render(_width: number): string[] {
		return [theme.fg("dim", this.text)];
	}
}
