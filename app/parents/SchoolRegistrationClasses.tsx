"use client";

import { useEffect, useId, useState } from "react";

export default function SchoolRegistrationClasses({ schoolId, value, onChange }: {
  schoolId: string; value: string[]; onChange: (classes: string[]) => void;
}) {
  const id = useId();
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setUnavailable(false);
    setOptions([]);
    fetch(`/api/portal/registration-classes?schoolId=${encodeURIComponent(schoolId)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok || !result.classes?.length) throw new Error("Unavailable");
        if (!controller.signal.aborted) setOptions(result.classes);
      })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [schoolId, attempt]);
  return <fieldset style={{ margin: 0, border: "1px solid #d0d5dd", borderRadius: 12, padding: 14, color: "#344054" }}>
    <legend style={{ fontSize: 14, fontWeight: 700 }}>Child’s class / grade <span style={{ color: "#b42318" }}>*</span></legend>
    <p style={{ fontSize: 12, lineHeight: 1.5, margin: "0 0 10px" }}>Select a class for photo-day updates. For children in different classes, add each class below. Your private PIN is still required to view photos.</p>
    {loading ? <p role="status" style={{ fontSize: 12 }}>Loading classes…</p> : null}
    {unavailable ? <div role="alert" style={{ fontSize: 12, marginBottom: 10 }}>The class list is unavailable. Please retry, or contact your photographer if it stays empty. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div> : null}
    {(value.length ? value : [""]).map((selected, index) => <div key={index} style={{ marginTop: 8 }}>
      <label htmlFor={`${id}-${index}`} style={{ fontSize: 12 }}>Class {index + 1}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <select id={`${id}-${index}`} required value={selected} disabled={loading || unavailable}
          onChange={(event) => { const next = [...(value.length ? value : [""])]; next[index] = event.target.value; onChange(next); }}
          style={{ width: "100%", boxSizing: "border-box", borderRadius: 9, border: "1px solid #d0d5dd", background: "#fff", color: "#111827", padding: "11px 12px", fontSize: 14 }}>
          <option value="">Select your child’s class / grade</option>
          {options.filter((name) => name === selected || !value.includes(name)).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {index > 0 ? <button type="button" aria-label={`Remove class ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</button> : null}
      </div>
    </div>)}
    {value.length > 0 && value.every(Boolean) && value.length < Math.min(options.length, 20) ? <button type="button" onClick={() => onChange([...value, ""])} style={{ marginTop: 10 }}>Add another class</button> : null}
  </fieldset>;
}
