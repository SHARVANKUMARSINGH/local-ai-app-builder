import { forwardRef } from "react";
import type { BootPhase } from "../types";
import Terminal, { type TerminalHandle } from "./Terminal";

interface PreviewPanelProps {
  phase: BootPhase;
  serverUrl: string | null;
}

const PHASE_LABEL: Record<BootPhase, string> = {
  idle: "Idle",
  booting: "Booting WebContainer…",
  mounting: "Mounting files…",
  installing: "Installing dependencies…",
  starting: "Starting dev server…",
  ready: "Live",
  error: "Error",
};

const PHASE_DOT: Record<BootPhase, string> = {
  idle: "bg-text-dim",
  booting: "bg-accent status-dot-pulse",
  mounting: "bg-accent status-dot-pulse",
  installing: "bg-accent status-dot-pulse",
  starting: "bg-accent status-dot-pulse",
  ready: "bg-success",
  error: "bg-error",
};

const PreviewPanel = forwardRef<TerminalHandle, PreviewPanelProps>(function PreviewPanel(
  { phase, serverUrl },
  terminalRef
) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className={`h-2 w-2 rounded-full ${PHASE_DOT[phase]}`} />
        <span className="text-xs text-text-muted">{PHASE_LABEL[phase]}</span>
        {serverUrl && (
          <span className="ml-auto truncate text-xs text-text-dim">{serverUrl}</span>
        )}
      </div>

      <div className="min-h-0 flex-[3] bg-white">
        {serverUrl ? (
          <iframe
            title="preview"
            src={serverUrl}
            className="h-full w-full border-0"
            // Sandbox stays permissive enough for a full dev-server app (scripts,
            // same-origin fetches to the WebContainer's virtual server, forms).
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-base text-sm text-text-dim">
            Preview will appear once the dev server is ready
          </div>
        )}
      </div>

      <div className="min-h-0 flex-[2] border-t border-border">
        <Terminal ref={terminalRef} />
      </div>
    </div>
  );
});

export default PreviewPanel;
