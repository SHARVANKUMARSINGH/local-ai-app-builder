export interface ModelOption {
  id: string;
  name: string;
  vendor: string;
  isFree: boolean;
  contextLength?: number;
  /** USD per 1M tokens, for display on paid models. Undefined for free ones. */
  promptPricePerM?: number;
}

interface RawOpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

function vendorFromId(id: string): string {
  return id.split("/")[0] ?? id;
}

function isFreeModel(raw: RawOpenRouterModel): boolean {
  if (raw.id.endsWith(":free")) return true;
  if (raw.id === "openrouter/free") return true;
  const prompt = Number(raw.pricing?.prompt ?? "0");
  const completion = Number(raw.pricing?.completion ?? "0");
  return prompt === 0 && completion === 0;
}

/**
 * Fetches OpenRouter's full model catalog. This is a public, unauthenticated
 * GET — no API key needed just to list models, only to actually run a
 * completion against one.
 */
export async function fetchOpenRouterModels(): Promise<ModelOption[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter models request failed (${res.status})`);
  const body = (await res.json()) as { data?: RawOpenRouterModel[] };
  const models = body.data ?? [];

  return models
    .map((m): ModelOption => {
      const promptPrice = Number(m.pricing?.prompt ?? "0");
      return {
        id: m.id,
        name: m.name || m.id,
        vendor: vendorFromId(m.id),
        isFree: isFreeModel(m),
        contextLength: m.context_length,
        promptPricePerM: promptPrice > 0 ? promptPrice * 1_000_000 : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
