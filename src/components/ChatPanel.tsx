import { useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ActionLogEntry, BootPhase, ChatMessage } from "../types";
import { OPENROUTER_MODEL } from "../lib/openrouter";

type WorkspaceTab = "files" | "preview" | "terminal";

interface ChatPanelProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSend: (prompt: string) => void;
  apiKeyPresent: boolean;
  onManageApiKey: () => void;
  phase: BootPhase;
  serverUrl: string | null;
  onOpenMobileWorkspace: (tab: WorkspaceTab) => void;
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

/** Groups an action log into count-based chips ("+2 Files added") for the
 *  file actions, and one chip per command (commands are heterogeneous, so
 *  counting them together isn't meaningful). */
function ActionChips({ actions }: { actions: ActionLogEntry[] }) {
  const added = actions.filter((a) => a.type === "file_added");
  const edited = actions.filter((a) => a.type === "file_edited");
  const removed = actions.filter((a) => a.type === "file_removed");
  const commands = actions.filter((a) => a.type === "command");

  const chip = (key: string, icon: string, label: string) => (
    <span
      key={key}
      className="inline-flex items-center gap-1 rounded border border-border-soft bg-panel-raised px-1.5 py-0.5 text-[10px] text-text-muted"
    >
      <span className="text-text-dim">{icon}</span>
      {label}
    </span>
  );

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {added.length > 0 && chip("added", "+", `${added.length} File${added.length > 1 ? "s" : ""} added`)}
      {edited.length > 0 && chip("edited", "~", `${edited.length} File${edited.length > 1 ? "s" : ""} edited`)}
      {removed.length > 0 && chip("removed", "−", `${removed.length} File${removed.length > 1 ? "s" : ""} removed`)}
      {commands.map((c, i) => chip(`cmd-${i}`, "$", c.command ?? ""))}
    </div>
  );
}

export default function ChatPanel({
  messages,
  isGenerating,
  onSend,
  apiKeyPresent,
  onManageApiKey,
  phase,
  serverUrl,
  onOpenMobileWorkspace,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

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

  // "Hold click to reveal, like a Windows right-click menu" — the native
  // contextmenu event already fires on long-press on virtually every mobile
  // browser (it's how text-selection menus appear), so it doubles perfectly
  // as this gesture without any manual touch-timer code. Only intercepted
  // below the desktop breakpoint, where the side panels aren't on screen.
  const onContextMenu = (e: MouseEvent) => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const openWorkspace = (tab: WorkspaceTab) => {
    setMenuPos(null);
    onOpenMobileWorkspace(tab);
  };

  return (
    <div className="relative flex h-full flex-col bg-panel">
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
          background. Long-press anywhere in the message list below to open
          Files/Preview/Terminal full-screen. */}
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
        {phase === "ready" && serverUrl ? (
          <a
            href={serverUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[11px] text-text underline underline-offset-2"
          >
            Open live preview ↗
          </a>
        ) : (
          <span className="ml-auto text-[10px] text-text-dim">Hold to open workspace</span>
        )}
      </div>

      <div
        onContextMenu={onContextMenu}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4 [-webkit-touch-callout:none]"
      >
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
              {m.role === "assistant" ? (
                <div className="prose-chat">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
              {m.actions && m.actions.length > 0 && <ActionChips actions={m.actions} />}
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

      {menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuPos(null)} />
          <div
            style={{ left: menuPos.x, top: menuPos.y }}
            className="glow-lg fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-panel-raised py-1 text-sm"
          >
            <button
              onClick={() => openWorkspace("files")}
              className="block w-full px-3 py-2 text-left text-text-muted hover:bg-white/5 hover:text-text"
            >
              Files (VFS)
            </button>
            <button
              onClick={() => openWorkspace("preview")}
              className="block w-full px-3 py-2 text-left text-text-muted hover:bg-white/5 hover:text-text"
            >
              Preview
            </button>
            <button
              onClick={() => openWorkspace("terminal")}
              className="block w-full px-3 py-2 text-left text-text-muted hover:bg-white/5 hover:text-text"
            >
              Terminal
            </button>
          </div>
        </>
      )}

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
