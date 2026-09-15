import Editor from "@monaco-editor/react";
import type { ProjectFile } from "../types";

interface EditorPanelProps {
  files: ProjectFile[];
  activePath: string | null;
  onSelectPath: (path: string) => void;
  onChangeContents: (path: string, contents: string) => void;
}

function languageForPath(path: string): string {
  const ext = path.split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
  };
  return map[ext] ?? "plaintext";
}

export default function EditorPanel({
  files,
  activePath,
  onSelectPath,
  onChangeContents,
}: EditorPanelProps) {
  const activeFile = files.find((f) => f.path === activePath) ?? null;

  return (
    <div className="flex h-full flex-col bg-base">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-panel px-2">
        {files.length === 0 && (
          <span className="px-2 py-2.5 text-xs text-text-dim">No files yet</span>
        )}
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => onSelectPath(f.path)}
            className={
              f.path === activePath
                ? "whitespace-nowrap border-b-2 border-accent px-3 py-2.5 text-xs text-text"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-xs text-text-muted hover:text-text"
            }
          >
            {f.path}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {activeFile ? (
          <Editor
            key={activeFile.path}
            path={activeFile.path}
            language={languageForPath(activeFile.path)}
            value={activeFile.contents}
            theme="vs-dark"
            onChange={(value) => onChangeContents(activeFile.path, value ?? "")}
            options={{
              fontSize: 13,
              fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12 },
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-base p-8">
            <div className="glow-lg glow-breathe max-w-xs rounded-xl border border-border-soft px-8 py-7 text-center">
              <p className="text-sm text-text">Nothing built yet</p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-dim">
                Describe an app on the left. Generated code will open here, ready to read or edit.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
