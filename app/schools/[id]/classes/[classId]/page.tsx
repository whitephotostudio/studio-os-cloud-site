"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Settings,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

type School = {
  id: string;
  school_name: string;
  local_school_id: string | null;
};

type Student = {
  id: string;
  first_name: string;
  last_name: string | null;
  pin: string;
  photo_url: string | null;
  class_name: string | null;
  folder_name: string | null;
  external_student_id: string | null;
};

function fullNameOf(student: Student) {
  return `${student.first_name} ${student.last_name ?? ""}`.trim();
}

function extractObjectPathFromPublicUrl(url: string): string | null {
  try {
    const marker = "/storage/v1/object/public/thumbs/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.substring(idx + marker.length));
  } catch {
    return null;
  }
}

function extractFolderPathFromPublicUrl(url: string): string | null {
  const objectPath = extractObjectPathFromPublicUrl(url);
  if (!objectPath) return null;
  const lastSlash = objectPath.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return objectPath.substring(0, lastSlash);
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export default function ClassPage() {
  const supabase = createClient();
  const params = useParams();
  const schoolId = params?.id as string;
  const className = decodeURIComponent(params?.classId as string);

  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<School | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [error, setError] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [settingsStudent, setSettingsStudent] = useState<Student | null>(null);
  const [settingsName, setSettingsName] = useState("");
  const [settingsPin, setSettingsPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [lightbox, setLightbox] = useState<Student | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);
  const [photoUrlsMap, setPhotoUrlsMap] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (schoolId && className) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, className]);

  async function load() {
    setLoading(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      setUserEmail(user.email ?? "");
    }

    const { data: schoolData } = await supabase
      .from("schools")
      .select("id,school_name,local_school_id")
      .eq("id", schoolId)
      .maybeSingle();

    if (schoolData) {
      setSchool(schoolData);
    }

    const { data: rows, error: err } = await supabase
      .from("students")
      .select(
        "id,first_name,last_name,pin,photo_url,class_name,folder_name,external_student_id"
      )
      .eq("school_id", schoolId)
      .eq("class_name", className)
      .order("last_name", { ascending: true });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const loaded = rows ?? [];
    setStudents(loaded);

    const urlMap: Record<string, string[]> = {};

    await Promise.all(
      loaded.map(async (student) => {
        if (!student.photo_url) {
          urlMap[student.id] = [];
          return;
        }

        const folderPath = extractFolderPathFromPublicUrl(student.photo_url);
        if (!folderPath) {
          urlMap[student.id] = [student.photo_url];
          return;
        }

        try {
          const { data: files, error: listError } = await supabase.storage
            .from("thumbs")
            .list(folderPath, {
              limit: 1000,
              sortBy: { column: "name", order: "asc" },
            });

          if (listError || !files) {
            urlMap[student.id] = [student.photo_url];
            return;
          }

          const imageFiles = files
            .filter((file) => !!file.name && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
            .sort((a, b) => naturalCompare(a.name, b.name));

          const urls = imageFiles.map((file) =>
            supabase.storage.from("thumbs").getPublicUrl(`${folderPath}/${file.name}`).data.publicUrl
          );

          const uniqueUrls = Array.from(new Set([student.photo_url, ...urls]));
          urlMap[student.id] = uniqueUrls;
        } catch {
          urlMap[student.id] = [student.photo_url];
        }
      })
    );

    setPhotoUrlsMap(urlMap);
    setLoading(false);
  }

  function getPhotoUrls(student: Student): string[] {
    return photoUrlsMap[student.id] ?? (student.photo_url ? [student.photo_url] : []);
  }

  function getPhotoUrl(student: Student): string | null {
    return student.photo_url ?? null;
  }

  function openSettings(student: Student) {
    setSettingsStudent(student);
    setSettingsName(fullNameOf(student));
    setSettingsPin(student.pin);
    setShowPin(false);
    setSettingsMsg("");
    setOpenMenu(null);
  }

  async function handleSaveSettings() {
    if (!settingsStudent) return;

    setSettingsSaving(true);
    setSettingsMsg("");

    const parts = settingsName.trim().split(" ").filter(Boolean);

    const { error: err } = await supabase
      .from("students")
      .update({
        first_name: parts[0] ?? settingsStudent.first_name,
        last_name: parts.slice(1).join(" ") || settingsStudent.last_name,
        pin: settingsPin.trim(),
      })
      .eq("id", settingsStudent.id);

    if (err) {
      setSettingsMsg(err.message);
      setSettingsSaving(false);
      return;
    }

    setSettingsStudent(null);
    await load();
    setSettingsSaving(false);
  }

  async function handleDeleteStudent(studentId: string) {
    setOpenMenu(null);
    if (!confirm("Delete this student?")) return;
    await supabase.from("students").delete().eq("id", studentId);
    await load();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: "#000",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ background: "#fff", padding: "16px 20px" }}>
          <Logo />
        </div>

        <nav style={{ flex: 1, padding: "12px 8px" }}>
          <Link
            href={`/schools/${schoolId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "rgba(255,255,255,0.65)",
              borderRadius: 7,
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              marginBottom: 2,
            }}
          >
            <ArrowLeft size={16} /> {school?.school_name ?? "School"}
          </Link>

          <Link
            href={`/schools/${schoolId}/settings`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "rgba(255,255,255,0.65)",
              borderRadius: 7,
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            <Settings size={16} /> School Settings
          </Link>
        </nav>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "8px 8px 16px" }}>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              background: "transparent",
              border: "none",
              borderRadius: 7,
              padding: "10px 12px",
              fontSize: 13,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fff",
            borderBottom: "1px solid #e5e5e5",
            padding: "12px 32px",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Link href="/dashboard" style={{ color: "#888", textDecoration: "none" }}>
              Dashboard
            </Link>
            <span style={{ color: "#ddd" }}>/</span>
            <Link href={`/schools/${schoolId}`} style={{ color: "#888", textDecoration: "none" }}>
              {school?.school_name}
            </Link>
            <span style={{ color: "#ddd" }}>/</span>
            <span style={{ fontWeight: 600, color: "#333" }}>{className}</span>
          </div>

          <span style={{ fontSize: 13, color: "#999" }}>{userEmail}</span>
        </header>

        <div
          style={{
            background: "#fff",
            borderBottom: "1px solid #e5e5e5",
            padding: "14px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111", margin: 0 }}>
              {className}
            </h1>
            <p style={{ fontSize: 12, color: "#888", margin: "3px 0 0" }}>
              {students.length} Sub-Album{students.length !== 1 ? "s" : ""}
            </p>
          </div>

          <Link
            href={`/schools/${schoolId}/settings`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#f5f5f5",
              border: "1px solid #e0e0e0",
              color: "#333",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            <Settings size={13} /> Gallery Settings
          </Link>
        </div>

        <main style={{ flex: 1, padding: "32px" }}>
          {error && (
            <div
              style={{
                marginBottom: 16,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "14px 18px",
                color: "#b91c1c",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {loading && <p style={{ color: "#999", fontSize: 13 }}>Loading…</p>}

          {!loading && students.length === 0 && (
            <div
              style={{
                background: "#fff",
                border: "2px dashed #ddd",
                borderRadius: 12,
                padding: "60px 32px",
                textAlign: "center",
              }}
            >
              <p style={{ fontSize: 15, fontWeight: 600, color: "#555", margin: 0 }}>
                No students in this class
              </p>
            </div>
          )}

          {!loading && students.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 28,
              }}
            >
              {students.map((student) => {
                const photoUrl = getPhotoUrl(student);
                const photoUrls = getPhotoUrls(student);

                return (
                  <div key={student.id} style={{ position: "relative" }}>
                    <div style={{ position: "relative" }}>
                      <div
                        style={{
                          position: "absolute",
                          top: -6,
                          left: 8,
                          right: 8,
                          height: "calc(100% - 60px)",
                          background: "#c8c8c8",
                          borderRadius: "8px 8px 0 0",
                          zIndex: 0,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: -3,
                          left: 4,
                          right: 4,
                          height: "calc(100% - 60px)",
                          background: "#d8d8d8",
                          borderRadius: "8px 8px 0 0",
                          zIndex: 1,
                        }}
                      />

                      <div
                        style={{
                          position: "relative",
                          zIndex: 2,
                          background: "#fff",
                          borderRadius: 8,
                          overflow: "hidden",
                          boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                        }}
                      >
                        <div
                          onClick={() => {
                            if (photoUrls.length > 0) {
                              setLightbox(student);
                              setLightboxIndex(0);
                            }
                          }}
                          style={{
                            aspectRatio: "4/5",
                            background: "#e8e8e8",
                            overflow: "hidden",
                            cursor: photoUrls.length > 0 ? "pointer" : "default",
                            position: "relative",
                          }}
                        >
                          {photoUrl ? (
                            <img
                              src={photoUrl}
                              alt={fullNameOf(student)}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              onError={(e) => {
                                const target = e.currentTarget;
                                target.style.display = "none";
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  width: 52,
                                  height: 52,
                                  borderRadius: "50%",
                                  background: "#ccc",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 22,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                {student.first_name[0]}
                                {student.last_name?.[0] ?? ""}
                              </div>
                              <span style={{ fontSize: 11, color: "#aaa" }}>No photo synced</span>
                            </div>
                          )}
                        </div>

                        <div style={{ borderTop: "1px solid #f0f0f0" }}>
                          <div style={{ padding: "10px 12px 4px" }}>
                            <p
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: "#111",
                                margin: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {fullNameOf(student)}
                            </p>

                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                              <KeyRound size={10} color="#bbb" />
                              <span style={{ fontSize: 11, color: "#aaa" }}>Password protected</span>
                            </div>
                          </div>

                          <div style={{ display: "flex", borderTop: "1px solid #f0f0f0", marginTop: 8 }}>
                            <button
                              type="button"
                              onClick={() => openSettings(student)}
                              style={{
                                flex: 1,
                                padding: "9px 0",
                                background: "none",
                                border: "none",
                                borderRight: "1px solid #f0f0f0",
                                fontSize: 12,
                                color: "#555",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Album Settings
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenu(openMenu === student.id ? null : student.id);
                              }}
                              style={{
                                padding: "9px 14px",
                                background: "none",
                                border: "none",
                                color: "#555",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {openMenu === student.id && (
                      <>
                        <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                        <div
                          style={{
                            position: "absolute",
                            bottom: "calc(100% + 4px)",
                            right: 0,
                            background: "#fff",
                            border: "1px solid #e5e5e5",
                            borderRadius: 10,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                            zIndex: 50,
                            minWidth: 180,
                            overflow: "hidden",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => openSettings(student)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 14px",
                              fontSize: 13,
                              color: "#111",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              borderBottom: "1px solid #f5f5f5",
                            }}
                          >
                            Album Settings
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (photoUrls.length > 0) {
                                setLightbox(student);
                                setLightboxIndex(0);
                              }
                              setOpenMenu(null);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 14px",
                              fontSize: 13,
                              color: "#111",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              borderBottom: "1px solid #f5f5f5",
                            }}
                          >
                            View Photos
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteStudent(student.id)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 14px",
                              fontSize: 13,
                              color: "#ef4444",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            Delete Student
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {settingsStudent && (
        <>
          <div
            onClick={() => setSettingsStudent(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 100,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 420,
              maxWidth: "calc(100vw - 32px)",
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
              zIndex: 101,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 18px",
                borderBottom: "1px solid #eee",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111" }}>
                  Album Settings
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "#888" }}>
                  Update album name and password
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSettingsStudent(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#999",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#666",
                    marginBottom: 6,
                  }}
                >
                  Album Name
                </label>
                <input
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#666",
                    marginBottom: 6,
                  }}
                >
                  Password / PIN
                </label>

                <div style={{ position: "relative" }}>
                  <input
                    type={showPin ? "text" : "password"}
                    value={settingsPin}
                    onChange={(e) => setSettingsPin(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 38px 10px 12px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#999",
                    }}
                  >
                    {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {settingsMsg && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#b91c1c",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "10px 12px",
                    borderRadius: 8,
                  }}
                >
                  {settingsMsg}
                </div>
              )}
            </div>

            <div
              style={{
                padding: 18,
                borderTop: "1px solid #eee",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setSettingsStudent(null)}
                style={{
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#555",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={settingsSaving}
                style={{
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#111",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#fff",
                  cursor: settingsSaving ? "default" : "pointer",
                  opacity: settingsSaving ? 0.7 : 1,
                }}
              >
                {settingsSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </>
      )}

      {lightbox && (
        <>
          <div
            onClick={() => setLightbox(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.85)",
              zIndex: 200,
            }}
          />

          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 201,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                color: "#fff",
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fullNameOf(lightbox)}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  Password protected
                </div>
              </div>

              <button
                type="button"
                onClick={() => setLightbox(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <X size={24} />
              </button>
            </div>

            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px 24px",
                gap: 16,
              }}
            >
              <button
                type="button"
                onClick={() => setLightboxIndex((prev) => Math.max(0, prev - 1))}
                disabled={lightboxIndex === 0}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  cursor: lightboxIndex === 0 ? "default" : "pointer",
                  opacity: lightboxIndex === 0 ? 0.3 : 1,
                }}
              >
                <ChevronLeft size={22} />
              </button>

              <div
                style={{
                  maxWidth: "min(1000px, 75vw)",
                  maxHeight: "70vh",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {getPhotoUrls(lightbox)[lightboxIndex] ? (
                  <img
                    src={getPhotoUrls(lightbox)[lightboxIndex]}
                    alt={fullNameOf(lightbox)}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "70vh",
                      objectFit: "contain",
                      borderRadius: 8,
                      boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
                    }}
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.style.display = "none";
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 400,
                      height: 500,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px dashed rgba(255,255,255,0.25)",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    No photo available
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  setLightboxIndex((prev) =>
                    Math.min(getPhotoUrls(lightbox).length - 1, prev + 1)
                  )
                }
                disabled={lightboxIndex >= getPhotoUrls(lightbox).length - 1}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  cursor:
                    lightboxIndex >= getPhotoUrls(lightbox).length - 1
                      ? "default"
                      : "pointer",
                  opacity: lightboxIndex >= getPhotoUrls(lightbox).length - 1 ? 0.3 : 1,
                }}
              >
                <ChevronRight size={22} />
              </button>
            </div>

            <div
              style={{
                padding: "16px 24px 24px",
                display: "flex",
                justifyContent: "center",
                gap: 10,
                overflowX: "auto",
              }}
            >
              {getPhotoUrls(lightbox).map((url, idx) => (
                <button
                  key={`${lightbox.id}-${idx}`}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  style={{
                    border:
                      idx === lightboxIndex
                        ? "2px solid #fff"
                        : "1px solid rgba(255,255,255,0.2)",
                    background: "none",
                    padding: 0,
                    borderRadius: 6,
                    overflow: "hidden",
                    width: 72,
                    height: 90,
                    flexShrink: 0,
                    cursor: "pointer",
                    opacity: idx === lightboxIndex ? 1 : 0.75,
                  }}
                >
                  <img
                    src={url}
                    alt={`${fullNameOf(lightbox)} ${idx + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.style.visibility = "hidden";
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}