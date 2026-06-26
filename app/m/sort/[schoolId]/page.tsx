"use client";

// Sort & Review — per-school student grid (/m/sort/[schoolId])
//
// The mobile port of the desktop Sort panel: each student is a thumbnail "folder"
// (cover photo + shot count), grouped by class. Tap a student to see their
// individual photos and delete bad/test shots — deletes remove the photo from
// the live gallery (R2). Photos render through the same-origin /api/r2/img proxy.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, Search, Trash2, UserRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { proxiedPhotoUrl } from "@/lib/photo-url";

type Student = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string | null;
  folder_name: string | null;
  pin: string | null;
  photo_url: string | null;
};

type Photo = { key: string; url: string; name: string };

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}
function fullName(s: Student) {
  return (
    [clean(s.first_name), clean(s.last_name)].filter(Boolean).join(" ") || "Student"
  );
}

export default function SortSchoolPage() {
  const params = useParams();
  const rawId = (params as Record<string, string | string[]>)?.schoolId;
  const schoolId = Array.isArray(rawId) ? rawId[0] : clean(rawId);

  const [supabase] = useState(() => createClient());
  const [schoolName, setSchoolName] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<Student | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [movingPhoto, setMovingPhoto] = useState<Photo | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveSearch, setMoveSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!schoolId) {
        setLoading(false);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: pg } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!pg?.id || cancelled) return;
      const { data: school } = await supabase
        .from("schools")
        .select("id, school_name")
        .eq("id", schoolId)
        .eq("photographer_id", pg.id)
        .maybeSingle();
      if (cancelled) return;
      if (!school) {
        setLoading(false);
        return;
      }
      setSchoolName(
        clean((school as { school_name: string | null }).school_name) || "School",
      );
      const { data: studs } = await supabase
        .from("students")
        .select("id, first_name, last_name, class_name, folder_name, pin, photo_url")
        .eq("school_id", schoolId);
      if (cancelled) return;
      const list = (studs ?? []) as Student[];
      list.sort(
        (a, b) =>
          clean(a.class_name).localeCompare(clean(b.class_name)) ||
          clean(a.last_name).localeCompare(clean(b.last_name)) ||
          clean(a.first_name).localeCompare(clean(b.first_name)),
      );
      setStudents(list);
      setLoading(false);

      try {
        const res = await fetch("/api/dashboard/capture/counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schoolId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          counts?: Record<string, number>;
          covers?: Record<string, string>;
        };
        if (!cancelled && res.ok && json.ok) {
          setCounts(json.counts ?? {});
          setCovers(json.covers ?? {});
        }
      } catch {
        /* counts are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, schoolId]);

  async function openStudent(student: Student) {
    setSelected(student);
    setPhotos([]);
    setPhotosLoading(true);
    try {
      const res = await fetch("/api/dashboard/capture/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, studentId: student.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        photos?: Photo[];
      };
      setPhotos(res.ok && json.ok ? json.photos ?? [] : []);
    } catch {
      setPhotos([]);
    } finally {
      setPhotosLoading(false);
    }
  }

  async function deletePhoto(key: string) {
    if (!selected) return;
    if (
      !window.confirm(
        "Delete this photo? This removes it from the gallery permanently.",
      )
    ) {
      return;
    }
    setDeletingKey(key);
    try {
      const res = await fetch("/api/dashboard/capture/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, key }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) {
        setPhotos((prev) => prev.filter((p) => p.key !== key));
        setCounts((prev) => ({
          ...prev,
          [selected.id]: Math.max(0, (prev[selected.id] ?? 1) - 1),
        }));
      } else {
        window.alert(json.error || "Could not delete the photo.");
      }
    } catch {
      window.alert("Could not delete the photo.");
    } finally {
      setDeletingKey(null);
    }
  }

  async function doMove(target: Student) {
    if (!movingPhoto || !selected) return;
    setMoveBusy(true);
    try {
      const res = await fetch("/api/dashboard/capture/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          key: movingPhoto.key,
          fromStudentId: selected.id,
          toStudentId: target.id,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) {
        const movedKey = movingPhoto.key;
        setPhotos((prev) => prev.filter((p) => p.key !== movedKey));
        setCounts((prev) => ({
          ...prev,
          [selected.id]: Math.max(0, (prev[selected.id] ?? 1) - 1),
          [target.id]: (prev[target.id] ?? 0) + 1,
        }));
        setMovingPhoto(null);
        setMoveSearch("");
      } else {
        window.alert(json.error || "Could not move the photo.");
      }
    } catch {
      window.alert("Could not move the photo.");
    } finally {
      setMoveBusy(false);
    }
  }

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => {
      const name = `${clean(s.first_name)} ${clean(s.last_name)}`.toLowerCase();
      return (
        name.includes(q) ||
        clean(s.pin).includes(q) ||
        clean(s.class_name).toLowerCase().includes(q)
      );
    });
  }, [students, search]);

  const byClass = useMemo(() => {
    const map = new Map<string, Student[]>();
    for (const s of filteredStudents) {
      const cls = clean(s.class_name) || "Unassigned";
      if (!map.has(cls)) map.set(cls, []);
      map.get(cls)!.push(s);
    }
    return Array.from(map.entries());
  }, [filteredStudents]);

  // ── Per-student photo view ──
  if (selected) {
    const moveTargets = students
      .filter((s) => s.id !== selected.id)
      .filter((s) => {
        const q = moveSearch.trim().toLowerCase();
        if (!q) return true;
        const name = `${clean(s.first_name)} ${clean(s.last_name)}`.toLowerCase();
        return (
          name.includes(q) ||
          clean(s.pin).includes(q) ||
          clean(s.class_name).toLowerCase().includes(q)
        );
      });
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            color: "#6b7280",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            padding: 0,
            marginBottom: 10,
          }}
        >
          <ArrowLeft size={15} /> {schoolName || "Back"}
        </button>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#111827" }}>
          {fullName(selected)}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, marginBottom: 14 }}>
          {clean(selected.class_name) || "No class"} · PIN {clean(selected.pin) || "—"} ·{" "}
          {photos.length} photo{photos.length === 1 ? "" : "s"}
        </div>

        {photosLoading && photos.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9ca3af", padding: 12 }}>Loading photos…</div>
        ) : photos.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9ca3af", padding: 12 }}>
            No photos yet for this student.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {photos.map((p) => (
              <div
                key={p.key}
                style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: "#f3f4f6" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={proxiedPhotoUrl(p.key) || p.url}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <button
                  type="button"
                  onClick={() => setMovingPhoto(p)}
                  aria-label="Move to another student"
                  style={{
                    position: "absolute",
                    top: 5,
                    left: 5,
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: "none",
                    background: "rgba(17,24,39,0.8)",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <ArrowRightLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void deletePhoto(p.key)}
                  disabled={deletingKey === p.key}
                  aria-label="Delete photo"
                  style={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: "none",
                    background: "rgba(204,0,0,0.92)",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: deletingKey === p.key ? "default" : "pointer",
                    opacity: deletingKey === p.key ? 0.6 : 1,
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {movingPhoto ? (
          <div
            onClick={() => {
              if (!moveBusy) {
                setMovingPhoto(null);
                setMoveSearch("");
              }
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                width: "100%",
                maxWidth: 480,
                maxHeight: "80vh",
                borderRadius: "18px 18px 0 0",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #eef0f4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#111827" }}>
                  Move photo to…
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!moveBusy) {
                      setMovingPhoto(null);
                      setMoveSearch("");
                    }
                  }}
                  aria-label="Close"
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "#6b7280", padding: 0 }}
                >
                  <X size={20} />
                </button>
              </div>
              <div style={{ padding: "10px 14px" }}>
                <input
                  value={moveSearch}
                  onChange={(e) => setMoveSearch(e.target.value)}
                  placeholder="Search students…"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #e5e7eb", padding: "10px 12px", fontSize: 15, outline: "none" }}
                />
              </div>
              <div style={{ overflowY: "auto", padding: "0 8px 12px" }}>
                {moveTargets.map((s) => {
                  const cover = proxiedPhotoUrl(covers[s.id] || s.photo_url);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={moveBusy}
                      onClick={() => void doMove(s)}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 10, padding: "9px 10px", cursor: moveBusy ? "default" : "pointer" }}
                    >
                      <div style={{ width: 34, height: 34, borderRadius: 8, overflow: "hidden", background: "#eef0f4", flexShrink: 0, display: "grid", placeItems: "center" }}>
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <UserRound size={16} color="#b8bfca" />
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fullName(s)}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          {clean(s.class_name) || "No class"}
                          {typeof counts[s.id] === "number" ? ` · ${counts[s.id]} photos` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {moveTargets.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#9ca3af", padding: 12 }}>
                    No other students match.
                  </div>
                ) : null}
              </div>
              {moveBusy ? (
                <div style={{ padding: "8px 16px 14px", fontSize: 13, fontWeight: 700, color: "#6b7280" }}>
                  Moving…
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Student grid ──
  return (
    <div>
      <Link
        href="/m/sort"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "#6b7280",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "none",
          marginBottom: 10,
        }}
      >
        <ArrowLeft size={15} /> Schools
      </Link>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#111827" }}>
        {schoolName || "Sort & Review"}
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2, marginBottom: 14 }}>
        Tap a student to review and delete their photos.
      </div>

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search
          size={16}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280" }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students, PIN, class…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            padding: "12px 14px 12px 38px",
            fontSize: 15,
            fontWeight: 600,
            outline: "none",
          }}
        />
      </div>

      {loading ? (
        <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>Loading students…</div>
      ) : students.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>
          No students in this school yet.
        </div>
      ) : (
        byClass.map(([cls, group]) => (
          <div key={cls} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 800,
                color: "#6b7280",
                margin: "0 2px 8px",
              }}
            >
              {cls} · {group.length}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {group.map((s) => {
                const cover = proxiedPhotoUrl(covers[s.id] || s.photo_url);
                const count = counts[s.id];
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void openStudent(s)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        borderRadius: 12,
                        overflow: "hidden",
                        background: "#eef0f4",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cover}
                          alt=""
                          loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#b8bfca" }}>
                          <UserRound size={26} />
                        </div>
                      )}
                      {typeof count === "number" ? (
                        <div
                          style={{
                            position: "absolute",
                            top: 5,
                            right: 5,
                            minWidth: 22,
                            height: 22,
                            padding: "0 6px",
                            borderRadius: 11,
                            background: count > 0 ? "rgba(22,163,74,0.95)" : "rgba(17,17,17,0.6)",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 900,
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          {count}
                        </div>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#111827",
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fullName(s)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
