"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

const sidebarStyle: React.CSSProperties = {
  width: 220,
  minHeight: "100vh",
  background: "#000",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const navItemStyle: React.CSSProperties = {
  padding: "12px 24px",
  fontSize: 14,
  color: "#ccc",
  textDecoration: "none",
  display: "block",
};

const navActiveStyle: React.CSSProperties = {
  ...navItemStyle,
  color: "#fff",
  background: "#1a1a1a",
};

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", match: /^\/dashboard$/ },
  { href: "/dashboard/schools", label: "Schools", match: /^\/dashboard\/schools/ },
  { href: "/dashboard/projects/events", label: "Projects", match: /^\/dashboard\/projects/ },
  { href: "/dashboard/orders", label: "Orders", match: /^\/dashboard\/orders/ },
  { href: "/dashboard/packages", label: "Packages", match: /^\/dashboard\/packages/ },
  { href: "/dashboard/settings", label: "Settings", match: /^\/dashboard\/settings/ },
  { href: "/dashboard/membership", label: "Membership", match: /^\/dashboard\/membership/ },
  { href: "/dashboard/feature-requests", label: "Feature Requests", match: /^\/dashboard\/feature-requests/ },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserEmail(user.email ?? "");
      const { data: pg } = await supabase
        .from("photographers")
        .select("is_platform_admin")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pg?.is_platform_admin || user.email?.toLowerCase() === "harout@me.com") {
        setIsAdmin(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <aside style={sidebarStyle}>
      <div style={{ padding: 18, background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ background: "#ffffff", borderRadius: 16, padding: "14px 16px" }}>
          <Link href="/" style={{ display: "inline-flex" }}>
            <Logo small />
          </Link>
        </div>
      </div>

      <nav style={{ flex: 1, paddingTop: 18 }}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={item.match.test(pathname) ? navActiveStyle : navItemStyle}
          >
            {item.label}
          </Link>
        ))}
        {isAdmin && (
          <Link
            href="/dashboard/admin/users"
            style={/^\/dashboard\/admin/.test(pathname) ? navActiveStyle : navItemStyle}
          >
            Admin
          </Link>
        )}
      </nav>

      <div style={{ padding: "0 16px", color: "#888", fontSize: 13 }}>{userEmail}</div>
      <button
        onClick={handleSignOut}
        style={{
          margin: "12px 16px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "center",
          background: "transparent",
          color: "#ccc",
          border: "1px solid #333",
          borderRadius: 10,
          padding: "10px 12px",
          cursor: "pointer",
        }}
      >
        <LogOut size={16} /> Sign Out
      </button>
    </aside>
  );
}
