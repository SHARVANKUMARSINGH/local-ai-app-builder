import { useState, type FormEvent } from "react";

interface ApiKeyModalProps {
  currentKey: string | null;
  onSave: (key: string) => void;
  onSkip: () => void;
  onClear?: () => void;
}

export default function ApiKeyModal({ currentKey, onSave, onSkip, onClear }: ApiKeyModalProps) {
  const [value, setValue] = useState(currentKey ?? "");
  const [visible, setVisible] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-panel p-5 shadow-xl">
        <h2 className="text-sm font-medium text-text">Add your OpenRouter API key</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
          Requests go straight from your browser to OpenRouter — the key is saved only in this
          browser's local storage and isn't sent anywhere else.
        </p>

        <form onSubmit={submit} className="mt-4">
          <div className="relative">
            <input
              autoFocus
              type={visible ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-or-v1-…"
              className="w-full rounded-md border border-border bg-panel-raised px-3 py-2 pr-16 text-sm text-text placeholder:text-text-dim input-glow"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-dim hover:text-text-muted"
            >
              {visible ? "Hide" : "Show"}
            </button>
          </div>

          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[11px] text-accent hover:underline"
          >
            Get a key at openrouter.ai/keys
          </a>

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="text-xs text-text-dim hover:text-text-muted"
              >
                Skip for now
              </button>
              {currentKey && onClear && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-xs text-error/80 hover:text-error"
                >
                  Remove key
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded-md border border-accent-dim bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-dim/30 btn-glow disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-text-dim"
            >
              Save key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
