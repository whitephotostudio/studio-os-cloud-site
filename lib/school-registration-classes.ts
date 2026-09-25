import type { SupabaseClient } from "@supabase/supabase-js";

export async function schoolRegistrationClasses(service: SupabaseClient, schoolId: string) {
  const names = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.from("students").select("id,class_name,role")
      .eq("school_id", schoolId).order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) {
      const role = String(row.role ?? "").trim().toLowerCase();
      const name = String(row.class_name ?? "").trim();
      if (name && (!role || role === "student")) names.add(name);
    }
    if ((data ?? []).length < 500) break;
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}
