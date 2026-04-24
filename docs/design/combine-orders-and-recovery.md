# Combine Orders, Cross-Year Orders, and PIN Recovery — Design Doc

**Status:** Approved · ready to build.
**Target phase:** Phase 1 (first shippable slice).
**Last updated:** 2026-04-24 · Version 1.

This document is the single source of truth for the "combine sibling orders"
feature, cross-year (past-year) ordering, and the self-service lost-PIN
recovery flow. Every decision on this page is locked — if something here is
ambiguous, ask before building. If the implementation diverges, update this
file first.

---

## 1. What we're building (one-paragraph summary)

Today a parent with three kids at the same school has to log in three
separate times, build three separate carts, pay three shipping fees, and
complete three checkouts. We're collapsing that into **one cart, one
checkout, one shipping fee, and one credit-card charge** — with a tiered
sibling discount automatically applied. The same plumbing also powers
cross-year orders (this year's Grade 5 photos + last year's Grade 4 photos)
and lost-PIN recovery (parent forgot the PIN for a sibling's gallery and
can self-serve instead of emailing the photographer).

Every surface is designed with upsell in mind — the feature only earns its
keep if it lifts average cart size.

---

## 2. The 11 locked decisions

| # | Decision | Answer |
|---|---|---|
| 1 | Sibling discount model | **Tiered:** 2 kids = 5% off additional, 3+ kids = 10% off additional. Configurable per studio. |
| 2 | Discount math | First kid at full price; each additional kid's **product subtotal** gets the % off. Shipping is never discounted. |
| 3 | Cross-school within same studio in Phase 1 | **Yes.** Parent can combine siblings at different schools under the same studio. |
| 4 | Shipping | **Never free.** Two options: School Pickup (free, default during order window) OR Ship (paid, configurable per studio). After the school's `order_due_date`, pickup is disabled and shipping is forced with a **10% late handling fee** and a visible banner. |
| 5 | Past-year scarcity copy | Photographer sets an optional `archive_date` per school/event; copy reads *"Archived on [date] — last chance"* when set. |
| 6 | "Combine & save" pill placement | **Both** — gallery header AND cart sidebar. |
| 7 | Past-year school dropdown | Shows **all schools** the studio has ever shot, not just same-name. |
| 8 | Sibling discount applies cross-year | **Yes.** Any additional student context in the cart counts. |
| 9 | Smart email auto-detect banner | **Phase 1b** (post-ship). Phase 1 is manual drawer only. |
| 10 | Lost-PIN recovery drawer | **Ship in Phase 1.** Four-question verification, secure link delivery. |
| 11 | Pre-registration email as recovery door | **Yes.** Only emails that were pre-registered for that specific school/event can self-recover. Non-registered parents see a photographer-contact fallback. |

---

## 3. Data model changes

All database changes land in one migration: `supabase/migrations/YYYYMMDD_combine_orders_and_recovery.sql`.

### 3.1 New columns

```sql
-- Orders grouping — links all orders in a combined checkout.
alter table public.orders
  add column order_group_id uuid null;
create index orders_order_group_id_idx on public.orders (order_group_id);

-- Sibling discount + shipping fee config — studio-wide defaults.
alter table public.photographers
  add column sibling_discount_tiers jsonb not null default '{"2": 5, "3": 10}'::jsonb,
  add column shipping_fee_cents integer not null default 0,
  add column late_handling_fee_percent numeric(5,2) not null default 10.0;

-- Per-school / per-event due date + archive date.
alter table public.schools
  add column order_due_date timestamptz null,
  add column archive_date   timestamptz null;

alter table public.projects
  add column order_due_date timestamptz null,
  add column archive_date   timestamptz null;
```

### 3.2 New tables

