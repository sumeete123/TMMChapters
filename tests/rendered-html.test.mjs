import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the chapter operations homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TMM Chapters<\/title>/i);
  assert.match(html, /Enter your chapter code/i);
  assert.match(html, /Apply to start a chapter/i);
  assert.match(html, /Admin/i);
  assert.doesNotMatch(html, /founding impact|session ledger|people impacted/i);
  assert.doesNotMatch(html, /chapters worldwide|students served|our impact|donate/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the finished site free of starter-only infrastructure", async () => {
  const [page, layout, css, edgeFunction, volunteerMigration, securityMigration, contactPayloadMigration, nationalImpactMigration, geographyMigration, nextConfig, worker, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/chapter-portal/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716004130_chapter_volunteers_and_instagram_onboarding.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716025513_harden_anonymous_application_submissions.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716031431_limit_application_contact_payload.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716032009_national_chapter_impact.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260719170946_chapter_geographic_scope.sql", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /chapter_applications/);
  assert.match(page, /chapter-login/);
  assert.match(page, /signInAnonymously/);
  assert.match(page, /verify_admin_code/);
  assert.match(page, /is_admin/);
  assert.match(page, /Weekly reports are due every Sunday/);
  assert.match(page, /Notifications/);
  assert.match(page, /Chapter command center/);
  assert.match(page, /Everything you need to launch your chapter/);
  assert.match(page, /Send approval email/);
  assert.match(page, /1YVnkXYF1WHyXeoD81Hq9jF_dJJyaxJ3jfl2bzHgaVFs/);
  assert.match(page, /1hgxSoDHWPXDa6twMTREy772fba_G6dborm01ajz_O5g/);
  assert.match(page, /Chapter volunteers/);
  assert.match(page, /Our impact/);
  assert.match(page, /Students impacted/);
  assert.match(page, /TMM National Chapter/);
  assert.match(page, /id="national-weekly-report"/);
  assert.match(page, /Submit the National Chapter weekly report/);
  assert.match(page, /Edit National Chapter impact/);
  assert.match(page, /const reportingChapters = data\.chapters\.filter\(\(chapter\) => chapter\.status === "active"\)/);
  assert.doesNotMatch(page, /National Chapter controls/);
  assert.doesNotMatch(page, /status === "active" && !chapter\.is_official/);
  assert.match(page, /Instructional hours/);
  assert.match(page, /Show.*completed/);
  assert.match(page, /Show.*closed/);
  assert.match(page, /Best rated chapters/);
  assert.match(page, /additional_contacts/);
  assert.match(page, /Preparing secure form/);
  assert.match(page, /One chapter per school/);
  assert.match(page, /One chapter per city/);
  assert.match(page, /Regional city chapter/);
  assert.doesNotMatch(page, /function NationalImpactCard/);
  assert.doesNotMatch(css, /\.national-impact-card/);
  assert.match(edgeFunction, /weekly_reports/);
  assert.match(edgeFunction, /chapter-add-volunteer/);
  assert.match(edgeFunction, /chapter-delete-volunteer/);
  assert.match(edgeFunction, /admin-delete-task/);
  assert.match(edgeFunction, /admin-delete-event/);
  assert.match(edgeFunction, /Only declined applications can be deleted/);
  assert.match(edgeFunction, /The request is too large/);
  assert.match(edgeFunction, /boundedWholeNumber/);
  assert.match(edgeFunction, /boundedDecimal/);
  assert.match(edgeFunction, /national-impact/);
  assert.match(edgeFunction, /Cache-Control/);
  assert.match(edgeFunction, /priority: "high"/);
  assert.match(edgeFunction, /provision_chapter_code/);
  assert.match(edgeFunction, /current_chapter_id/);
  assert.doesNotMatch(page, /signInWithPassword|tmm-chapter-session/);
  assert.match(layout, /TMM Chapters/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /DM Sans/);
  assert.match(css, /Space Grotesk/);
  assert.match(volunteerMigration, /enable row level security/);
  assert.match(volunteerMigration, /Create your chapter Instagram account/);
  assert.match(volunteerMigration, /tasks_priority_always_high/);
  assert.match(securityMigration, /submitted_by = \(select auth\.uid\(\)\)/);
  assert.match(securityMigration, /revoke all on table public\.chapter_applications from anon/);
  assert.match(securityMigration, /chapter_applications_submitted_by_unique_idx/);
  assert.match(contactPayloadMigration, /jsonb_array_length\(additional_contacts\) <= 20/);
  assert.match(nationalImpactMigration, /national_chapter_impact/);
  assert.match(geographyMigration, /chapters_one_open_school_idx/);
  assert.match(geographyMigration, /chapters_one_open_regional_city_idx/);
  assert.match(geographyMigration, /name = 'Carmel Chapter'/);
  assert.match(edgeFunction, /chapterGeography/);
  assert.match(edgeFunction, /chapter-login/);
  assert.match(nationalImpactMigration, /drop column if exists mentors_present/);
  assert.doesNotMatch(page, /mentors_present|Mentor attendances/);
  assert.doesNotMatch(edgeFunction, /mentors_present/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(worker, /secureResponse/);
  assert.doesNotMatch(css, /Cormorant Garamond/);
  assert.match(packageJson, /@supabase\/supabase-js/);
  assert.match(packageJson, /"postcss": "8\.5\.19"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
