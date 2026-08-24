import { describe, expect, test } from "vitest";
import { ThinkingModalComponent } from "../src/modes/interactive/components/thinking-modal.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// Finto TUI: serve solo terminal.rows per il calcolo della viewport di scroll.
const fakeTui = {
	terminal: { rows: 30, columns: 100 },
	requestRender: () => {},
} as unknown as ConstructorParameters<typeof ThinkingModalComponent>[2];

function makeModal(blocks: string[], onClose: () => void = () => {}): ThinkingModalComponent {
	return new ThinkingModalComponent(blocks, new Date(2026, 7, 23, 14, 32).getTime(), fakeTui, onClose);
}

describe("ThinkingModalComponent render", () => {
	test("header con ora, contatore blocchi e hints, contenuto dim", () => {
		initTheme("dark");
		const modal = makeModal(["primo blocco thinking", "secondo blocco thinking"]);
		const lines = modal.render(60).map(stripAnsi);

		expect(lines[1]).toMatch(/thinking · \d{2}:\d{2} · 1\/2/);
		expect(lines).toContain("primo blocco thinking");
		expect(lines.some((l) => l.includes("esc close"))).toBe(true);
	});

	test("un solo blocco: nessun contatore", () => {
		initTheme("dark");
		const lines = makeModal(["unico blocco"]).render(60).map(stripAnsi);
		expect(lines[1]).toMatch(/thinking · \d{2}:\d{2}\s*$/);
		expect(lines[1]).not.toContain("/");
	});

	test("il corpo lungo viene tagliato alla viewport (scroll non visibile interamente)", () => {
		initTheme("dark");
		const longBlock = `INIZIO ${"x".repeat(3000)} FINE`;
		const lines = makeModal([longBlock]).render(60).map(stripAnsi);
		// viewport a 30 righe di terminale => 15 righe corpo + 4 di cornice/header/footer
		expect(lines.length).toBeLessThanOrEqual(15 + 4);
		expect(lines.some((l) => l.includes("INIZIO"))).toBe(true);
		expect(lines.some((l) => l.includes("FINE"))).toBe(false);
	});
});

describe("ThinkingModalComponent input", () => {
	test("ESC raw chiude sempre", () => {
		initTheme("dark");
		let closed = 0;
		const modal = makeModal(["blocco"], () => closed++);
		modal.render(60);
		modal.handleInput("\x1b");
		expect(closed).toBe(1);
	});

	test("frecce scrollano il corpo e PgDn salta di pagina", () => {
		initTheme("dark");
		const longBlock = `INIZIO ${"x".repeat(3000)} FINE`;
		const modal = makeModal([longBlock]);
		modal.render(60);
		// 15 righe visibili (rows 30 / 2): scroll manuale riga per riga
		modal.handleInput("\x1b[B"); // cursorDown (sequenza CSI)
		modal.handleInput("\x1b[B");
		let lines = modal.render(60).map(stripAnsi);
		expect(lines.some((l) => l.includes("INIZIO"))).toBe(false);

		// pageUp riporta in cima
		modal.handleInput("\x1b[5~"); // PgUp
		lines = modal.render(60).map(stripAnsi);
		expect(lines.some((l) => l.includes("INIZIO"))).toBe(true);
	});

	test("frecce sx/dx navigano tra blocchi e azzerano lo scroll", () => {
		initTheme("dark");
		const longFirst = `BLOCCO1 ${"x".repeat(3000)}`;
		const modal = makeModal([longFirst, "secondo blocco"]);
		modal.render(60);
		modal.handleInput("\x1b[B"); // scrolla un po' il primo blocco
		modal.handleInput("\x1b[C"); // cursorRight -> blocco 2
		const lines = modal.render(60).map(stripAnsi);
		expect(lines[1]).toMatch(/2\/2/);
		expect(lines).toContain("secondo blocco");
	});

	test("navigazione oltre i limiti e' no-op", () => {
		initTheme("dark");
		const modal = makeModal(["unico"]);
		modal.render(60);
		modal.handleInput("\x1b[C"); // oltre l'ultimo
		modal.handleInput("\x1b[D"); // prima del primo
		const lines = modal.render(60).map(stripAnsi);
		expect(lines).toContain("unico");
	});
});
