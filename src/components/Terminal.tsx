import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
}

/**
 * A thin React wrapper around xterm.js. Exposes an imperative `write` method
 * (rather than a `data` prop) because terminal output arrives as a stream of
 * chunks, not a single value React should diff and re-render against.
 */
const Terminal = forwardRef<TerminalHandle>(function Terminal(_props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      convertEol: true,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: "#0b0d10",
        foreground: "#e6e8eb",
        cursor: "#f2a93b",
        selectionBackground: "#3a2c14",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    term.writeln("\x1b[38;5;180mlocal-ai-app-builder\x1b[0m — waiting for a project to boot…");

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container may be momentarily unmeasurable during layout thrash — safe to ignore.
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    write: (data: string) => termRef.current?.write(data),
    clear: () => termRef.current?.clear(),
  }));

  return <div ref={containerRef} className="h-full w-full px-2 py-1" />;
});

export default Terminal;
