import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOpenRouterModels, type ModelOption } from "../lib/openrouterModels";
import { vendorInitials, vendorLabel } from "../lib/vendorIcon";

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
}

function VendorIcon({ vendor }: { vendor: string }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-soft bg-panel-raised text-[9px] font-medium text-text-muted">
      {vendorInitials(vendor)}
    </span>
  );
}

function ModelRow({ model, selected, onSelect }: { model: ModelOption; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        selected
          ? "flex w-full items-center gap-2 px-3 py-2 text-left text-xs bg-white/10 text-text"
          : "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text"
      }
    >
      <VendorIcon vendor={model.vendor} />
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      {model.promptPricePerM !== undefined && (
        <span className="shrink-0 text-[10px] text-text-dim">${model.promptPricePerM.toFixed(2)}/M</span>
      )}
    </button>
  );
}

/**
 * A from-scratch dropdown (not a native <select>) so we can show grouped
 * sections, vendor icons, and pricing per row — none of which a native
 * select can render.
 */
export default function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOpenRouterModels()
      .then((list) => {
        if (!cancelled) {
          setModels(list);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = useMemo(
    () => models.find((m) => m.id === value) ?? { id: value, name: value, vendor: value.split("/")[0] ?? value, isFree: value.includes("free") },
    [models, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || vendorLabel(m.vendor).toLowerCase().includes(q))
      : models;
    return {
      free: list.filter((m) => m.isFree),
      paid: list.filter((m) => !m.isFree),
    };
  }, [models, query]);

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1.5 block text-[11px] text-text-dim">Model</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input-glow flex w-full items-center gap-2 rounded-md border border-border bg-panel-raised px-3 py-2 text-left text-sm text-text"
      >
        <VendorIcon vendor={selected.vendor} />
        <span className="min-w-0 flex-1 truncate">{selected.name}</span>
        {selected.isFree && (
          <span className="shrink-0 rounded border border-border-soft px-1.5 py-0.5 text-[10px] text-text-dim">
            free
          </span>
        )}
        <span className="text-text-dim">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="glow-lg absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-panel-raised">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            className="w-full border-b border-border-soft bg-transparent px-3 py-2 text-xs text-text placeholder:text-text-dim focus:outline-none"
          />

          <div className="max-h-64 overflow-y-auto py-1">
            {status === "loading" && <p className="px-3 py-3 text-xs text-text-dim">Loading models…</p>}
            {status === "error" && (
              <p className="px-3 py-3 text-xs text-text-dim">
                Couldn't reach OpenRouter's model list. You can still type a model id manually below.
              </p>
            )}

            {status === "ready" && filtered.free.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-text-dim">Free models</p>
                {filtered.free.map((m) => (
                  <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={() => { onChange(m.id); setOpen(false); }} />
                ))}
              </>
            )}

            {status === "ready" && filtered.paid.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wide text-text-dim">Paid models</p>
                {filtered.paid.map((m) => (
                  <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={() => { onChange(m.id); setOpen(false); }} />
                ))}
              </>
            )}

            {status === "ready" && filtered.free.length === 0 && filtered.paid.length === 0 && (
              <p className="px-3 py-3 text-xs text-text-dim">No models match "{query}".</p>
            )}
          </div>

          <div className="border-t border-border-soft p-2">
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="or type a model id, e.g. openai/gpt-4o"
              className="input-glow w-full rounded border border-border bg-panel px-2 py-1.5 text-[11px] text-text-muted placeholder:text-text-dim"
            />
          </div>
        </div>
      )}
    </div>
  );
}