```sql
-- Rate limit + audit log for PIN recovery attempts.
-- Used by the recovery API to throttle abuse and give photographers a
-- visible audit trail of recovery activity.
create table public.pin_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_address text,
  user_agent text,
  photographer_id uuid references public.photographers(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  email_tried text,
  first_name_tried text,
  last_name_tried text,
  succeeded boolean not null default false,
  failure_reason text,  -- e.g. "no_student_match", "email_not_registered", "rate_limited"
  created_at timestamptz not null default now()
);
create index pin_recovery_attempts_ip_idx
  on public.pin_recovery_attempts (ip_address, created_at desc);
create index pin_recovery_attempts_student_idx
  on public.pin_recovery_attempts (student_id, created_at desc);

-- Tier 3 fallback: a queue of manual recovery requests that the
-- photographer can resolve from the dashboard with one click.
create table public.pin_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  student_id uuid null references public.students(id) on delete set null,
  parent_email text not null,
  typed_first_name text,
  typed_last_name text,
  typed_school_label text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  photographer_note text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references public.photographers(id)
);
create index pin_recovery_requests_photographer_status_idx
  on public.pin_recovery_requests (photographer_id, status, requested_at desc);

-- Single-use signed magic-link tokens for PIN recovery delivery.
-- Never store raw PINs here; the token maps to a student_id + parent_email
-- and self-authenticates into that gallery when clicked.
create table public.pin_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  student_id uuid not null references public.students(id) on delete cascade,
  parent_email text not null,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  ip_used text
);
create index pin_recovery_tokens_expires_idx on public.pin_recovery_tokens (expires_at) where used_at is null;
```

### 3.3 Existing tables we read from

- `public.students` — first_name, last_name, class_name, school_id, pin, parent_email
- `public.schools` — school_name, photographer_id, status, gallery_slug, order_due_date, archive_date
- `public.projects` — title, photographer_id, workflow_type, order_due_date, archive_date
- **Pre-registration table** (to confirm at build time — likely `public.school_visitors` / `public.project_visitors` or the `emails` table used by the pre-release emailer). This is the source of truth for door #2 in the recovery flow. Exact column name TBD during inspection; likely `email` keyed to a `school_id` or `project_id`.

### 3.4 RLS

- `pin_recovery_attempts` — service-role only (no client reads).
- `pin_recovery_requests` — photographer can SELECT/UPDATE their own; inserts happen server-side.
- `pin_recovery_tokens` — service-role only; tokens are consumed by the portal API, never by a client.

---

## 4. Parent-facing flows

### 4.1 Cart refactor

Today `cartItems` is a flat array of `CartLineItem`, tied implicitly to whatever gallery the parent is viewing. We tag every item with the full context so the cart can span students:

```ts
type CartLineItem = {
  // ... existing fields
  studentId: string | null;          // null for event-mode items
  studentName: string | null;
  className: string | null;
  schoolId: string | null;           // null for event-mode items
  schoolName: string | null;
  projectId: string | null;          // null for school-mode items
  projectName: string | null;
  shootYear: number | null;          // resolved from school.shoot_year or project.event_date year
};
```

Cart UI groups visually by student:

```
┌─ Ethan Rivera · Grade 5 · Riverside Prep · 2026 ─────┐
│ Wallets (8 Cut) Lustre              1×     $23.67    │
│ Digital Downloads                   1×     $20.00    │
│ Subtotal                                   $43.67    │
└──────────────────────────────────────────────────────┘

┌─ Lily Rivera · Grade 2 · Riverside Prep · 2026 ──────┐
│ Sibling pack · 10% off                               │
│ 8×10 Print                          1×     $18.00    │
│ Subtotal (before discount)                 $18.00    │
│ Sibling discount (10%)                     −$1.80    │
│ Subtotal                                   $16.20    │
└──────────────────────────────────────────────────────┘

Shipping (flat)                                $8.00
                                     ───────────────
Grand total                                    $67.87
You're saving $1.80 with sibling combine ✨
```

### 4.2 "Combine & save" pill

Renders in two places:
- **Gallery header** — floating pill below the title bar, copy: *"✨ Save 10% — combine sibling orders"*
- **Cart sidebar header** — small inline pill, same copy

Both open the same drawer (§4.3).

### 4.3 The recovery / combine drawer

