import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessage } from "../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSend: (prompt: string) => void;
}

export default function ChatPanel({ messages, isGenerating, onSend }: ChatPanelProps) {
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
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <h1 className="text-sm font-medium tracking-tight text-text">local-ai-app-builder</h1>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-text-muted">
            Describe the app you want. The first message boots a project in the panel to the
            right — installs dependencies, starts the dev server, and shows you the live result.
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
            <span className="h-1.5 w-1.5 rounded-full bg-accent status-dot-pulse" />
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
          className="w-full resize-none rounded-md border border-border bg-panel-raised px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-text-dim">Enter to send · Shift+Enter for newline</span>
          <button
            type="submit"
            disabled={isGenerating || !draft.trim()}
            className="rounded-md border border-accent-dim bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-dim/30 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-text-dim"
          >
            {isGenerating ? "Working…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
