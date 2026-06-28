export type { AiModelOption, AiModelConfig } from "./api-contracts";
import type { AiModelOption, AiModelConfig } from "./api-contracts";

/**
 * Catalog of Cloudflare Workers AI text-generation models that are suitable for
 * the workbook column-detection task (instruction-following + JSON output).
 *
 * Pricing is Cloudflare's published per-model rate in USD per 1M tokens. These
 * change over time — keep `AI_PRICING_VERIFIED_AT` / `AI_PRICING_SOURCE_URL` in
 * sync whenever you refresh the numbers, and treat them as estimates to help an
 * admin compare relative cost, not as billing-grade figures.
 *
 * Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
 */
export const AI_PRICING_VERIFIED_AT = "2026-06-26";
export const AI_PRICING_SOURCE_URL = "https://developers.cloudflare.com/workers-ai/platform/pricing/";

export const AI_MODEL_CATALOG: AiModelOption[] = [
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    label: "Llama 3.1 8B Instruct (Fast)",
    description: "Cheapest and fastest. Good default for short structured JSON tasks.",
    contextWindow: 8192,
    inputUsdPerMillion: 0.045,
    outputUsdPerMillion: 0.384,
    tier: "economy",
  },
  {
    id: "@cf/meta/llama-3.2-1b-instruct",
    label: "Llama 3.2 1B Instruct",
    description: "Smallest model. Lowest cost, weakest reasoning — fine for simple headers.",
    contextWindow: 60000,
    inputUsdPerMillion: 0.027,
    outputUsdPerMillion: 0.201,
    tier: "economy",
  },
  {
    id: "@cf/meta/llama-3.2-3b-instruct",
    label: "Llama 3.2 3B Instruct",
    description: "Small but noticeably better than 1B at multilingual mapping.",
    contextWindow: 60000,
    inputUsdPerMillion: 0.051,
    outputUsdPerMillion: 0.335,
    tier: "economy",
  },
  {
    id: "@cf/mistral/mistral-7b-instruct-v0.1",
    label: "Mistral 7B Instruct",
    description: "Balanced 7B alternative to Llama 8B.",
    contextWindow: 8192,
    inputUsdPerMillion: 0.110,
    outputUsdPerMillion: 0.190,
    tier: "balanced",
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B Instruct",
    description: "Full-precision 8B. Stronger than the Fast variant, costs more.",
    contextWindow: 8192,
    inputUsdPerMillion: 0.282,
    outputUsdPerMillion: 0.827,
    tier: "balanced",
  },
  {
    id: "@cf/google/gemma-3-12b-it",
    label: "Gemma 3 12B Instruct",
    description: "Strong multilingual model. Good Arabic header detection.",
    contextWindow: 80000,
    inputUsdPerMillion: 0.345,
    outputUsdPerMillion: 0.556,
    tier: "balanced",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B Instruct (Fast)",
    description: "Most capable. Best accuracy on messy/ambiguous spreadsheets, highest cost.",
    contextWindow: 24000,
    inputUsdPerMillion: 0.293,
    outputUsdPerMillion: 2.253,
    tier: "premium",
  },
];

export const DEFAULT_AI_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fast";

export const DEFAULT_AI_CONFIG: AiModelConfig = {
  workbookModelId: DEFAULT_AI_MODEL_ID,
};

export function isKnownAiModel(id: string): boolean {
  return AI_MODEL_CATALOG.some((model) => model.id === id);
}

/** Merge stored config over defaults, dropping any model id no longer in the catalog. */
export function mergeAiConfig(stored: Partial<AiModelConfig> | null | undefined): AiModelConfig {
  const candidate = stored?.workbookModelId;
  const workbookModelId = candidate && isKnownAiModel(candidate) ? candidate : DEFAULT_AI_MODEL_ID;
  return { workbookModelId };
}
