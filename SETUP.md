# Phase 2 — Setup & verification

Phase 1 (database schema) should already be applied to your Supabase project.
This guide gets the Next.js dashboard running locally and verifies the magic-link
sign-in flow end to end.

---

## 1. Fill in `.env.local`

Open the Supabase dashboard for your project and go to **Settings → API**.
You need three values:

| In Supabase                        | Goes into `.env.local` as          |
| ---------------------------------- | ---------------------------------- |
| Project URL                        | `NEXT_PUBLIC_SUPABASE_URL`         |
| Project API keys → `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY`    |
| Project API keys → `service_role`  | `SUPABASE_SERVICE_ROLE_KEY`        |

The first two are safe in the browser. The service-role key is **server-only**
and bypasses RLS — never paste it into a Client Component or commit it.

> The `.env.local` file is already gitignored. `.env.example` (the template,
> with no real values) is the one that's checked in.

## 2. Configure Supabase Auth redirect URLs

Magic links won't work until Supabase knows it's allowed to redirect back to
your app. In the Supabase dashboard:

1. **Authentication → URL Configuration**.
2. **Site URL**: `http://localhost:3000`
3. **Redirect URLs** (add both):
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/**` (covers any `?next=` redirects you add later)

Save. You'll add the production URL here when you deploy to Vercel.

## 3. Run the dev server

Dependencies are already installed. From the project root:

```powershell
pnpm dev
```

Open <http://localhost:3000>. You should be redirected to `/login`.

> If `pnpm install` ever complains about ignored build scripts (sharp,
> unrs-resolver), it's harmless for local dev. To silence it, run
> `pnpm approve-builds` once and approve both.

## 4. Sign in for the first time

1. Type your email on `/login` and click **Send magic link**.
2. Check your inbox for "Confirm your signup" / "Magic Link" from Supabase.
   - **Spam check**: it might land in spam on the first request from a new
     project. Mark as not-spam if so.
   - **No email at all?** Supabase's free tier rate-limits the built-in SMTP
     to ~3 emails/hour. Wait, or wire up a real SMTP provider in
     **Authentication → Emails → SMTP Settings**.
3. Click the link. It bounces through `/auth/callback?code=...` and lands on
   `/dashboard`.
4. You'll see the **amber "not yet provisioned"** banner — that's expected;
   we still need to add an `operators` row for your auth user.

## 5. Create your operator row

The dashboard shows your auth user id on the amber banner. Copy it. Then in
the Supabase **SQL editor**, run:

```sql
insert into operators (id, email, full_name, role)
values (
  'PASTE-YOUR-AUTH-USER-ID-HERE',
  'your.email@example.com',
  'Your Full Name',
  'admin'  -- you're the first operator, so make yourself admin
);
```

Refresh `/dashboard`. You should now see **"Welcome, Your Full Name"** with
your email underneath. The amber banner is gone.

> Why a separate `operators` row instead of just using `auth.users`? Because
> our schema uses the `operators` table for role and display-name data, and
> RLS policies key off existence of an `operators` row. An auth.users row
> alone gives you a session but no dashboard access — which is exactly the
> "not yet provisioned" state.

## 6. Verify the protected routes

Run through these checks. Each one should match the expected behavior.

| Action | Expected |
| ------ | -------- |
| Visit `/` while signed out | redirects to `/login` |
| Visit `/dashboard` while signed out | redirects to `/login` |
| Visit `/login` while signed in | redirects to `/dashboard` |
| Visit `/` while signed in | redirects to `/dashboard` |
| Click **Sign out** on `/dashboard` | lands on `/login`, session cleared |
| After signing out, visit `/dashboard` | redirects to `/login` again |

Open DevTools → Application → Cookies and confirm a cookie named something
like `sb-<projectref>-auth-token` exists when signed in and is gone after
sign-out.

## 7. (Optional) Run the typecheck

```powershell
pnpm exec tsc --noEmit
```

Should print nothing and exit 0.

---

## Project layout (Phase 2)

```
app/
  layout.tsx              minimal root layout
  page.tsx                redirects to /login or /dashboard
  login/
    page.tsx              magic-link form
    actions.ts            "send magic link" server action
  auth/
    callback/route.ts     exchanges ?code for a session
  dashboard/
    page.tsx              welcome screen (placeholder for Phase 3)
    actions.ts            sign-out server action
lib/
  supabase/
    client.ts             browser client (Client Components)
    server.ts             server client (Server Components, Actions, Routes)
    middleware.ts         proxy helper: refresh session + route protection
proxy.ts                  root proxy (Next.js 16 renamed this from middleware.ts)
supabase/
  migrations/
    0001_initial_schema.sql    Phase 1 schema
    0001_VERIFY.md             Phase 1 verification checklist
.env.example              committed env template
.env.local                your real secrets (gitignored)
```

---

## Troubleshooting

**Magic link arrives but clicking it shows `error=Could+not+sign+in` or similar.**
Your **Site URL** or **Redirect URLs** in Supabase don't match
`http://localhost:3000`. Check Step 2.

**"Invalid login credentials" / `?error=...` on the login page.**
Check `.env.local` — if `NEXT_PUBLIC_SUPABASE_URL` or `_ANON_KEY` is wrong,
Supabase rejects the request before sending the email. Restart `pnpm dev`
after editing `.env.local`.

**Dashboard shows the amber banner even though you inserted the operators row.**
Likely one of:
- The id in the row doesn't match `auth.uid()`. Re-copy the id off the banner.
- RLS is blocking the read. Confirm the SQL editor user inserted the row
  successfully (it should show 1 row affected).

**`pnpm dev` won't start, says "Module not found: @supabase/ssr".**
Run `pnpm install` once more. The lockfile expects all of `@supabase/ssr`,
`@supabase/supabase-js`, `next`, `react` in `node_modules`.

---

When all six verification steps in §6 pass, Phase 2 is done. Tell me and we'll
move on to Phase 3 (the actual operator dashboard — load posting, bid list,
award flow).
