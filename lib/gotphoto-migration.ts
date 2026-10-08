/** CSV normalization for a reviewed, create-only import. No inferred identity,
 * gallery PIN, consent, payment, package or order history is imported. */
export const MIGRATION_MAX_ROWS = 5000;
export const MIGRATION_MAX_CSV_CHARS = 2_000_000;
export type MigrationKind = "roster" | "contacts";
export type MigrationMapping = Partial<Record<"sourceId" | "firstName" | "lastName" | "className" | "parentEmail" | "photoFilename" | "fullName" | "email" | "phone", string>>;
export type MigrationPhoto = { path: string; sha256: string; bytes: number };
export type MigrationStudent = { sourceId: string; externalId: string; firstName: string; lastName: string; className: string; parentEmail: string | null };
export type MigrationContact = { fullName: string; email: string; phone: string | null };
export type MigrationIssue = { row: number; message: string };
export type MigrationPreview = {
  kind: MigrationKind;
  students: MigrationStudent[];
  contacts: MigrationContact[];
  skipped: { row: number; identity: string; reason: string }[];
  photoAssociations: { sourceId: string; externalId: string; path: string; sha256: string; bytes: number }[];
  issues: MigrationIssue[];
  sourceRows: number;
};

export function parseMigrationCsv(input: string) {
  if (input.length > MIGRATION_MAX_CSV_CHARS) throw Error("CSV exceeds the 2 MB text limit. Import one school at a time.");
  const text = input.replace(/^\uFEFF/, "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw Error("CSV contains invalid control characters.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, afterQuote = false;
  const finishCell = () => { row.push(cell); cell = ""; afterQuote = false; };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > MIGRATION_MAX_ROWS + 1) throw Error(`Import at most ${MIGRATION_MAX_ROWS} rows at a time.`);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else cell += char;
    } else if (char === ",") finishCell();
    else if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (char === '"' && !cell && !afterQuote) quoted = true;
    else {
      if (afterQuote || char === '"') throw Error("Malformed CSV quoting. Export a comma-separated CSV with a header row.");
      cell += char;
    }
  }
  if (quoted) throw Error("CSV contains an unfinished quoted field.");
  if (cell || row.length || afterQuote) finishRow();
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  if (!headers.length || headers.some((value) => !value)) throw Error("Every CSV column needs a nonempty header.");
  if (headers.length > 100 || headers.some((value) => value.length > 300) || new Set(headers.map((value) => value.toLowerCase())).size !== headers.length) throw Error("CSV column headers must be unique (maximum 100 columns and 300 characters per header).");
  if (!rows.length) throw Error("CSV has no data rows.");
  if (rows.some((values) => values.length !== headers.length)) throw Error("CSV rows have different column counts.");
  return { headers, rows };
}

const normalizedHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function suggestMigrationMapping(headers: string[], kind: MigrationKind): MigrationMapping {
  const aliases: Record<string, string[]> = kind === "roster" ? {
    sourceId: ["gotphotochildid", "childid", "identifier", "studentid"],
    firstName: ["firstname"], lastName: ["lastname"], className: ["group", "class", "classname"],
    parentEmail: ["parentemail", "email"], photoFilename: ["photofilename", "filename", "imagefilename"],
  } : { fullName: ["fullname", "name", "customername"], firstName: ["firstname"], lastName: ["lastname"], email: ["email", "emailaddress"], phone: ["phone", "phonenumber"] };
  const mapping: MigrationMapping = {};
  for (const [field, candidates] of Object.entries(aliases)) {
    // Suggest one exact recognized header, never fuzzy-map an ambiguous pair.
    const matches = headers.filter((header) => candidates.includes(normalizedHeader(header)));
    if (matches.length === 1) mapping[field as keyof MigrationMapping] = matches[0];
  }
  return mapping;
}

function relativePhotoPath(value: string) {
  const path = value.trim();
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("\\") || path.includes(":")) return null;
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return /\.(jpe?g|png|webp)$/i.test(path) ? path : null;
}

function emailAddress(value: string, required: boolean) {
  const email = value.trim().toLowerCase();
  if (!email && !required) return null;
  if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) throw Error("Enter one valid email address.");
  return email;
}

