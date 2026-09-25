"use client";

import { useEffect, useState } from "react";

export default function SchoolRegistrationClasses({ schoolId, value, onChange }: {
  schoolId: string; value: string[]; onChange: (classes: string[]) => void;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setUnavailable(false);
    setOptions([]);
    fetch(`/api/portal/registration-classes?schoolId=${encodeURIComponent(schoolId)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error("Unavailable");
        setOptions(result.classes ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [schoolId]);
  return <fieldset style={{ margin: 0, border: "1px solid #d0d5dd", borderRadius: 12, padding: 14, color: "#344054" }}>
    <legend style={{ fontSize: 14, fontWeight: 700 }}>Child’s class / grade <span style={{ color: "#b42318" }}>*</span></legend>
    <p style={{ fontSize: 12, lineHeight: 1.5, margin: "0 0 10px" }}>Select the class so the photographer can send the correct photo-day update. You will still need a private PIN to view photos.</p>
    {loading ? <p style={{ fontSize: 12 }}>Loading classes…</p> : null}
    {unavailable ? <p role="status" style={{ fontSize: 12 }}>Classes are temporarily unavailable. Please try again after the class list loads; a class selection is required.</p> : null}
    <select required value={value[0] ?? ""} disabled={loading || unavailable || options.length === 0}
      onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
      style={{ width: "100%", boxSizing: "border-box", borderRadius: 9, border: "1px solid #d0d5dd", background: "#fff", color: "#111827", padding: "11px 12px", fontSize: 14 }}>
      <option value="">Select your child’s class / grade</option>
      {options.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  </fieldset>;
}
