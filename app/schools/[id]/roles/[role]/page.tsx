"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  LogOut,
  Settings,
  Shield,
  Star,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

type School = {
  id: string;
  school_name: string;
  local_school_id: string | null;
};

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string | null;
  role: string | null;
  photo_url: string | null;
  pin?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeRole(rawRole: string | null | undefined): string {
  const role = clean(rawRole).toLowerCase();

  if (!role) return "Unassigned";
  if (role === "student" || role === "students") return "Student";
  if (role === "teacher" || role === "teachers") return "Teacher";
  if (role === "coach" || role === "coaches") return "Coach";
  if (role === "principal" || role === "head principal" || role === "school principal") {
    return "Principal";
  }
  if (
    role === "office" ||
    role === "office staff" ||
    role === "admin" ||
    role === "administrator" ||
    role === "administration" ||
    role === "front office"
  ) {
    return "Office Staff";
  }
  if (
    role === "staff" ||
    role === "faculty" ||
    role === "employee" ||
    role === "employees" ||
    role === "support staff" ||
    role === "school staff"
  ) {
    return "Staff";
  }

  return clean(rawRole) || "Unassigned";
}

function getRoleIcon(role: string) {
  switch (role) {
    case "Teacher":
      return <UserRound size={20} color="#555" />;
    case "Coach":
      return <Shield size={20} color="#555" />;
    case "Principal":
      return <Star size={20} color="#555" />;
    case "Office Staff":
      return <UserCog size={20} color="#555" />;
    case "Staff":
      return <Briefcase size={20} color="#555" />;
    default:
      return <Users size={20} color="#555" />;
  }
}

export default function RoleGalleryPage() {
  const supabase = createClient();
  const params = useParams();

  const schoolId = params?.id as string;
  const rawRoleParam = params?.role;
  const rawRole = Array.isArray(rawRoleParam) ? rawRoleParam[0] : (rawRoleParam as string);
  const normalizedRouteRole = useMemo(
    () => normalizeRole(decodeURIComponent(rawRole || "")),
    [rawRole]
  );

  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<School | null>(null);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        if (!schoolId || !rawRole) {
          throw new Error("Missing school id or role.");
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!cancelled && user) {
          setUserEmail(user.email ?? "");
        }

        const { data: s, error: schoolError } = await supabase
          .from("schools")
          .select("id,school_name,local_school_id")
          .eq("id", schoolId)
          .maybeSingle();

        if (schoolError) throw schoolError;
        if (!s) throw new Error("School not found.");

        const { data, error: peopleError } = await supabase
          .from("students")
          .select("id,first_name,last_name,class_name,role,photo_url")
          .eq("school_id", schoolId)
          .order("last_name", { ascending: true })
          .order("first_name", { ascending: true });

        if (peopleError) throw peopleError;

        const filtered = ((data ?? []) as PersonRow[]).filter((person) => {
          const role = normalizeRole(person.role);
          const className = clean(person.class_name);

          if (normalizedRouteRole === "Unassigned") {
            return !className && (role === "Unassigned" || !clean(person.role));
          }

          return !className && role === normalizedRouteRole;
        });

        if (!cancelled) {
          setSchool(s);
          setRows(filtered);
        }
      } catch (err: any) {
        console.error("ROLE PAGE ERROR:", err);
        if (!cancelled) {
          setError(err?.message || "Failed to load role gallery.");
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [schoolId, rawRole, normalizedRouteRole, supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  const title = useMemo(() => normalizedRouteRole, [normalizedRouteRole]);

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
            href="/dashboard"
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
            <ArrowLeft size={16} /> Dashboard
          </Link>

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
            <Users size={16} /> School Galleries
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
              ← Schools
            </Link>
            {school && (
              <>
                <span style={{ color: "#ccc" }}>/</span>
                <Link
                  href={`/schools/${schoolId}`}
                  style={{ color: "#888", textDecoration: "none" }}
                >
                  {school.school_name}
                </Link>
                <span style={{ color: "#ccc" }}>/</span>
                <span style={{ fontWeight: 600, color: "#333" }}>{title}</span>
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link
              href={`/schools/${schoolId}/settings`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#f5f5f5",
                border: "1px solid #e5e5e5",
                color: "#333",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <Settings size={13} /> Settings
            </Link>
            <span style={{ fontSize: 13, color: "#999" }}>{userEmail}</span>
          </div>
        </header>

        <main style={{ flex: 1, padding: "28px 32px" }}>
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

          {!loading && school && (
            <>
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {getRoleIcon(title)}
                  <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111", margin: 0 }}>
                    {title}
                  </h1>
                </div>
                <p style={{ fontSize: 13, color: "#888", marginTop: 6 }}>
                  {rows.length} person{rows.length !== 1 ? "s" : ""} in this gallery
                </p>
              </div>

              {rows.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    border: "2px dashed #ddd",
                    borderRadius: 12,
                    padding: "60px 32px",
                    textAlign: "center",
                  }}
                >
                  <Users size={40} color="#ccc" style={{ margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#555", margin: 0 }}>
                    No people found in this role
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 18,
                  }}
                >
                  {rows.map((person) => {
                    const fullName =
                      `${clean(person.first_name)} ${clean(person.last_name)}`.trim() || "Unnamed";

                    return (
                      <div
                        key={person.id}
                        style={{
                          background: "#fff",
                          border: "1px solid #e5e5e5",
                          borderRadius: 14,
                          overflow: "hidden",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                        }}
                      >
                        <div
                          style={{
                            aspectRatio: "4 / 5",
                            background: "#f3f3f3",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          {clean(person.photo_url) ? (
                            <img
                              src={person.photo_url ?? ""}
                              alt={fullName}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block",
                              }}
                            />
                          ) : (
                            <div style={{ color: "#999", fontSize: 12 }}>No photo synced</div>
                          )}
                        </div>

                        <div style={{ padding: 14 }}>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 14,
                              fontWeight: 700,
                              color: "#111",
                            }}
                          >
                            {fullName}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}