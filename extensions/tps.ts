/**
 * TPS (tokens/sec) statistics for Pi.
 *
 * Measures per-assistant-message generation speed:
 * - TTFT: time from message start to the first streamed content event.
 * - Gen span: first content event to the last one (excludes time-to-first-token,
 *   so the number reflects steady generation speed).
 * - tok/s: usage.output / gen span. Falls back to the whole message span when
 *   the provider does not stream.
 *
 * Footer status:
 * - While streaming:  ⚡ ~132 tok/s…   (estimated from delta bytes / 4)
 * - After a message:  ⚡ 146.8 tok/s · avg 121.4
 *
 * Commands:
 * - /tps        show a report overlay (per-message table + session aggregates)
 * - /tps clear  reset the collected statistics
 *
 * Only complete (non-aborted, non-error) assistant messages are recorded.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

interface TpsRecord {
	model: string;
	output: number;
	genMs: number;
	ttftMs?: number;
	tps: number;
	at: number;
}

interface CurrentMessage {
	startMs: number;
	firstMs?: number;
	lastMs: number;
	chars: number;
	lastPush: number;
}

const STATUS_KEY = "tps";
const LIVE_INTERVAL_MS = 250;
const MIN_LIVE_ELAPSED_MS = 500;
const MAX_RECORDS = 200;
const CHARS_PER_TOKEN = 4;

function isAssistant(m: unknown): m is AssistantMessage {
	return (m as { role?: string } | undefined)?.role === "assistant";
}

function fmtMs(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

function median(values: number[]): number | undefined {
	if (!values.length) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let records: TpsRecord[] = [];
	let current: CurrentMessage | undefined;

	function status(text: string | undefined): void {
		if (ctx?.mode !== "tui" || !ctx.ui) return;
		ctx.ui.setStatus(STATUS_KEY, text);
	}

	function colored(text: string, kind: Parameters<Theme["fg"]>[0] = "dim"): string {
		const theme = ctx?.ui?.theme;
		return theme ? theme.fg(kind, text) : text;
	}

	function weightedAvg(): number | undefined {
		if (!records.length) return undefined;
		const out = records.reduce((sum, r) => sum + r.output, 0);
		const ms = records.reduce((sum, r) => sum + r.genMs, 0);
		return ms > 0 ? (out / ms) * 1000 : undefined;
	}

	function pushLive(): void {
		const c = current;
		if (!c?.firstMs) return;
		const now = Date.now();
		if (now - c.lastPush < LIVE_INTERVAL_MS) return;
		const elapsed = now - c.firstMs;
		if (elapsed < MIN_LIVE_ELAPSED_MS) return;
		const estTokens = c.chars / CHARS_PER_TOKEN;
		const tps = (estTokens / elapsed) * 1000;
		if (tps <= 0) return;
		c.lastPush = now;
		status(`${colored("⚡", "accent")} ${colored(`~${tps.toFixed(0)} tok/s…`, "dim")}`);
	}

	function pushRecord(record: TpsRecord): void {
		const avg = weightedAvg();
		const avgStr = avg !== undefined ? ` · avg ${avg.toFixed(1)}` : "";
		status(
			`${colored("⚡", "accent")} ${colored(`${record.tps.toFixed(1)} tok/s${avgStr}`, "dim")}`,
		);
	}

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		records = [];
		current = undefined;
		status(undefined);
	});

	pi.on("session_shutdown", async () => {
		status(undefined);
	});

	pi.on("message_start", async (event) => {
		if (!isAssistant(event.message)) return;
		const now = Date.now();
		current = { startMs: now, lastMs: now, chars: 0, lastPush: 0 };
	});

	pi.on("message_update", async (event) => {
		if (!current || !isAssistant(event.message)) return;
		const ev = event.assistantMessageEvent;
		switch (ev.type) {
			case "text_start":
			case "thinking_start":
			case "toolcall_start":
			case "text_delta":
			case "thinking_delta":
			case "toolcall_delta":
				current.firstMs ??= Date.now();
				current.lastMs = Date.now();
				break;
			case "text_end":
			case "thinking_end":
			case "toolcall_end":
			case "done":
				current.lastMs = Date.now();
				break;
		}
		if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta") {
			current.chars += ev.delta.length;
			pushLive();
		}
	});

	pi.on("message_end", async (event) => {
		if (!isAssistant(event.message)) return;
		const msg = event.message as AssistantMessage;
		const c = current;
		current = undefined;
		if (!c) return;

		// Skip aborted/error responses; their token counts are partial.
		if (msg.stopReason !== "stop" && msg.stopReason !== "length" && msg.stopReason !== "toolUse") {
			return;
		}
		const output = msg.usage?.output ?? 0;
		if (output <= 0) return;

		const spanStart = c.firstMs ?? c.startMs;
		const genMs = c.lastMs > spanStart ? c.lastMs - spanStart : Math.max(1, Date.now() - c.startMs);
		const record: TpsRecord = {
			model: msg.responseModel ?? msg.model,
			output,
			genMs,
			ttftMs: c.firstMs !== undefined ? c.firstMs - c.startMs : undefined,
			tps: (output / genMs) * 1000,
			at: Date.now(),
		};
		records.push(record);
		if (records.length > MAX_RECORDS) records.shift();
		pushRecord(record);
	});

	function reportLines(theme: Theme, width: number): string[] {
		const lines: string[] = [];
		const totalOut = records.reduce((s, r) => s + r.output, 0);
		const totalMs = records.reduce((s, r) => s + r.genMs, 0);
		const avg = weightedAvg();
		const med = median(records.map((r) => r.tps));
		const fastest = records.length ? Math.max(...records.map((r) => r.tps)) : undefined;
		const slowest = records.length ? Math.min(...records.map((r) => r.tps)) : undefined;

		lines.push("");
		const title = theme.fg("accent", " Token speed ");
		lines.push(
			truncateToWidth(theme.fg("borderMuted", "─".repeat(3)) + title + theme.fg("borderMuted", "─".repeat(Math.max(0, width - 15))), width),
		);
		lines.push("");

		if (!records.length) {
			lines.push(`  ${theme.fg("dim", "No completed assistant messages measured yet.")}`);
			lines.push(`  ${theme.fg("dim", "Send a prompt, then run /tps again.")}`);
			lines.push("");
			return lines;
		}

		lines.push(`  ${theme.fg("muted", "Session:")} ${records.length} msgs · ${fmtTokens(totalOut)} tok out · ${fmtMs(totalMs)} gen → ${theme.fg("accent", `${(avg ?? 0).toFixed(1)} tok/s`)}`);
		const range = med !== undefined && fastest !== undefined && slowest !== undefined
			? ` · median ${med.toFixed(1)} · fast ${fastest.toFixed(1)} · slow ${slowest.toFixed(1)}`
			: "";
		lines.push(`  ${theme.fg("dim", range.trim().replace(/^· /, ""))}`);
		lines.push("");

		const rows = [...records].reverse().slice(0, 15);
		const header = `  ${"#".padStart(3)}  ${"model".padEnd(28)} ${"out".padStart(7)}  ${"gen".padStart(7)}  ${"ttft".padStart(6)}  ${"tok/s".padStart(7)}`;
		lines.push(truncateToWidth(theme.fg("dim", header), width));
		lines.push(truncateToWidth(theme.fg("borderMuted", "  " + "─".repeat(Math.min(width - 2, 68))), width));
		const baseIndex = records.length;
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			const num = String(baseIndex - i).padStart(3);
			const model = (r.model.length > 28 ? r.model.slice(0, 27) + "…" : r.model).padEnd(28);
			const out = fmtTokens(r.output).padStart(7);
			const gen = fmtMs(r.genMs).padStart(7);
			const ttft = r.ttftMs !== undefined ? fmtMs(r.ttftMs).padStart(6) : "   —  ";
			const tps = r.tps.toFixed(1).padStart(7);
			lines.push(truncateToWidth(`  ${num}  ${model} ${out}  ${gen}  ${ttft}  ${theme.fg("accent", tps)}`, width));
		}
		lines.push("");
		lines.push(`  ${theme.fg("dim", "gen = steady generation span (excl. time to first token) · ttft = time to first token")}`);
		lines.push("");
		return lines;
	}

	function summaryText(): string {
		const avg = weightedAvg();
		if (!records.length) return "TPS: no completed assistant messages measured yet.";
		const last = records[records.length - 1];
		return `TPS: last ${last.tps.toFixed(1)} tok/s · session avg ${(avg ?? 0).toFixed(1)} tok/s over ${records.length} msgs`;
	}

	pi.registerCommand("tps", {
		description: "Show tokens/sec statistics (usage: /tps [clear])",
		handler: async (args, c) => {
			ctx = c;
			if (args.trim() === "clear") {
				records = [];
				status(undefined);
				c.ui.notify("TPS statistics cleared", "info");
				return;
			}
			if (c.mode !== "tui") {
				c.ui.notify(summaryText(), "info");
				return;
			}
			await c.ui.custom<void>((_tui, theme, _kb, done) => {
				let cachedWidth: number | undefined;
				let cachedLines: string[] | undefined;
				return {
					invalidate(): void {
						cachedLines = undefined;
					},
					handleInput(data: string): void {
						if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c") || data === "q") {
							done();
						}
					},
					render(width: number): string[] {
						if (cachedLines && cachedWidth === width) return cachedLines;
						cachedWidth = width;
						cachedLines = reportLines(theme, width);
						return cachedLines;
					},
				};
			});
		},
	});
}
