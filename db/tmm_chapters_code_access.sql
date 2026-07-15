-- Chapter-code access upgrade for TMMChapters.
-- Codes and session tokens are stored only as SHA-256 hashes.

alter table public.chapters
  add column if not exists access_code_hash text,
  add column if not exists access_code_hint text;

alter table public.chapter_applications
  add column if not exists contact_phone text;

create unique index if not exists chapters_access_code_hash_idx
  on public.chapters(access_code_hash)
  where access_code_hash is not null;

create table if not exists public.chapter_sessions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists chapter_sessions_chapter_id_idx
  on public.chapter_sessions(chapter_id);

create index if not exists chapter_sessions_expires_at_idx
  on public.chapter_sessions(expires_at);

create table if not exists public.chapter_login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  successful boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists chapter_login_attempts_window_idx
  on public.chapter_login_attempts(ip_hash, attempted_at desc);

alter table public.chapter_sessions enable row level security;
alter table public.chapter_login_attempts enable row level security;

-- These tables are accessed only by the Edge Function's secret-key client.
revoke all on public.chapter_sessions from anon, authenticated;
revoke all on public.chapter_login_attempts from anon, authenticated;

-- Chapter code access replaces member email access for the chapter workspace.
revoke all on public.chapters from anon;
revoke all on public.weekly_reports from anon;
revoke all on public.tasks from anon;
revoke all on public.events from anon;

-- Public applications remain write-only for visitors.
grant insert on public.chapter_applications to anon, authenticated;

comment on column public.chapters.access_code_hash is
  'SHA-256 hash of the normalized chapter access code. Raw codes are never stored.';

comment on table public.chapter_sessions is
  'Opaque chapter sessions issued by the chapter-portal Edge Function.';
