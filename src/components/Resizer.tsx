import { useCallback, useRef } from "react";

interface ResizerProps {
  onDrag: (deltaX: number) => void;
  className?: string;
}

/** A thin draggable divider between two panels. Reports each pointer-move
 *  as a delta (not an absolute position) so the caller can clamp/apply it to
 *  whatever width state it owns. */
export default function Resizer({ onDrag, className = "" }: ResizerProps) {
  const lastX = useRef(0);
  const dragging = useRef(false);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(dx);
    },
    [onDrag]
  );

  const stop = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stop);
  }, [onPointerMove]);

  const start = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      lastX.current = e.clientX;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stop);
    },
    [onPointerMove, stop]
  );

  return (
    <div
      onPointerDown={start}
      className={`group relative w-1 shrink-0 cursor-col-resize bg-border ${className}`}
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-white/10" />
    </div>
  );
}