export function previewGotphotoMigration(input: {
  kind: MigrationKind; csv: string; mapping: MigrationMapping; photos?: MigrationPhoto[];
  existingStudentIds?: string[]; existingContactEmails?: string[];
}): MigrationPreview {
  const { headers, rows } = parseMigrationCsv(input.csv);
  const required = input.kind === "roster" ? ["sourceId", "firstName", "lastName"] : ["email"];
  for (const field of required) if (!input.mapping[field as keyof MigrationMapping]) throw Error(`Map the ${field} column before previewing.`);
  if (input.kind === "contacts" && !input.mapping.fullName && !(input.mapping.firstName && input.mapping.lastName)) throw Error("Map the customer full name or both first and last name columns.");
  const allowed = input.kind === "roster" ? ["sourceId", "firstName", "lastName", "className", "parentEmail", "photoFilename"] : ["fullName", "firstName", "lastName", "email", "phone"];
  const used = Object.entries(input.mapping).filter(([, value]) => Boolean(value));
  if (used.some(([field, header]) => !allowed.includes(field) || !headers.includes(header!))) throw Error("The selected column mapping does not match this CSV and import type.");
  if (new Set(used.map(([, header]) => header)).size !== used.length) throw Error("Map each source column to only one field.");
  const get = (row: string[], field: keyof MigrationMapping, max = 300) => {
    const header = input.mapping[field];
    const value = header ? row[headers.indexOf(header)].trim() : "";
    if (value.length > max || /[\r\n\t]/.test(value)) throw Error(`${field} is too long or contains a line break.`);
    return value;
  };
  const result: MigrationPreview = { kind: input.kind, students: [], contacts: [], skipped: [], photoAssociations: [], issues: [], sourceRows: rows.length };
  const existingIds = new Set(input.existingStudentIds ?? []);
  const existingEmails = new Set((input.existingContactEmails ?? []).map((value) => value.trim().toLowerCase()));
  const seen = new Set<string>(), assignedPhotos = new Set<string>();
  const photoMap = new Map<string, MigrationPhoto>();
  if ((input.photos?.length ?? 0) > MIGRATION_MAX_ROWS) throw Error("Choose at most 5,000 image files for one preview.");
  for (const photo of input.photos ?? []) {
    const path = relativePhotoPath(photo.path);
    if (!path || !/^[a-f0-9]{64}$/.test(photo.sha256) || !Number.isSafeInteger(photo.bytes) || photo.bytes < 1 || photo.bytes > 25 * 1024 * 1024) throw Error("Image inventory must contain safe relative paths, SHA-256 hashes and images no larger than 25 MB.");
    if (photoMap.has(path)) throw Error(`Duplicate image path: ${path}. Keep the exported folder structure.`);
    photoMap.set(path, photo);
  }
  rows.forEach((row, index) => {
    const number = index + 2;
    try {
      if (input.kind === "roster") {
        const sourceId = get(row, "sourceId", 128), firstName = get(row, "firstName"), lastName = get(row, "lastName");
        if (!sourceId || !firstName || !lastName) throw Error("Student ID, first name and last name are required; identities cannot be inferred from names.");
        const externalId = `gotphoto:${sourceId}`;
        if (seen.has(externalId)) throw Error(`Duplicate source student ID: ${sourceId}.`);
        seen.add(externalId);
        const student = { sourceId, externalId, firstName, lastName, className: get(row, "className") || "Unassigned", parentEmail: emailAddress(get(row, "parentEmail"), false) };
        const filename = get(row, "photoFilename", 500);
        if (filename) {
          const path = relativePhotoPath(filename);
          if (!path) throw Error("Photo filename must be a safe, exact relative image path.");
          const photo = photoMap.get(path);
          if (!photo) throw Error(`Photo not found at the exact selected path: ${path}. No basename or student-name matching is performed.`);
          if (assignedPhotos.has(path)) throw Error(`The same photo is assigned to multiple students: ${path}.`);
          assignedPhotos.add(path);
          result.photoAssociations.push({ sourceId, externalId, ...photo });
        }
        if (existingIds.has(externalId)) result.skipped.push({ row: number, identity: sourceId, reason: "Existing student preserved. No fields or photos will be replaced." });
        else result.students.push(student);
      } else {
        const fullName = get(row, "fullName") || [get(row, "firstName"), get(row, "lastName")].filter(Boolean).join(" "), email = emailAddress(get(row, "email"), true)!;
        if (!fullName) throw Error("Customer name is required.");
        if (fullName.length > 300) throw Error("Customer name exceeds 300 characters.");
        if (seen.has(email)) throw Error(`Duplicate customer email: ${email}. Review the source rows rather than merge different people.`);
        seen.add(email);
        if (existingEmails.has(email)) result.skipped.push({ row: number, identity: email, reason: "Existing contact preserved, including consent and suppression settings." });
        else result.contacts.push({ fullName, email, phone: get(row, "phone", 100) || null });
      }
    } catch (error) {
      result.issues.push({ row: number, message: error instanceof Error ? error.message : "Invalid row." });
    }
  });
  return result;
}

export function migrationPhotoAssociationJson(preview: MigrationPreview) {
  // JSON preserves exact identities/paths without spreadsheet formula execution.
  return JSON.stringify({ schemaVersion: 1, source: "GotPhoto", photosUploaded: false,
    associations: [...preview.photoAssociations].sort((a, b) => a.externalId.localeCompare(b.externalId)),
  }, null, 2);
}
