import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { BootPhase, ChatMessage } from "../types";
import { OPENROUTER_MODEL } from "../lib/openrouter";

interface ChatPanelProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSend: (prompt: string) => void;
  apiKeyPresent: boolean;
  onManageApiKey: () => void;
  phase: BootPhase;
  serverUrl: string | null;
}

const PHASE_LABEL: Record<BootPhase, string> = {
  idle: "Idle",
  booting: "Booting…",
  mounting: "Mounting files…",
  installing: "Installing…",
  starting: "Starting dev server…",
  ready: "Live",
  error: "Error",
};

export default function ChatPanel({
  messages,
  isGenerating,
  onSend,
  apiKeyPresent,
  onManageApiKey,
  phase,
  serverUrl,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isGenerating) return;
    onSend(trimmed);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="glow h-2 w-2 rounded-full bg-white" />
          <h1 className="text-sm font-medium tracking-tight text-text">local-ai-app-builder</h1>
          <button
            onClick={onManageApiKey}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-text-dim hover:text-text-muted"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${apiKeyPresent ? "glow bg-white" : "bg-text-dim"}`} />
            {apiKeyPresent ? "API key set" : "Add API key"}
          </button>
        </div>
        <p className="mt-1 text-[10px] tracking-wide text-text-dim">{OPENROUTER_MODEL} · no cost</p>
      </div>

      {/* Mobile-only status strip: on small screens there's no editor/terminal
          in view, but the WebContainer pipeline is still running in the
          background — this is the only visible signal of that on mobile. */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
        <span
          className={
            phase === "error"
              ? "h-1.5 w-1.5 rounded-full bg-error"
              : phase === "ready"
                ? "glow h-1.5 w-1.5 rounded-full bg-white"
                : "glow status-dot-pulse h-1.5 w-1.5 rounded-full bg-white"
          }
        />
        <span className="text-[11px] text-text-muted">{PHASE_LABEL[phase]}</span>
        {phase === "ready" && serverUrl && (
          <a
            href={serverUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[11px] text-text underline underline-offset-2"
          >
            Open live preview ↗
          </a>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-text-muted">
            Describe the app you want. The first message boots a project — installs
            dependencies, starts the dev server, and shows you the live result.
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-lg bg-user-bubble px-3 py-2 text-sm text-text"
                  : "max-w-[85%] rounded-lg border border-border-soft px-3 py-2 text-sm text-text-muted"
              }
            >
              {m.content}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <span className="glow status-dot-pulse h-1.5 w-1.5 rounded-full bg-white" />
            Generating…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Build a pomodoro timer with a settings drawer…"
          rows={3}
          className="input-glow w-full resize-none rounded-md border border-border bg-panel-raised px-3 py-2 text-sm text-text placeholder:text-text-dim"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-text-dim">Enter to send · Shift+Enter for newline</span>
          <button
            type="submit"
            disabled={isGenerating || !draft.trim()}
            className="btn-glow rounded-md border border-accent-dim bg-accent-soft px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-text-dim disabled:hover:bg-transparent disabled:hover:text-text-dim"
          >
            {isGenerating ? "Working…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
