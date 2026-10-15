import { compareSchoolVisitorClasses, DEFAULT_SCHOOL_VISITOR_FILTERS, isSchoolVisitorClassRangeValid, schoolVisitorClassGrade, type SchoolVisitorFilters } from "@/lib/school-visitor-filters";

export function SchoolVisitorReportControls({ filters, onChange, classNames, counts }: {
  filters: SchoolVisitorFilters;
  onChange: (filters: SchoolVisitorFilters) => void;
  classNames: string[];
  counts: { all: number; ordered: number; no_orders: number; paid: number; digitals: number };
}) {
  const cards = [
    ["all", "Contacts"], ["ordered", "With orders"], ["no_orders", "No orders yet"],
    ["paid", "Paid buyers"], ["digitals", "Digital buyers"],
  ] as const;
  const sortedClasses = [...classNames].sort(compareSchoolVisitorClasses);
  const rangeMode = filters.classMode === "range";
  const grades = [...new Set(classNames.map(schoolVisitorClassGrade).filter((grade): grade is number => grade !== null))];
  const endOptions = [...new Set([...sortedClasses, ...grades.map(grade => `Grade ${grade}`)])].sort(compareSchoolVisitorClasses);
  const invalidRange = rangeMode && !isSchoolVisitorClassRangeValid(filters.classFrom, filters.classTo);
  const control = { padding: "9px 12px", border: "1px solid #ddd", borderRadius: 6, background: "#fff", color: "#111", fontSize: 13 };
  return <div style={{ marginBottom: 18, color: "#111" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
      {cards.map(([key, label]) => <button key={key} type="button" onClick={() => onChange({ ...filters, orders: key })}
        aria-pressed={filters.orders === key}
        style={{ textAlign: "left", minWidth: 130, flex: "1 1 130px", padding: "12px 16px", borderRadius: 8,
          border: filters.orders === key ? "1px solid #111" : "1px solid #ddd", background: "#fff", color: "#111", cursor: "pointer" }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{counts[key]}</div>
        <div style={{ marginTop: 3, fontSize: 12 }}>{label}</div>
      </button>)}
    </div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
      <label style={{ fontSize: 12, display: "grid", gap: 5 }}>Class selection
        <select aria-label="Class selection mode" value={rangeMode ? "range" : "single"} onChange={event => {
          const classMode = event.target.value as "single" | "range";
          onChange({ ...filters, classMode, classFrom: filters.classFrom || filters.className || sortedClasses[0] || "", classTo: filters.classTo || sortedClasses.at(-1) || "" });
        }} style={control}>
          <option value="single">All classes / one class</option><option value="range" disabled={!sortedClasses.length}>Class range</option>
        </select>
      </label>
      {rangeMode ? <>
        <label style={{ fontSize: 12, display: "grid", gap: 5 }}>From class
          <select aria-label="Filter from class" value={filters.classFrom || ""} onChange={event => onChange({ ...filters, classFrom: event.target.value })} style={control}>
            <option value="" disabled>Choose starting class</option>
            {sortedClasses.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, display: "grid", gap: 5 }}>Through class or grade
          <select aria-label="Filter through class or grade" value={filters.classTo || ""} onChange={event => onChange({ ...filters, classTo: event.target.value })} style={control}>
            <option value="" disabled>Choose ending class or grade</option>
            {endOptions.map(name => <option key={name} value={name}>{/^Grade \d+$/.test(name) ? `${name} (all sections)` : name}</option>)}
          </select>
        </label>
      </> : <label style={{ fontSize: 12, display: "grid", gap: 5 }}>Class
        <select aria-label="Filter by class" value={filters.className} onChange={event => onChange({ ...filters, className: event.target.value })} style={control}>
          <option value="">All classes</option>
          {sortedClasses.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>}
      <label style={{ fontSize: 12, display: "grid", gap: 5 }}>Orders
        <select aria-label="Filter by orders" value={filters.orders} onChange={event => onChange({ ...filters, orders: event.target.value as SchoolVisitorFilters["orders"] })} style={control}>
          <option value="all">All contacts</option><option value="ordered">Has placed an order</option>
          <option value="no_orders">No orders yet</option><option value="paid">Has a paid order</option>
          <option value="unpaid">Orders without confirmed payment</option><option value="digitals">Purchased digital images</option>
        </select>
      </label>
      <label style={{ fontSize: 12, display: "grid", gap: 5 }}>Activity
        <select aria-label="Filter by activity" value={filters.activity} onChange={event => onChange({ ...filters, activity: event.target.value as SchoolVisitorFilters["activity"] })} style={control}>
          <option value="all">All activity</option><option value="registered">Registered for updates</option>
          <option value="visited">Visited gallery</option><option value="favorites">Has favorites</option>
          <option value="downloads">Downloaded photos</option>
        </select>
      </label>
      <button type="button" onClick={() => onChange({ ...DEFAULT_SCHOOL_VISITOR_FILTERS })} style={{ ...control, cursor: "pointer" }}>Clear filters</button>
    </div>
    <div style={{ color: "#666", fontSize: 12, marginTop: 10 }}>
      {invalidRange ? <span role="alert">Choose a starting class at or before the ending class. </span> : rangeMode ? <>The range includes both ends; a grade includes every section. </> : null}
      Counts are contacts matching the class{rangeMode ? " range" : ""}, search and activity filters. “No orders yet” excludes unpaid and cancelled orders.
    </div>
  </div>;
}
