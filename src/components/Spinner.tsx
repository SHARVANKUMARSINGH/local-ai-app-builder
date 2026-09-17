import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** A plain-text Unicode spinner (no image, no SVG) — cycles through braille
 *  frames every 80ms. Renders as a single monospace character so it drops
 *  into any inline text flow cleanly. */
export default function Spinner({ className = "" }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={`inline-block w-[1ch] font-mono ${className}`} aria-hidden="true">
      {FRAMES[frame]}
    </span>
  );
}
