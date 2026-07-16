alter table public.chapter_applications
  add constraint chapter_applications_contact_payload check (
    jsonb_typeof(additional_contacts) = 'array'
    and jsonb_array_length(additional_contacts) <= 20
    and octet_length(additional_contacts::text) <= 20000
  );
