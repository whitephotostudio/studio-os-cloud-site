"use client";

import { MAX_RETOUCH_NOTES_LENGTH, type RetouchSelection } from "@/lib/retouching";

export type RetouchPhotoOption = { imageUrl: string; thumbnailUrl?: string | null; label: string };

export function RetouchPhotoFields({ photos, value, limit, onChange }: {
  photos: RetouchPhotoOption[];
  value: RetouchSelection[];
  limit: number;
  onChange: (value: RetouchSelection[]) => void;
}) {
  return (
    <div style={{ marginTop: 12, color: "#ededed" }}>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 10px" }}>
        Choose up to {limit} photo{limit === 1 ? "" : "s"} to retouch, then tell us what you would like changed.
      </p>
      <div role="group" aria-label="Photos to retouch" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, maxHeight: 260, overflowY: "auto" }}>
        {photos.map((photo) => {
          const selected = value.some((entry) => entry.imageUrl === photo.imageUrl);
          return (
            <button key={photo.imageUrl} type="button" aria-pressed={selected}
              aria-label={`${selected ? "Remove retouching from" : "Retouch"} ${photo.label}`}
              disabled={!selected && value.length >= limit}
              onClick={() => onChange(selected ? value.filter((entry) => entry.imageUrl !== photo.imageUrl) : [...value, { imageUrl: photo.imageUrl, notes: "" }])}
              style={{ background: selected ? "#26352a" : "#171717", color: "#fff", border: `2px solid ${selected ? "#86d39a" : "#444"}`, borderRadius: 8, padding: 5, cursor: "pointer", opacity: !selected && value.length >= limit ? 0.5 : 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.thumbnailUrl || photo.imageUrl} alt={photo.label} style={{ width: "100%", height: 92, objectFit: "contain", display: "block" }} />
              <span style={{ display: "block", fontSize: 10, marginTop: 4, overflowWrap: "anywhere" }}>{selected ? "✓ Retouching" : photo.label}</span>
            </button>
          );
        })}
      </div>
      {!photos.length && <p role="status" style={{ fontSize: 13 }}>Add a photo product from this gallery before choosing retouching.</p>}
      {value.map((selection, index) => {
        const photo = photos.find((item) => item.imageUrl === selection.imageUrl);
        return (
          <label key={selection.imageUrl} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo?.thumbnailUrl || selection.imageUrl} alt={photo?.label || `Photo ${index + 1}`} style={{ width: 58, height: 72, objectFit: "contain", borderRadius: 6 }} />
            <span style={{ display: "block", flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", color: "#a2e3b2", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Retouching — {photo?.label || `Photo ${index + 1}`}</span>
              <textarea value={selection.notes} maxLength={MAX_RETOUCH_NOTES_LENGTH} rows={3}
                aria-label={`Retouching instructions for ${photo?.label || `Photo ${index + 1}`}`}
                placeholder="Optional: remove a blemish, soften under-eye shadows, or leave freckles unchanged."
                onChange={(event) => onChange(value.map((item) => item.imageUrl === selection.imageUrl ? { ...item, notes: event.target.value } : item))}
                style={{ width: "100%", boxSizing: "border-box", background: "#101010", color: "#fff", border: "1px solid #555", borderRadius: 7, padding: 9, font: "inherit", fontSize: 12, resize: "vertical" }} />
              <span style={{ display: "block", fontSize: 11, color: "#b9b9b9", marginTop: 4 }}>Leave blank for standard retouching.</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
