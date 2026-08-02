# TMM Chapters

The chapter operations portal for The Mastery Mentors. This project intentionally contains no marketing site content: it is only for chapter applications, registered chapter work, and administration.

## What it does

- Accepts chapter applications
- Gives every approved chapter a unique code instead of an email login
- Lets chapters file structured weekly reports, see review status and receive public feedback
- Shows chapters shared or chapter-specific events
- Lets admins approve or reject applications
- Lets admins manually create chapters and generate or reset codes
- Gives admins a weekly review queue, missing-report reminders, private 1–5 ratings, internal notes, follow-up flags, CSV export, chapter contacts, tasks, and event controls
- Supports light and dark modes

## Security model

Admin codes are stored only as bcrypt hashes and can never be recovered. Chapter codes are stored as a bcrypt hash *and* in raw form, because administrators need to re-read a chapter's code after it is issued. The raw code lives only in the `private` schema, which is not exposed through PostgREST and denies all access under RLS; it is readable solely through `admin_chapter_codes()`, which only `service_role` may execute and which the Edge Function calls after its `is_admin()` check. Login always verifies against the bcrypt hash. Supabase rate-limits code attempts and binds successful access to an anonymous Supabase Auth user for eight hours. The `chapter-portal` Edge Function requires a valid JWT and re-checks database authorization before returning protected data. Operational data stays behind RLS and the browser never receives a secret/service-role key.

Admins and chapters use six-digit access codes. The browser first creates or reuses a Supabase anonymous Auth session, so every authorization record is bound to `auth.uid()`.

**Turnstile is load-bearing, not optional polish.** `verify_chapter_code` and `verify_admin_code` allow five failed attempts per 15 minutes, counted per `auth.uid()`. Because any visitor can mint a fresh anonymous identity on demand, that counter resets at will, and both functions are callable directly through PostgREST with only the publishable key — the Edge Function is not in the way. The six-digit space is a million codes, so the practical barrier to enumeration is Supabase's per-IP cap on anonymous sign-ins. Enabling CAPTCHA protection in Supabase Auth and setting `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is what makes minting identities expensive; the client already sends the token when the variable is set. Leave it unset only for a deployment that is not handling real chapter data.

Weekly report ratings and internal notes live in the admin-only `weekly_report_reviews` table. Chapter dashboard responses select only review status and optional public feedback; private ratings and notes are never returned.

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set these browser-safe values in `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Never place a Supabase secret or service-role key in a `NEXT_PUBLIC_*` variable.

## Supabase

Production schema changes are tracked in `supabase/migrations/`.

### Storage maintenance

Database size here tracks page views rather than chapter activity: every visitor
mints an anonymous Auth identity on page load, and Supabase never removes them.
A `pg_cron` job runs `private.purge_stale_auth_and_audit_rows()` daily at 04:17
UTC to drop anonymous identities older than seven days that hold no live
authorization, along with stale code-attempt rows, long-expired grants, and
rotated refresh tokens. Check it with `select * from cron.job;` and run it by
hand with `select * from private.purge_stale_auth_and_audit_rows();`.

Chapter event photos are the other growth path, and the cheaper one to
underestimate: the bucket allows 10 MB per file and six photos per event record,
so roughly seventeen fully illustrated events would fill a 1 GB quota. Lower
`file_size_limit` on the `chapter-event-photos` bucket or downscale in the
browser before upload if that starts to matter.

The Edge Function source is `supabase/functions/chapter-portal/index.ts`. It is deployed with JWT verification enabled.

Anonymous sign-in must be enabled in Supabase Authentication. Cloudflare Turnstile can be enabled by configuring CAPTCHA protection in Supabase and setting `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the web deployment.

## Vercel

Import the GitHub repository in Vercel and add only these browser-safe variables:

```text
NEXT_PUBLIC_SUPABASE_URL=https://fvkkamxonsygjlhabsqb.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_KfrtGRu3NtZe1Rr0_Q7-qw_wwKiv91H
```

Optionally add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` after Turnstile is configured in Supabase. Never add a Supabase secret or service-role key to Vercel.

The included `vercel.json` uses the dedicated `npm run build:vercel` Next.js build. The normal `npm run build` command remains the Sites/Cloudflare build.

## Verification

```bash
npm run lint
npm test
```
