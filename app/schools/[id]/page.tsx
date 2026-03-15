"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  GraduationCap,
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
};

type GalleryCard = {
  key: string;
  label: string;
  count: number;
  href: string;
  kind: "class" | "role";
};

const ROLE_ORDER = [
  "Teacher",
  "Coach",
  "Principal",
  "Office Staff",
  "Staff",
  "Unassigned",
] as const;

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

function isStudentLike(role: string, className: string) {
  if (className) return true;
  return role === "Student";
}

function getRoleIcon(role: string) {
  switch (role) {
    case "Teacher":
      return <UserRound size={22} color="#555" />;
    case "Coach":
      return <Shield size={22} color="#555" />;
    case "Principal":
      return <Star size={22} color="#555" />;
    case "Office Staff":
      return <UserCog size={22} color="#555" />;
    case "Staff":
      return <Briefcase size={22} color="#555" />;
    default:
      return <Users size={22} color="#555" />;
  }
}

function GalleryCardView({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          cursor: "pointer",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "none";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "#f0f0f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#111", margin: 0 }}>{title}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
              <Users size={11} color="#999" />
              <span style={{ fontSize: 12, color: "#888" }}>{subtitle}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function SchoolDetailPage() {
  const [supabase] = useState(() => createClient());
  const params = useParams();
  const schoolId = params?.id as string;

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
        if (!schoolId) throw new Error("Missing school id.");

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!cancelled && user) {
          setUserEmail(user.email ?? "");
        }

        const { data: schoolRow, error: schoolError } = await supabase
          .from("schools")
          .select("id,school_name,local_school_id")
          .eq("id", schoolId)
          .maybeSingle();

        if (schoolError) throw schoolError;
        if (!schoolRow) throw new Error("School not found.");

        const { data: peopleRows, error: peopleError } = await supabase
          .from("students")
          .select("id,first_name,last_name,class_name,role,photo_url")
          .eq("school_id", schoolId);

        if (peopleError) throw peopleError;

        if (!cancelled) {
          setSchool(schoolRow);
          setRows((peopleRows ?? []) as PersonRow[]);
        }
      } catch (err: any) {
        console.error("SCHOOL PAGE ERROR:", err);
        if (!cancelled) {
          setError(err?.message || "Failed to load school.");
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
  }, [schoolId]);

  const grouped = useMemo(() => {
    const classCounts: Record<string, number> = {};
    const roleCounts: Record<string, number> = {};
    let totalStudents = 0;

    for (const row of rows) {
      const className = clean(row.class_name);
      const role = normalizeRole(row.role);

      if (isStudentLike(role, className)) {
        totalStudents += 1;
        if (className) {
          classCounts[className] = (classCounts[className] ?? 0) + 1;
        }
      } else {
        roleCounts[role] = (roleCounts[role] ?? 0) + 1;
      }
    }

    const classCards: GalleryCard[] = Object.keys(classCounts)
      .sort((a, b) => a.localeCompare(b))
      .map((className) => ({
        key: `class:${className}`,
        label: className,
        count: classCounts[className],
        href: `/schools/${schoolId}/classes/${encodeURIComponent(className)}`,
        kind: "class",
      }));

    const roleKeys = [
      ...ROLE_ORDER.filter((role) => roleCounts[role] > 0),
      ...Object.keys(roleCounts)
        .filter((role) => !ROLE_ORDER.includes(role as (typeof ROLE_ORDER)[number]))
        .sort((a, b) => a.localeCompare(b)),
    ];

    const roleCards: GalleryCard[] = roleKeys.map((role) => ({
      key: `role:${role}`,
      label: role,
      count: roleCounts[role],
      href: `/schools/${schoolId}/roles/${encodeURIComponent(role)}`,
      kind: "role",
    }));

    return {
      classCards,
      roleCards,
      totalPeople: rows.length,
      totalStudents,
    };
  }, [rows, schoolId]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  const hasAnyGalleries = grouped.classCards.length > 0 || grouped.roleCards.length > 0;

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
                <span style={{ fontWeight: 600, color: "#333" }}>{school.school_name}</span>
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
                <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111", margin: 0 }}>
                  {school.school_name}
                </h1>
                <p style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
                  {grouped.totalPeople} people synced — {grouped.totalStudents} students with role galleries where available
                </p>
              </div>

              {!hasAnyGalleries ? (
                <div
                  style={{
                    background: "#fff",
                    border: "2px dashed #ddd",
                    borderRadius: 12,
                    padding: "60px 32px",
                    textAlign: "center",
                  }}
                >
                  <GraduationCap size={40} color="#ccc" style={{ margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#555", margin: 0 }}>
                    No galleries yet
                  </p>
                  <p style={{ fontSize: 13, color: "#999", marginTop: 6 }}>
                    Sync students and staff from Studio OS — class and role galleries will appear automatically.
                  </p>
                </div>
              ) : (
                <>
                  {grouped.classCards.length > 0 && (
                    <section style={{ marginBottom: 28 }}>
                      <h2
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#111",
                          margin: "0 0 12px 0",
                        }}
                      >
                        Student Galleries
                      </h2>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                          gap: 16,
                        }}
                      >
                        {grouped.classCards.map((card) => (
                          <GalleryCardView
                            key={card.key}
                            href={card.href}
                            title={card.label}
                            subtitle={`${card.count} student${card.count !== 1 ? "s" : ""}`}
                            icon={<GraduationCap size={22} color="#555" />}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {grouped.roleCards.length > 0 && (
                    <section>
                      <h2
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#111",
                          margin: "0 0 12px 0",
                        }}
                      >
                        Role Galleries
                      </h2>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                          gap: 16,
                        }}
                      >
                        {grouped.roleCards.map((card) => (
                          <GalleryCardView
                            key={card.key}
                            href={card.href}
                            title={card.label}
                            subtitle={`${card.count} person${card.count !== 1 ? "s" : ""}`}
                            icon={getRoleIcon(card.label)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}