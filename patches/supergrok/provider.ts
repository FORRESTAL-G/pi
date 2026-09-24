/**
 * Register the `supergrok` provider with pi.
 */

import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { openAIResponsesApi, registerApiProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { API_BASE } from "./constants.ts";
import { login, refreshToken } from "./oauth.ts";

/**
 * xAI Responses API transport for multi-agent models. Two xAI quirks handled:
 * - /v1/chat/completions rejects them outright ("Multi Agent requests are not
 *   allowed on chat completions") → use the Responses API against /v1.
 * - Client-side (function) tools are beta-gated and get a 400 → strip tools
 *   (text chat works; agentic tool use is not supported by xAI yet).
 */
export const MULTIAGENT_API = "xai-multiagent-responses";

let multiAgentApiRegistered = false;
function ensureMultiAgentApi(): void {
	if (multiAgentApiRegistered) return;
	const base = openAIResponsesApi();
	registerApiProvider({
		api: MULTIAGENT_API as never,
		stream: (model, context, options) =>
			base.stream(model, { ...context, tools: [] } as typeof context, options),
		streamSimple: (model, context, options) =>
			base.streamSimple(model, { ...context, tools: [] } as typeof context, options),
	}, "pi-xai-supergrok");
	multiAgentApiRegistered = true;
}

export type RegisterSupergrokOptions = {
	/** Called after a successful login so we can re-discover models with the new token. */
	onLoggedIn?: (credentials: OAuthCredentials) => void | Promise<void>;
};

export function registerSupergrok(
	pi: ExtensionAPI,
	models: ProviderModelConfig[],
	opts: RegisterSupergrokOptions = {},
): void {
	ensureMultiAgentApi();
	pi.registerProvider("supergrok", {
		name: "SuperGrok (xAI OAuth)",
		baseUrl: API_BASE,
		// Env fallback: set XAI_API_KEY to skip OAuth entirely.
		apiKey: "$XAI_API_KEY",
		api: "openai-completions",
		authHeader: true,
		models,
		oauth: {
			name: "SuperGrok (xAI OAuth)",
			login: async (callbacks) => {
				const credentials = await login(callbacks);
				await opts.onLoggedIn?.(credentials);
				return credentials;
			},
			refreshToken,
			getApiKey: (cred) => cred.access,
		},
	});
}
