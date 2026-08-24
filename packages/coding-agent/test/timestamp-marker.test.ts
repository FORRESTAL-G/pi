import { describe, expect, test } from "vitest";
import {
	buildTimestampMarker,
	formatTimestampLabel,
	formatTimestampMarker,
	TimestampMarkerComponent,
	timestampMarkerNeedsDate,
} from "../src/modes/interactive/components/timestamp-marker.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// Timestamp costruiti in tempo locale: la regola e il formato usano sempre la TZ locale.
const T = (y: number, m: number, d: number, h: number, min: number, s = 0): number =>
	new Date(y, m, d, h, min, s).getTime();

describe("buildTimestampMarker (rev2: marker per ogni messaggio)", () => {
	test("stesso minuto del messaggio precedente: marker comunque", () => {
		const prev = T(2026, 7, 23, 14, 31, 20);
		const next = T(2026, 7, 23, 14, 31, 50); // +30s, stesso giorno e minuto
		expect(buildTimestampMarker(prev, next)).toMatch(/^▼ \d{2}:\d{2}$/);
	});

	test("gap ampio ma stesso giorno: marker con sola ora", () => {
		const prev = T(2026, 7, 23, 10, 0, 0);
		const next = T(2026, 7, 23, 14, 32, 0);
		const text = buildTimestampMarker(prev, next);
		expect(text).toMatch(/^▼ \d{2}:\d{2}$/);
		expect(text).not.toContain("·");
	});

	test("cambio giorno dal messaggio precedente (anche sotto il minuto): marker con data", () => {
		const prev = T(2026, 7, 23, 23, 59, 30);
		const next = T(2026, 7, 24, 0, 0, 10); // +40s ma giorno diverso
		const text = buildTimestampMarker(prev, next);
		expect(text).toMatch(/^▼ \d{2}:\d{2} · .+2026$/);
	});

	test("primo messaggio della vista di oggi: marker con sola ora", () => {
		const now = T(2026, 7, 23, 9, 0);
		expect(buildTimestampMarker(null, T(2026, 7, 23, 14, 32), now)).toMatch(/^▼ \d{2}:\d{2}$/);
	});

	test("primo messaggio della vista di un giorno passato (sessione ripresa): marker con data", () => {
		const now = T(2026, 7, 24, 9, 0);
		expect(buildTimestampMarker(null, T(2026, 7, 23, 14, 32), now)).toMatch(/^▼ \d{2}:\d{2} · .+2026$/);
	});
});

describe("timestampMarkerNeedsDate (quando mostrare la data)", () => {
	test("stesso giorno del messaggio precedente: solo ora", () => {
		expect(timestampMarkerNeedsDate(T(2026, 7, 23, 10, 0), T(2026, 7, 23, 14, 32))).toBe(false);
	});

	test("giorno diverso dal messaggio precedente: ora e data", () => {
		expect(timestampMarkerNeedsDate(T(2026, 7, 22, 10, 0), T(2026, 7, 23, 14, 32))).toBe(true);
	});

	test("primo messaggio di oggi: solo ora", () => {
		const now = T(2026, 7, 23, 9, 0);
		expect(timestampMarkerNeedsDate(null, T(2026, 7, 23, 14, 32), now)).toBe(false);
	});

	test("primo messaggio di un giorno passato (sessione ripresa): ora e data", () => {
		const now = T(2026, 7, 24, 9, 0);
		expect(timestampMarkerNeedsDate(null, T(2026, 7, 23, 14, 32), now)).toBe(true);
	});
});

describe("formatTimestampMarker / formatTimestampLabel", () => {
	test("formato marker stesso giorno: ▼ HH:MM", () => {
		const text = formatTimestampMarker(T(2026, 7, 23, 14, 32), false);
		expect(text).toMatch(/^▼ \d{2}:\d{2}$/);
		expect(text).not.toContain("·");
	});

	test("formato marker cambio giorno: ▼ HH:MM · <data con anno>", () => {
		const text = formatTimestampMarker(T(2026, 7, 23, 14, 32), true);
		expect(text).toMatch(/^▼ \d{2}:\d{2} · .+2026$/);
	});

	test("etichetta senza freccia (usata dal /tree): HH:MM oppure HH:MM · <data>", () => {
		expect(formatTimestampLabel(T(2026, 7, 23, 14, 32), false)).toMatch(/^\d{2}:\d{2}$/);
		expect(formatTimestampLabel(T(2026, 7, 23, 14, 32), true)).toMatch(/^\d{2}:\d{2} · .+2026$/);
	});
});

describe("TimestampMarkerComponent", () => {
	test("renderizza una sola riga dim con il testo del marker", () => {
		initTheme("dark");
		const text = formatTimestampMarker(T(2026, 7, 23, 14, 32), false);
		const component = new TimestampMarkerComponent(text);
		const lines = component.render(80);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0]!)).toBe(text);
	});

	test("il render non dipende dalla larghezza", () => {
		initTheme("dark");
		const component = new TimestampMarkerComponent(formatTimestampMarker(T(2026, 7, 23, 14, 32), true));
		expect(component.render(20)).toEqual(component.render(120));
	});
});
