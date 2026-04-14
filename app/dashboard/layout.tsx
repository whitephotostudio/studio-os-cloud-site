"use client";

import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <DashboardSidebar />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
