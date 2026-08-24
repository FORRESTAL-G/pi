import type { Component } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/** Soglia minima (ms) tra due messaggi perché appaia un marker temporale. */
export const TIMESTAMP_MARKER_GAP_MS = 60_000;

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
 * Regola anti-rumore: il marker appare prima di un messaggio se
 * (a) è il primo renderizzato della vista, oppure
 * (b) sono passati ≥ TIMESTAMP_MARKER_GAP_MS dal messaggio precedente, oppure
 * (c) cambia il giorno locale.
 */
export function shouldShowTimestampMarker(previousTs: number | null, ts: number): boolean {
	if (previousTs === null) return true;
	if (ts - previousTs >= TIMESTAMP_MARKER_GAP_MS) return true;
	return localDayKey(previousTs) !== localDayKey(ts);
}

/**
 * La data compare nel marker solo quando serve disambiguare: giorno diverso dal
 * messaggio precedente, oppure — per il primo messaggio della vista, es. sessione
 * ripresa — giorno diverso da oggi.
 */
export function timestampMarkerNeedsDate(previousTs: number | null, ts: number, now: number = Date.now()): boolean {
	if (previousTs !== null) return localDayKey(previousTs) !== localDayKey(ts);
	return localDayKey(ts) !== localDayKey(now);
}

/** Formatta solo l'ora locale `HH:MM` (usata anche dall'header della modale thinking). */
export function formatLocalTime(ts: number): string {
	return getTimeFormatter().format(new Date(ts));
}

/** Formatta il testo del marker: `▼ HH:MM` oppure `▼ HH:MM · GG MMM AAAA`. */
export function formatTimestampMarker(ts: number, withDate: boolean): string {
	const time = getTimeFormatter().format(new Date(ts));
	if (!withDate) return `▼ ${time}`;
	return `▼ ${time} · ${getDateFormatter().format(new Date(ts))}`;
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
