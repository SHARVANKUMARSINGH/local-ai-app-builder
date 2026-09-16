/**
 * OpenRouter's models API doesn't include per-model icons, and reproducing
 * providers' actual brand logos would be a copyright problem. Instead, each
 * vendor (the "openai" in "openai/gpt-4o") gets a small deterministic
 * monogram — consistent per vendor, monochrome to match the app's theme.
 */
const VENDOR_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "meta-llama": "Meta",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  "x-ai": "xAI",
  cohere: "Cohere",
  perplexity: "Perplexity",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  openrouter: "OpenRouter",
  amazon: "Amazon",
  "01-ai": "01.AI",
  moonshotai: "Moonshot",
};

export function vendorLabel(vendor: string): string {
  return VENDOR_LABELS[vendor] ?? vendor.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function vendorInitials(vendor: string): string {
  const label = vendorLabel(vendor);
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
