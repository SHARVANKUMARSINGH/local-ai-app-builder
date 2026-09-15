const STORAGE_KEY = "local-ai-app-builder:openrouter-key";

/** Reads the user's OpenRouter key from this browser's localStorage, if any.
 *  Wrapped in try/catch because localStorage can throw in some private-
 *  browsing modes or sandboxed iframes. */
export function getStoredApiKey(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // localStorage unavailable — the key will still work for the current
    // in-memory session via the value the caller already holds.
  }
}

export function clearStoredApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
