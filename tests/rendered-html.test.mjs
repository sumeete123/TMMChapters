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
  assert.doesNotMatch(html, /chapters worldwide|students served|our impact|donate/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the finished site free of starter-only infrastructure", async () => {
  const [page, layout, css, edgeFunction, volunteerMigration, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/chapter-portal/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716004130_chapter_volunteers_and_instagram_onboarding.sql", import.meta.url), "utf8"),
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
  assert.match(page, /Chapter volunteers/);
  assert.match(page, /Best rated chapters/);
  assert.match(page, /additional_contacts/);
  assert.match(edgeFunction, /weekly_reports/);
  assert.match(edgeFunction, /chapter-add-volunteer/);
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
  assert.doesNotMatch(css, /Cormorant Garamond/);
  assert.match(packageJson, /@supabase\/supabase-js/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
