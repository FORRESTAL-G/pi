/**
 * Live model discovery from xAI GET /v1/models (+ static fallback).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { MODELS_FETCH_TIMEOUT_MS, MODELS_URL, XAI_COMPAT } from "./constants.ts";
import { MULTIAGENT_API } from "./provider.ts";
import { FALLBACK_MODELS } from "./fallback-models.ts";

/** xAI /v1/models entry (OpenAI-shaped + xAI price / context fields). */
interface XaiModel {
	id: string;
	object?: string;
	owned_by?: string;
	created?: number;
	aliases?: string[];
	context_length?: number;
	/** Price in 1e-4 USD per million tokens (divide by 10_000 → $/M). */
	prompt_text_token_price?: number;
	completion_text_token_price?: number;
	cached_prompt_text_token_price?: number;
	prompt_image_token_price?: number;
	/** Image-generation-only models expose this instead of text prices. */
	image_price?: number;
}

interface XaiModelsResponse {
	data?: XaiModel[];
	object?: string;
}

export type ModelsLoadResult = {
	models: ProviderModelConfig[];
	source: "live" | "fallback";
	error?: string;
};

/** xAI prices are 1e-4 USD per million tokens. 12500 → $1.25 / MTok. */
function pricePerMillion(raw: number | undefined): number {
	if (raw == null || !Number.isFinite(raw)) return 0;
	return raw / 10_000;
}

function humanizeModelId(id: string): string {
	return id
		.split("-")
		.map((part) => {
			if (!part) return part;
			if (/^\d/.test(part)) return part;
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join(" ");
}

/**
 * Guess reasoning support from the id. xAI doesn't expose a dedicated flag on
 * /v1/models; ids that contain "non-reasoning" are explicit, modern grok-4 /
 * build / multi-agent ids are treated as reasoning otherwise.
 */
function isReasoningModel(id: string): boolean {
	const lower = id.toLowerCase();
	if (/non[-_]?reasoning/.test(lower)) return false;
	if (/reasoning|think|multi[-_]?agent|build/.test(lower)) return true;
	if (/^grok-4(\.|$|-)/.test(lower)) return true;
	return false;
}

/** Chat / completion models only — skip image/video generators. */
function isChatModel(m: XaiModel): boolean {
	if (!m.id || typeof m.id !== "string") return false;
	if (m.image_price != null && m.prompt_text_token_price == null) return false;
	if (/imagine|image|video|tts|voice|embedding/i.test(m.id)) return false;
	// Require a text price, or at least a context window (older catalog rows).
	return m.prompt_text_token_price != null || m.context_length != null;
}

function toProviderModel(m: XaiModel): ProviderModelConfig {
	const multiAgent = /multi[-_]?agent/i.test(m.id);
	const contextWindow = m.context_length ?? 131_072;
	// /v1/models has no max-completion field. Mirror common xAI defaults:
	// use the full context as the ceiling (pi clamps further at request time).
	const maxTokens = contextWindow;
	const hasImage = m.prompt_image_token_price != null && m.prompt_image_token_price > 0;

	return {
		id: m.id,
		name: humanizeModelId(m.id),
		// ponytail: multi-agent models are rejected on /v1/chat/completions
		// ("Multi Agent requests are not allowed on chat completions") — route
		// them to the Responses API transport registered by provider.ts
		...(multiAgent ? { api: MULTIAGENT_API } : {}),
		reasoning: isReasoningModel(m.id),
		input: hasImage ? ["text", "image"] : ["text"],
		contextWindow,
		maxTokens,
		cost: {
			input: pricePerMillion(m.prompt_text_token_price),
			output: pricePerMillion(m.completion_text_token_price),
			cacheRead: pricePerMillion(m.cached_prompt_text_token_price),
			cacheWrite: 0,
		},
		compat: { ...XAI_COMPAT },
	};
}

/**
 * Resolve a bearer token for /v1/models without going through pi's auth layer
 * (extensions load before the provider is fully wired). Prefer XAI_API_KEY,
 * then the OAuth access token stored by a previous `/login supergrok`.
 */
export async function resolveAccessToken(): Promise<string | undefined> {
	const envKey = process.env.XAI_API_KEY?.trim();
	if (envKey) return envKey;

	try {
		const raw = await readFile(join(homedir(), ".pi/agent/auth.json"), "utf8");
		const auth = JSON.parse(raw) as Record<
			string,
			{ type?: string; access?: string; expires?: number }
		>;
		const entry = auth.supergrok;
		if (entry?.access && typeof entry.access === "string") {
			// Skip clearly expired tokens — refresh happens later via oauth.
			if (typeof entry.expires === "number" && entry.expires < Date.now()) {
				return undefined;
			}
			return entry.access;
		}
	} catch {
		// no auth file / unreadable — fine, we'll use the fallback catalog
	}
	return undefined;
}

export async function fetchLiveModels(token: string): Promise<ProviderModelConfig[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(MODELS_URL, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
		if (!res.ok) {
			const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
			throw new Error(
				`xAI /v1/models returned ${res.status}${detail ? `: ${detail}` : ""}`,
			);
		}
		const body = (await res.json()) as XaiModelsResponse;
		const rows = Array.isArray(body.data) ? body.data : [];
		const models = rows.filter(isChatModel).map(toProviderModel);
		if (models.length === 0) {
			throw new Error("xAI /v1/models returned no chat models");
		}
		// Stable, newest-first-ish order: higher created first, then id.
		const created = new Map(rows.map((r) => [r.id, r.created ?? 0]));
		models.sort((a, b) => {
			const dc = (created.get(b.id) ?? 0) - (created.get(a.id) ?? 0);
			return dc !== 0 ? dc : a.id.localeCompare(b.id);
		});
		return models;
	} finally {
		clearTimeout(timer);
	}
}

export async function loadModels(): Promise<ModelsLoadResult> {
	const token = await resolveAccessToken();
	if (!token) {
		return { models: FALLBACK_MODELS, source: "fallback", error: "no credentials" };
	}
	try {
		const models = await fetchLiveModels(token);
		return { models, source: "live" };
	} catch (e) {
		return {
			models: FALLBACK_MODELS,
			source: "fallback",
			error: (e as Error).message ?? String(e),
		};
	}
}
