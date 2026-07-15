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

Raw chapter and admin codes are never stored. Supabase stores bcrypt representations, rate-limits attempts, and binds successful access to an anonymous Supabase Auth user for eight hours. The `chapter-portal` Edge Function requires a valid JWT and re-checks database authorization before returning protected data. Operational data stays behind RLS and the browser never receives a secret/service-role key.

Admins and chapters use six-digit access codes. The browser first creates or reuses a Supabase anonymous Auth session, so every authorization record is bound to `auth.uid()`.

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
