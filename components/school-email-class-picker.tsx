"use client";

type Props = {
  classOptions: string[];
  selectedClasses: string[];
  loading: boolean;
  error: string;
  onChange: (classes: string[]) => void;
};

export function SchoolEmailClassPicker({ classOptions, selectedClasses, loading, error, onChange }: Props) {
  return (
    <fieldset style={{ minWidth: 0, margin: 0, padding: 0, border: 0 }}>
      <legend style={{ color: "#344054", fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Classes / grades to email</legend>
      <div role="group" aria-label="Classes / grades to email" style={{ height: 224, overflowY: "auto", overscrollBehavior: "contain", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", padding: 4 }}>
        {classOptions.map((className) => (
          <label key={className} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36, padding: "6px 10px", boxSizing: "border-box", borderRadius: 5, cursor: "pointer", color: "#111827", fontSize: 14, background: selectedClasses.includes(className) ? "#eff6ff" : "transparent" }}>
            <input type="checkbox" checked={selectedClasses.includes(className)} onChange={(event) => onChange(event.target.checked ? [...selectedClasses, className] : selectedClasses.filter((name) => name !== className))} style={{ accentColor: "#1f5b88", flexShrink: 0 }} />
            {className}
          </label>
        ))}
        {classOptions.length === 0 ? <p style={{ margin: 10, color: "#667085", fontSize: 13 }}>{loading ? "Loading classes…" : error ? "Could not load classes. Refresh recipients to try again." : "No roster classes are available yet."}</p> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, minHeight: 24 }}>
        <span role="status" style={{ color: "#344054", fontSize: 13, fontWeight: 700 }}>{selectedClasses.length} {selectedClasses.length === 1 ? "class" : "classes"} selected</span>
        <button type="button" disabled={!selectedClasses.length} onClick={() => onChange([])} style={{ border: 0, padding: "4px 0", background: "transparent", color: selectedClasses.length ? "#1f5b88" : "#98a2b3", fontSize: 12, cursor: selectedClasses.length ? "pointer" : "default" }}>Clear selection</button>
      </div>
      <p style={{ height: 40, overflowY: "auto", margin: "4px 0 0", fontSize: 12, lineHeight: "20px", color: "#667085" }}>{selectedClasses.length ? selectedClasses.join(" · ") : "Tick one or more classes. Each choice stays selected."}</p>
    </fieldset>
  );
}