Single `<CombineOrdersDrawer>` with three tabs. Only rendered when the parent is already authenticated into one gallery (combine is not a login surface).

```
┌─ Add another gallery ────────────────────────────── ✕ ┐
│                                                       │
│  [Add a sibling]  [Older photos]  [I lost the PIN]   │
│   ─────────────                                       │
│                                                       │
│   School: [Searchable dropdown — this studio]     ▾  │
│   Email:  [_____________________]                    │
│   PIN:    [____-____]                                │
│                                                       │
│   [Add to my cart]                                    │
│                                                       │
│   💡 Parents with 3+ kids unlock 10% off additional  │
│      siblings. You're 1 sibling away.                │
└──────────────────────────────────────────────────────┘
```

**Tab 1 — Add a sibling (current year).**
- School dropdown: every school within this studio whose shoot year matches the currently-authenticated gallery, excluding the current school by default (with a "Same school?" checkbox to include it for families where two kids share a school).
- On submit: call `POST /api/portal/gallery-context` with the entered email + PIN. If matched, fetch that student's photos + packages, merge into the current session state (packages/backdrops deduplicated by id), set the active-student tab to the newly-added kid.
- Add toast: `"✓ Lily Rivera added — you just saved $8.47 with sibling combine"`.

**Tab 2 — Older photos (past year).**
- School dropdown: **all** schools the studio has ever shot, grouped by shoot year, most recent first. "Riverside Prep · 2025" is distinct from "Riverside Prep · 2026".
- Urgency copy at top if archive_date is set on the chosen school: *"Archived on May 31 — last chance for 2025 photos."*
- Same email + PIN submission path as tab 1.
- Same sibling discount applies (decision #8).

**Tab 3 — I lost the PIN.**
- Four fields: first name, last name, school+year dropdown, parent's email.
- On submit: call `POST /api/portal/recovery/request` (§4.4).
- Response message is always generic: *"If we found a match, we've sent a recovery link to the email on file. Check your inbox. The link expires in 24 hours."*
- If rate-limited: *"Too many attempts. Please wait 15 minutes and try again, or contact your photographer."* (includes dynamic photographer contact — §4.5)

### 4.4 Recovery 5-door check (server-side)

`POST /api/portal/recovery/request` body: `{firstName, lastName, schoolId, parentEmail}`.

The server runs all five checks. **Any failure returns the same generic response body** so attackers cannot enumerate:

1. **Rate limit.** Query `pin_recovery_attempts` for this IP in the last 15 min → 3 max. Per-student cap → 10 max per day. If exceeded, log attempt with `failure_reason: 'rate_limited'` and return generic response. No email sent.

2. **Student match.** Look up `students` row where lowercase first_name + last_name + school_id match (and the school row is owned by the studio). If no match, log `failure_reason: 'no_student_match'`, return generic.

3. **Pre-registration match.** Check whether `parentEmail` exists in the pre-registration email list for that school/event. This is the critical door Harout flagged. If missing, return a **different** but still-not-revealing response that bridges to the photographer fallback:
   > *"This email isn't pre-registered for this gallery, so we can't send a recovery link directly. To get help, please contact your photographer: **[studio name] · [email] · [phone]**."*
   
   (The photographer info is loaded from `photographers` row associated with the school, so the copy is automatically correct for each studio using the platform — per decision #11 and this message from Harout.)
   
   Also inserts a row into `pin_recovery_requests` with `status='pending'` so the photographer sees the unresolved request in their dashboard.

4. **Roster email match.** If the `parentEmail` the user typed doesn't match the `parent_email` field on the roster row for this student, log `failure_reason: 'email_mismatch'`, return generic. (Belt-and-suspenders on top of door #3 — pre-registration AND roster both must agree.)

5. **Token issue.** If all four doors passed: generate a 32-byte random token, hash it (SHA-256), store the hash in `pin_recovery_tokens` with a 24-hour expiry, and email the unhashed token (embedded in a self-login URL) to the **roster parent_email** (not the typed email). Log attempt with `succeeded=true`.

The email template:

> **Your Studio OS gallery link — Ethan Rivera · Grade 5 · Riverside Prep 2026**
>
> You or someone using your email requested access to Ethan's gallery.
>
> [Open gallery →] (link expires in 24 hours)
>
> If you didn't request this, ignore this email — nothing will happen.
> — [Studio name]

Clicking the link hits `GET /api/portal/recovery/claim?token=...` which:
- Validates the token hash exists + not expired + not used.
- Marks the token `used_at = now(), ip_used = request_ip`.
- Issues a session cookie scoped to that gallery and redirects to `/parents/<pin>` for that student, or loads the gallery into an existing combine session if one is active.

### 4.5 Photographer-contact fallback (decision #11 + Harout's message)

Whenever a PIN recovery fails at door #3 (email not pre-registered) OR the parent has Tier 3 needs (no roster email, no pre-registration), the message surface shows the **current gallery's photographer** as the contact:

```
We can't confirm this email. To recover this PIN, please contact your photographer:

┌────────────────────────────────────┐
│ 📸 WHITE PHOTO                     │
│ ✉ harout@me.com                   │
│ ☎ (555) 123-4567                   │
└────────────────────────────────────┘
```

All three fields come from the `photographers` row that owns the school/event the parent was trying to unlock:
- `business_name` → display name
- `studio_email` (fallback: `billing_email`) → email
- `studio_phone` → phone

This keeps the platform multi-tenant-safe: Studio A's parents never see Studio B's contact info. Pulled live each time the fallback renders, so if the photographer updates their info in settings, the parent-facing surfaces pick it up on the next render.

---

## 5. Checkout flow

### 5.1 Client → server

The client posts a single `/api/portal/orders/create` request with all cart items including their student/school/project tags. Server does NOT trust client-computed totals.

### 5.2 Server-side processing

1. Group cart items by `studentId` (school mode) or `projectId` (event mode). Each group becomes one `orders` row.
2. Compute each group's subtotal by looking up authoritative `packages` + `backdrop_catalog` prices.
3. Apply sibling discount using the tier lookup from `photographers.sibling_discount_tiers`:
   - Rank groups by subtotal DESC.
   - First group (highest subtotal) = no discount. Keeps the receipt friendly: "First kid full price."
   - All other groups get the tier-% off their subtotal.
4. Compute shipping:
   - If ANY group is past its school/event `order_due_date`, force `shipping` delivery + apply `late_handling_fee_percent` to the combined pre-shipping subtotal.
   - Otherwise apply the user-selected delivery method and the flat `shipping_fee_cents`.
5. Insert N `orders` rows all sharing one freshly-minted `order_group_id`. Each row carries its own `student_id` / `school_id` / `project_id`, package + item details, and its share of the discount. Shipping + handling are stored on the **first** order in the group only (the one that carries the combined shipping).
6. Insert matching `order_items` rows.
7. Create one Stripe Checkout Session with `line_items[0].unit_amount = grand_total_cents`, `line_items[0].product_data.name = "Studio OS Cloud Order — 3 students"`, metadata including the full list of `order_id`s and the `order_group_id`.
8. Return `{ checkoutUrl }` to the client.

### 5.3 Webhook

Stripe `checkout.session.completed` webhook:
- Look up `order_group_id` from metadata.
- Mark every `orders` row in that group as paid + set `stripe_payment_intent_id` on each.
- Fire the existing per-order notification emails (one per order) so each student's photographer ticket shows up correctly.

---

## 6. Shipping model (decision #4 in detail)

```
Before order_due_date          After order_due_date
─────────────────────          ───────────────────
● School Pickup (free)          ◌ School Pickup (disabled)
○ Ship ($X flat)                ● Ship ($X + 10% handling)
```

Copy examples:

- During window, if shipping selected: *"Your order will ship after [due date] for $8.00."*
- After due date: yellow warning banner in cart:
  > **The school pickup window closed on May 15.** Late orders ship individually; a 10% handling fee has been added to cover one-off fulfillment. [Read more]

Server enforces the state — don't rely on client-only checks. The server always recomputes delivery state at checkout time from `schools.order_due_date` / `projects.order_due_date`.

---

## 7. Upsell UX (the 5 levers)

| Lever | Where it lives | Implementation |
|---|---|---|
| **Tiered sibling discount** | Drawer header + cart tier strip | JSON `sibling_discount_tiers`; progress strip *"Add 1 more kid to unlock 10%"* |
| **Live savings display** | Cart header + drawer toast | Green pill "You're saving $X.XX"; flashes on every addition |
| **Due-date urgency** | Cart banner + drawer tab header | Countdown copy if within 7 days; warning if past |
| **Past-year scarcity** | "Older photos" tab header | *"Archived on [date] — last chance"* when `archive_date` is set |
| **Bundle nudges** | Cart row below each student | *"Parents who bought Wallets also bought the 5×7 add-on"* — one-tap add |

All copy is live-editable in code for now. Translatable later.

---

## 8. Photographer dashboard surfaces

### 8.1 Studio settings (new fields)

Section: **Billing & Fulfillment** on `/dashboard/settings`:

- **Sibling combine discount tiers** — editable table: `{2 kids: 5%, 3+ kids: 10%}` with add/remove rows.
- **Shipping fee (flat)** — one dollar amount.
- **Late handling fee %** — default 10.

### 8.2 Per-school / per-event settings

On `/dashboard/projects/schools/[schoolId]/settings` and `/dashboard/projects/[id]/settings`:

- **Order due date** — datetime picker. When set + passed, parents see shipping forced.
- **Archive date** — datetime picker. When set, past-year tab shows urgency copy for this school.

### 8.3 Combined orders insight card

New tile on `/dashboard/page.tsx` (dashboard home):

```
┌─ Combined orders · last 30 days ────────────────┐
│                                                  │
│  14 combined orders                              │
│  $2,410 total revenue                            │
│  Avg cart: $172  (vs $74 solo)                   │
│                                                  │
│  Sibling discount issued: $241                   │
│  ROI: 10:1                                       │
│                                                  │
│  [Configure discount tiers →]                   │
└──────────────────────────────────────────────────┘
```

### 8.4 Recovery requests queue (Tier 3 fallback)

New page `/dashboard/admin/recovery-requests`. Lists pending `pin_recovery_requests` rows with:
- Student (name + school + year)
- Parent email
- Typed first/last name (if different from roster, flag it)
- Requested at (relative time)
- Actions: **[Send recovery link]** (creates a `pin_recovery_token` manually and emails it) / **[Reject]** / **[Note]**

Photographer hits "Send recovery link" → parent gets the same email template as the auto-flow. 3-second support resolution.

### 8.5 Recovery audit log

New page `/dashboard/admin/recovery-log` (or embedded into the agreement-audit view we already built). Lists `pin_recovery_attempts` rows with success/failure breakdown, rate-limit events, IPs. Photographer-scoped.

### 8.6 Pre-release email template update

Updated copy (the template used when photographers send the pre-release invite):

> **Reserve your child's gallery — [School Name]**
>
> Registering your email now does three things:
>
> 1. **Access the gallery** — only pre-registered parents get the release notification and can view photos.
> 2. **Enable self-service PIN recovery** — if you ever lose your PIN, registered parents can recover it themselves in 30 seconds. Non-registered parents will have to contact the photographer directly.
> 3. **Unlock sibling discounts** — combined orders with siblings earn up to 10% off.
>
> [Register now → takes 20 seconds]

---

## 9. Security model

| Concern | Defense |
|---|---|
| Brute-force student name guessing | 3 attempts / IP / 15 min; 10 / student / day; all logged |
| Enumeration of who goes to which school | Generic success/failure responses; door-level failures never revealed to client |
| Stealing a PIN via name guess | Door #3 pre-registration check + door #4 roster-email match; attacker must control the pre-registered inbox |
| Reusing a recovery link | Single-use token; `used_at` flagged on claim; IP captured for audit |
| Photographer Y attacking photographer X's parents | All queries scoped by `photographer_id`; tokens scoped to one student |
| Abuse of Tier 3 queue | `pin_recovery_requests` rate-limited by parent_email; photographer sees full context before approving |
| PII leakage through email | We email only a link, never the raw PIN; recipient is the **roster** parent_email, not the typed email |

---

## 10. Phase plan

### Phase 1 (this build)

Everything above that's marked locked.

### Phase 1b (post-ship)

- **Smart email auto-detect banner** — when a parent is logged into this year's gallery with email `X`, quietly scan the studio's past years for any rows where `parent_email = X` and surface a banner: *"Looks like we also have [School] 2025 under your email — view them"*. Removes the need for the parent to even remember they had past-year photos.

### Phase 2

- Cross-year + cross-school family maps (build a `family_links` table so repeated use of the same parent_email gets clustered for faster Phase 1b).
- Per-sibling shipping addresses (rare but nice for divorced families).
- Referral credits: "Invite another parent to combine — both get $5 off."

### Phase 3

- Bundle-builder UI for photographers ("Create a 3-sibling family bundle at a flat $99").

---

## 11. Build order (checklist)

When we start coding, this is the order — each chunk is independently testable and pushable:

- [ ] **Chunk 1 — DB migration** applied live + saved to `supabase/migrations/`
- [ ] **Chunk 2 — Server foundations**
  - [ ] `lib/combine-orders.ts` — pure fns for discount calc, shipping calc, total calc
  - [ ] `lib/pin-recovery.ts` — pure fns for 5-door check (testable in isolation)
  - [ ] `/api/portal/orders/create` — refactor to handle N-group carts
  - [ ] `/api/portal/recovery/request` + `/api/portal/recovery/claim`
  - [ ] Stripe webhook handler update (group-aware)
- [ ] **Chunk 3 — Parent cart refactor**
  - [ ] `CartLineItem` schema changes
  - [ ] Cart UI groups by student
  - [ ] Live savings banner + tier progress strip
  - [ ] Shipping/handling display logic (due-date aware)
- [ ] **Chunk 4 — CombineOrdersDrawer**
  - [ ] Three tabs (add sibling / older photos / lost PIN)
  - [ ] Photographer-contact fallback rendering
  - [ ] All toasts + upsell copy
- [ ] **Chunk 5 — Photographer settings**
  - [ ] Studio-wide billing & fulfillment fields
  - [ ] Per-school / per-event due-date + archive-date fields
  - [ ] Pre-release email template copy update
- [ ] **Chunk 6 — Dashboard surfaces**
  - [ ] Combined orders insight card on home
  - [ ] `/dashboard/admin/recovery-requests` queue
  - [ ] `/dashboard/admin/recovery-log` audit view
- [ ] **Chunk 7 — Final typecheck + push command** with the full commit message capturing every file touched

Each chunk ends with `npx tsc --noEmit` clean + a push command you can run from your Mac.

---

## 12. Open questions that can be resolved at build time

These don't block starting — I'll confirm during implementation:

- Exact table name for pre-registration emails (candidates: `school_visitors`, `project_visitors`, a combined `emails` table, or a new one). Grep will find it in 30 seconds.
- Whether the existing transactional-email provider (likely Resend, per the privacy-policy language) has a template system or we hand-roll HTML.
- Whether `photographers.studio_phone` is consistently populated; if not, fallback display should handle a missing phone gracefully (just show email).
- How existing gallery-context caching interacts with mid-session second-student loading (we may need a cache-bust on drawer close).

---

## 13. Out of scope (explicitly not in Phase 1)

- Mobile `/m` surfaces for combine / recovery (desktop-first in Phase 1; mobile port is Phase 1b or Phase 2 depending on feedback).
- Email magic-link flow for parents who never signed in at all (the drawer is in-gallery only; unauthenticated recovery is a separate feature).
- International phone formatting / country-specific shipping.
- Multi-currency combine orders.
- Per-line-item shipping addresses.

---

**End of design doc.** Next step: start Chunk 1 (DB migration).
