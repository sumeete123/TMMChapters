# TMM Chapters

The chapter operations portal for The Mastery Mentors. This project intentionally contains no marketing site content: it is only for chapter applications, registered chapter work, and administration.

## What it does

- Accepts chapter applications
- Gives every approved chapter a unique code instead of an email login
- Lets chapters file weekly reports and complete assigned tasks
- Shows chapters shared or chapter-specific events
- Lets admins approve or reject applications
- Lets admins manually create chapters and generate or reset codes
- Gives admins chapter contacts, report history, task completion, and event controls
- Supports light and dark modes

## Security model

Raw chapter codes and session tokens are never stored. The `chapter-portal` Supabase Edge Function hashes both with SHA-256, rate-limits code attempts, and issues opaque 30-day sessions. Operational data stays behind RLS and the browser never receives a secret/service-role key.

Admins use Supabase email/password Auth and must have `app_metadata.role = 'admin'`. Chapter users do not need Supabase Auth accounts.

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

The project uses these database files in order:

1. `db/tmm_chapters.sql`
2. `db/tmm_chapters_code_access.sql`
3. `db/tmm_chapters_security_hardening.sql`

The Edge Function source is `supabase/functions/chapter-portal/index.ts`. It is deployed with JWT verification disabled at the gateway because the function implements its own chapter-session authentication and separately validates admin JWTs inside the function.

To bootstrap the first admin, create the email/password user in Supabase Authentication, then set that trusted user's server-controlled `app_metadata.role` to `admin`. Sign out and back in afterward to refresh the JWT.

## Verification

```bash
npm run lint
npm test
```
