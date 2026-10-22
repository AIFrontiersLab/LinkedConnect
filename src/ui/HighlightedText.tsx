import { isKnownPlaceholder, splitPlaceholders } from "../shared/templates";

/** Renders text with {{placeholders}} highlighted. Uses React text nodes only (no HTML injection). */
export function HighlightedText({ text, values }: { text: string; values?: Record<string, string> }) {
  return (
    <>
      {splitPlaceholders(text).map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
        const filled = values && isKnownPlaceholder(seg.name) ? values[seg.name] : "";
        if (filled) {
          return (
            <mark key={i} className="ph-ok" title={`{{${seg.name}}}`}>
              {filled}
            </mark>
          );
        }
        return (
          <mark key={i} className="ph-missing" title={isKnownPlaceholder(seg.name) ? "Missing value" : "Unsupported placeholder"}>
            {seg.value}
          </mark>
        );
      })}
    </>
  );
}
