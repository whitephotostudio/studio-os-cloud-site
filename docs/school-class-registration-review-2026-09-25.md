# School class registration review

Status: implemented locally; production migration and deployment are pending.
No parent email was sent during this review. No live school settings changed.

The original draft made class selection mandatory for every prerelease school.
It also left the old automatic gallery-release email active. Both were corrected:
class registration is now a per-school opt-in, and enabled schools use deliberate
recipient selection instead of automatically notifying everyone on activation.

## Photographer workflow

School Settings → Parent Registration → **Register parents by class / grade**.
The toggle defaults off. Turning it on requires a synced roster with classes.
Parents must then select at least one actual roster class; multiple children can
use multiple dropdowns. Success requires the registration to be stored.
Selections from repeat visits accumulate atomically, including concurrent sibling
registrations. Class choices never identify a student or reveal a private PIN.

For a gallery already active after the first shoot day, the parent page also
allows registration for photo updates without a PIN, alongside the existing
PIN login. This lets later groups register after the first group is released.

Share → Selected Classes / Grades allows a photographer to select classes,
review recipients and skipped students, and send. The uploaded-photo filter
applies to linked students. Parents registered for any selected class are included by default, regardless
of another child's photo status. They receive a general class update without a
PIN when no personalized delivery is available. The photographer can explicitly
turn off registration inclusion for a send limited to linked students. A parent
registered for two classes receives the first selected group's update, and can
receive the later group's update when that group is selected. We do not claim
that all of their children's photos are ready. A ready personalized delivery
prevents an extra general registration message to the same address.

School activation and automatic campaign settings do not send all-parent emails
while the class-registration toggle is enabled. All Visitors, custom addresses,
and individual student email actions remain available as deliberate choices.
The existing 500-delivery limit is preserved; select smaller groups when needed.

## Compatibility and corrections

- With the toggle off, school preregistration remains email-only. Project/event
  preregistration remains email-only. Existing automatic school-release emails
  retain their prior behavior.
- No calendar, booking availability, booking/rescheduling/cancellation endpoint,
  appointment slot, booking Edge Function or desktop app file was modified.
- School settings updates preserve the schedule and do not update booking tables.
- Valid PIN login continues if optional notification contact capture fails; the
  additional capture runs only for enabled schools. Roster contact data, IDs,
  PINs, folders and PIN-recovery identity remain unchanged.
- Class sends resolve recipients on the server, enforce school ownership, reject
  changed audiences, and ignore injected custom addresses and CC in class mode.
- Stale asynchronous preview responses cannot replace newer recipient selections.
  Refreshing an audience after a partial send keeps the same delivery keys for
  unchanged messages within the existing provider retry behavior.
- The draft migration version collided with the owner overview. It was replaced
  with `20260925020000_school_class_registration.sql`; the old draft was never
  applied by this task and must not be used for release.

## Verification

Behavior tests execute the registration, school settings, PIN login and class
email handlers with mocked external services. SQL tests execute the migration in
PGlite, check default-off behavior, repeated sibling registration, preserved PINs
and contacts, and denied anonymous/authenticated access to service-only data.
Audience tests cover siblings in different classes, missing photos, cancellations,
duplicate PINs, invalid/stale audiences and pagination across all 718 students.
The existing automated suite also covers booking email schedules and calendar
dates. These checks do not substitute for a live booking/payment walkthrough.

## Release order

1. Apply only `supabase/migrations/20260925020000_school_class_registration.sql`
   through controlled SQL execution after checking live schema compatibility.
   Do not use `supabase db push`: repository migration histories are divergent.
2. Deploy the committed clean worktree using `npm run deploy:production`.
3. Verify old email-only registration with the toggle off, then enabled class
   selection and the recipient review, without sending an unapproved campaign.
4. Enable the toggle for the intended school explicitly in settings.

## Changed areas

Parent portal: `app/parents/{page,LoginForm,SchoolDirectLoginForm,SchoolRegistrationClasses}.tsx`
and the prerelease registration, class-list and school-access API routes.

Photographer UI/API: school settings, school share composer, school PATCH and
school email endpoints under `app/dashboard/projects/schools/[schoolId]` and
`app/api/dashboard/schools/[schoolId]`.

Supporting code: `lib/school-registration-classes.ts`,
`lib/school-class-email-audience.ts`, `lib/school-gallery-email-personalization.ts`,
the migration above, and `tests/school-class-{registration,email-audience}.test.mjs`.
