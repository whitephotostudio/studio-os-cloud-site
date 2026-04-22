# Harout

**Also known as:** Harout, owner of WHITE PHOTO
**Role:** Owner / operator / sole photographer
**Studio:** WHITE PHOTO

## Identity

- **photographer_id** (in `public.photographers` + everywhere the app joins on it): `ed6b8a99-1f38-48f3-a198-447c49b5ac34`
- **Email as photographer** (Supabase Auth account): `harout@me.com`
- **Email on Cowork / this chat client:** `whitephotostudio@hotmail.com`

## Context

- Runs the studio solo. Shoots, edits, prints in-house on a Noritsu, and handles all parent-facing sales himself.
- Two business lines the cloud app serves:
  - **Schools / events** — picture-day / recital / sports-style shoots. Parents get a PIN, log in at `/parents/[pin]`, and order proofs.
  - **Studio portraits** — backdrop swap is a big deal here. Parents pick a digital backdrop and the subject is composited onto it.
- Uses the desktop **Backdrop Manager** (Flutter macOS app) to manage his backdrop library, push to cloud, and drive Noritsu print exports.

## Working style

- Hands-off on implementation detail, but sharp about user-facing bugs — writes in all caps when something's broken ("ROSTER WHICH PROJECTS DONT HAVE", "THE APP IS SITING ON THIS PATH").
- Speaks plainly and expects plain answers back. Minimal formatting, few bullets.
- Screenshots frequently. If he sends a screenshot, he wants the fix to match the exact visual artifact he's seeing.
- Doesn't want irreversible DB mutations without confirming. For task #58 (phantom rosters) he picked "Hide via UI filter only" when offered DB-delete vs UI-hide.
- Pushes from his own Mac terminal. Sandbox can't push. When a commit is pending, hand him the exact `git` command sequence.

## Stack fluency

- Comfortable copy-pasting `git` commands, reading TypeScript error messages, restarting Vercel deploys, and running `flutter build macos`.
- Doesn't want to deal with database internals — expects us to run Supabase SQL via the MCP connector.
- Not using a password manager actively — when we had the MFA lockout on 2026-04-21, we just cleared stale `auth.mfa_factors` / `auth.mfa_challenges` rows instead of fighting the TOTP flow.

## Do / don't

- ✅ Commit on his behalf in the sandbox (it can't push but it can commit) and hand him the push command.
- ✅ Run Supabase SQL via MCP for read-only diagnostics and confirmed schema changes.
- ❌ Never make his storage/security looser without explicit sign-off.
- ❌ Never auto-delete disk files, DB rows, or storage objects on his behalf without a "yes, delete X" in chat.
- ❌ Never spin up a new `middleware.ts` — Next.js 16 uses `proxy.ts`.
