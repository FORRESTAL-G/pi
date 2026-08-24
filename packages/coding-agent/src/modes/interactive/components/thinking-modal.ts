import {
	type Component,
	type Focusable,
	getKeybindings,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { formatLocalTime } from "./timestamp-marker.ts";

/** Righe di corpo visibili nella modale: occupa al massimo ~ metà schermo, minimo 4. */
function bodyViewportHeight(termRows: number): number {
	return Math.max(4, Math.min(Math.floor(termRows / 2), 30));
}

/**
 * Modale read-only che ispeziona i blocchi thinking di un messaggio assistant.
 *
 * Contesto: con thinking nascosto (ctrl+t) il transcript mostra solo l'etichetta
 * "Thinking...", ma il body vive integro in `message.content` (memoria + sessione):
 * questa modale lo rivela a posteriori senza toccare il transcript. Il focus è
 * catturato dall'overlay, quindi ESC arriva qui e chiude SEMPRE, senza side effect.
 *
 * Input: frecce/PgUp/PgDn scrollano il blocco corrente; frecce sx/dx navigano tra
 * i blocchi (se piu' di uno); ESC (o qualsiasi binding cancel/interrupt) chiude.
 */
export class ThinkingModalComponent implements Component, Focusable {
	private readonly blocks: readonly string[];
	private readonly timestampMs: number;
	private readonly tui: TUI;
	private readonly onClose: () => void;
	private readonly _focused = false;

	private blockIndex = 0;
	private scrollTop = 0;
	/** Righe wrapped del blocco corrente alla larghezza dell'ultimo render (cache condivisa con lo scroll). */
	private wrappedLines: string[] = [];
	private wrappedViewport = 0;

	constructor(blocks: readonly string[], timestampMs: number, tui: TUI, onClose: () => void) {
		this.blocks = blocks;
		this.timestampMs = timestampMs;
		this.tui = tui;
		this.onClose = onClose;
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(_value: boolean) {
		// Nessuno stato dipende dal focus: il rendering e' identico.
	}

	invalidate(): void {
		// Nessuno stato cacheato: le righe sono ricalcolate a ogni render.
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		// ESC chiude sempre (requisito: nessuna azione distruttiva raggiungibile dalla modale).
		if (keyData === "\x1b" || kb.matches(keyData, "tui.select.cancel") || kb.matches(keyData, "app.interrupt")) {
			this.onClose();
			return;
		}
		if (kb.matches(keyData, "tui.editor.pageUp")) {
			this.scrollBy(-bodyViewportHeight(this.tui.terminal.rows));
			return;
		}
		if (kb.matches(keyData, "tui.editor.pageDown")) {
			this.scrollBy(bodyViewportHeight(this.tui.terminal.rows));
			return;
		}
		if (kb.matches(keyData, "tui.editor.cursorUp")) {
			this.scrollBy(-1);
			return;
		}
		if (kb.matches(keyData, "tui.editor.cursorDown")) {
			this.scrollBy(1);
			return;
		}
		if (kb.matches(keyData, "tui.editor.cursorLeft")) {
			this.switchBlock(this.blockIndex - 1);
			return;
		}
		if (kb.matches(keyData, "tui.editor.cursorRight")) {
			this.switchBlock(this.blockIndex + 1);
			return;
		}
	}

	private scrollBy(delta: number): void {
		const maxScroll = Math.max(0, this.wrappedLines.length - this.wrappedViewport);
		this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop + delta));
	}

	private switchBlock(index: number): void {
		if (index < 0 || index >= this.blocks.length || index === this.blockIndex) return;
		this.blockIndex = index;
		this.scrollTop = 0;
		this.wrappedLines = [];
		this.wrappedViewport = 0;
	}

	render(width: number): string[] {
		const maxWidth = Math.max(10, width - 2);
		this.wrappedLines = wrapTextWithAnsi(this.blocks[this.blockIndex] ?? "", maxWidth);
		this.wrappedViewport = bodyViewportHeight(this.tui.terminal.rows);
		const maxScroll = Math.max(0, this.wrappedLines.length - this.wrappedViewport);
		this.scrollTop = Math.min(this.scrollTop, maxScroll);

		const dim = (text: string) => theme.fg("dim", text);
		const lines: string[] = [];
		lines.push(dim("─".repeat(width)));

		const blockCounter = this.blocks.length > 1 ? ` · ${this.blockIndex + 1}/${this.blocks.length}` : "";
		const header = ` thinking · ${formatLocalTime(this.timestampMs)}${blockCounter} `;
		lines.push(dim(truncateToWidth(header, maxWidth)));

		for (let i = this.scrollTop; i < Math.min(this.scrollTop + this.wrappedViewport, this.wrappedLines.length); i++) {
			lines.push(dim(truncateToWidth(this.wrappedLines[i] ?? "", maxWidth)));
		}

		const hints = " ↑↓ scroll · ←→ block · esc close ";
		lines.push(dim(truncateToWidth(hints, maxWidth)));
		lines.push(dim("─".repeat(width)));
		return lines;
	}
}
