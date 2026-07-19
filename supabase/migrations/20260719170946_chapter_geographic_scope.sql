-- North Carolina chapters belong to one school. Chapters elsewhere represent
-- one city. Store the normalized geography so the rule can be enforced by the
-- database instead of relying only on form copy.

alter table public.chapter_applications
  add column if not exists chapter_scope text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists school_name text;

alter table public.chapters
  add column if not exists chapter_scope text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists school_name text;

-- The only existing local chapter is a city-wide chapter for Carmel, Indiana.
update public.chapter_applications
set organization_name = 'Carmel Chapter',
    location = 'Carmel, Indiana',
    chapter_scope = 'regional',
    city = 'Carmel',
    region = 'Indiana',
    school_name = null,
    updated_at = now()
where lower(btrim(organization_name)) = 'carmel high school'
   or lower(btrim(location)) in ('carmel, in', 'carmel, indiana');

update public.chapters
set name = 'Carmel Chapter',
    slug = 'carmel-in',
    location = 'Carmel, Indiana',
    chapter_scope = 'regional',
    city = 'Carmel',
    region = 'Indiana',
    school_name = null,
    updated_at = now()
where is_official = false
  and (
    lower(btrim(name)) in ('carmel high school', 'carmel chapter')
    or lower(btrim(location)) in ('carmel, in', 'carmel, indiana')
  );

update public.chapters
set chapter_scope = 'official',
    city = null,
    region = null,
    school_name = null,
    updated_at = now()
where is_official = true;

alter table public.chapter_applications
  alter column chapter_scope set not null,
  alter column city set not null,
  alter column region set not null;

alter table public.chapter_applications
  add constraint chapter_applications_geographic_scope check (
    char_length(btrim(city)) between 2 and 120
    and char_length(btrim(region)) between 2 and 120
    and (
      (
        chapter_scope = 'school'
        and lower(btrim(region)) in ('nc', 'north carolina')
        and school_name is not null
        and char_length(btrim(school_name)) between 2 and 160
        and lower(btrim(organization_name)) = lower(btrim(school_name))
      )
      or
      (
        chapter_scope = 'regional'
        and lower(btrim(region)) not in ('nc', 'north carolina')
        and school_name is null
        and lower(btrim(organization_name)) = lower(btrim(city) || ' chapter')
      )
    )
  );

alter table public.chapters
  add constraint chapters_geographic_scope check (
    (
      is_official = true
      and chapter_scope = 'official'
      and city is null
      and region is null
      and school_name is null
    )
    or
    (
      is_official = false
      and city is not null
      and region is not null
      and char_length(btrim(city)) between 2 and 120
      and char_length(btrim(region)) between 2 and 120
      and (
        (
          chapter_scope = 'school'
          and lower(btrim(region)) in ('nc', 'north carolina')
          and school_name is not null
          and char_length(btrim(school_name)) between 2 and 160
          and lower(btrim(name)) = lower(btrim(school_name))
        )
        or
        (
          chapter_scope = 'regional'
          and lower(btrim(region)) not in ('nc', 'north carolina')
          and school_name is null
          and lower(btrim(name)) = lower(btrim(city) || ' chapter')
        )
      )
    )
  );

create unique index if not exists chapters_one_open_school_idx
  on public.chapters (
    lower(btrim(school_name)),
    lower(btrim(city)),
    lower(btrim(region))
  )
  where chapter_scope = 'school' and status <> 'archived';

create unique index if not exists chapters_one_open_regional_city_idx
  on public.chapters (
    lower(btrim(city)),
    lower(btrim(region))
  )
  where chapter_scope = 'regional' and status <> 'archived';

create unique index if not exists chapter_applications_one_open_school_idx
  on public.chapter_applications (
    lower(btrim(school_name)),
    lower(btrim(city)),
    lower(btrim(region))
  )
  where chapter_scope = 'school' and status in ('new', 'reviewing');

create unique index if not exists chapter_applications_one_open_regional_city_idx
  on public.chapter_applications (
    lower(btrim(city)),
    lower(btrim(region))
  )
  where chapter_scope = 'regional' and status in ('new', 'reviewing');

grant insert (
  chapter_scope,
  city,
  region,
  school_name
) on table public.chapter_applications to authenticated;

comment on column public.chapter_applications.chapter_scope is
  'school for North Carolina applications; regional for city-wide applications elsewhere.';
comment on column public.chapters.chapter_scope is
  'school for North Carolina chapters, regional for city-wide chapters elsewhere, or official for the National Chapter.';
