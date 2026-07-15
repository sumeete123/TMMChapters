import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const normalizeCode = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomString(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function formatCode(raw: string) {
  return `TMM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function generateCode() {
  return formatCode(randomString(12));
}

function slugify(value: string) {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "chapter";
  return `${base}-${randomString(5).toLowerCase()}`;
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || data.user?.app_metadata?.role !== "admin") return null;
  return data.user;
}

async function validateChapterSession(token: unknown) {
  const raw = String(token ?? "");
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const { data } = await admin
    .from("chapter_sessions")
    .select("id, chapter_id, expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  await admin.from("chapter_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function getChapterDashboard(chapterId: string) {
  const now = new Date().toISOString();
  const [chapterResult, tasksResult, eventsResult, reportsResult] = await Promise.all([
    admin.from("chapters").select("id, name, location, contact_name, contact_email, status").eq("id", chapterId).single(),
    admin.from("tasks").select("id, title, description, due_date, priority, status, completed_at").eq("assigned_chapter_id", chapterId).neq("status", "archived").order("due_date", { ascending: true, nullsFirst: false }),
    admin.from("events").select("id, title, description, starts_at, ends_at, location, link, chapter_id").or(`chapter_id.is.null,chapter_id.eq.${chapterId}`).gte("starts_at", now).order("starts_at", { ascending: true }).limit(10),
    admin.from("weekly_reports").select("id, week_start, sessions_held, students_served, mentors_present, completed_weekly_tasks, highlights, blockers, submitted_at").eq("chapter_id", chapterId).order("week_start", { ascending: false }).limit(8),
  ]);
  if (chapterResult.error) throw chapterResult.error;
  return {
    chapter: chapterResult.data,
    tasks: tasksResult.data ?? [],
    events: eventsResult.data ?? [],
    reports: reportsResult.data ?? [],
  };
}

async function adminOverview() {
  const [applications, chapters, reports, tasks, events] = await Promise.all([
    admin.from("chapter_applications").select("id, contact_name, contact_email, contact_phone, organization_name, location, student_reach, why, status, internal_notes, created_at").order("created_at", { ascending: false }),
    admin.from("chapters").select("id, name, slug, location, contact_name, contact_email, contact_phone, advisor_name, advisor_email, status, access_code_hint, created_at").order("name"),
    admin.from("weekly_reports").select("id, chapter_id, week_start, sessions_held, students_served, mentors_present, completed_weekly_tasks, submitted_at").order("week_start", { ascending: false }).limit(200),
    admin.from("tasks").select("id, title, description, assigned_chapter_id, due_date, priority, status, completed_at, created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("events").select("id, title, description, starts_at, ends_at, location, link, chapter_id, created_at").order("starts_at", { ascending: true }).limit(100),
  ]);
  const firstError = [applications.error, chapters.error, reports.error, tasks.error, events.error].find(Boolean);
  if (firstError) throw firstError;
  return { applications: applications.data ?? [], chapters: chapters.data ?? [], reports: reports.data ?? [], tasks: tasks.data ?? [], events: events.data ?? [] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "chapter-login") {
      const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown").split(",")[0].trim();
      const ipHash = await sha256(ip);
      const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await admin.from("chapter_login_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("attempted_at", windowStart);
      if ((count ?? 0) >= 10) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);

      const normalized = normalizeCode(body.code);
      if (normalized.length < 10) return json({ error: "Enter the full chapter code." }, 400);
      const codeHash = await sha256(normalized);
      const { data: chapter } = await admin.from("chapters").select("id, name, status").eq("access_code_hash", codeHash).eq("status", "active").maybeSingle();
      await admin.from("chapter_login_attempts").insert({ ip_hash: ipHash, successful: Boolean(chapter) });
      if (!chapter) return json({ error: "That chapter code is not active." }, 401);

      const token = randomString(48);
      await admin.from("chapter_sessions").insert({ chapter_id: chapter.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
      return json({ token, dashboard: await getChapterDashboard(chapter.id) });
    }

    if (action === "chapter-dashboard") {
      const session = await validateChapterSession(body.token);
      if (!session) return json({ error: "Your chapter session expired. Enter the chapter code again." }, 401);
      return json({ dashboard: await getChapterDashboard(session.chapter_id) });
    }

    if (action === "chapter-submit-report") {
      const session = await validateChapterSession(body.token);
      if (!session) return json({ error: "Your chapter session expired. Enter the chapter code again." }, 401);
      const report = body.report ?? {};
      const payload = {
        chapter_id: session.chapter_id,
        week_start: String(report.week_start ?? new Date().toISOString().slice(0, 10)),
        sessions_held: Math.max(0, Number(report.sessions_held ?? 0)),
        students_served: Math.max(0, Number(report.students_served ?? 0)),
        mentors_present: Math.max(0, Number(report.mentors_present ?? 0)),
        completed_weekly_tasks: Boolean(report.completed_weekly_tasks),
        highlights: String(report.highlights ?? "").slice(0, 4000),
        blockers: String(report.blockers ?? "").slice(0, 4000),
        submitted_at: new Date().toISOString(),
      };
      const { error } = await admin.from("weekly_reports").upsert(payload, { onConflict: "chapter_id,week_start" });
      if (error) throw error;
      return json({ dashboard: await getChapterDashboard(session.chapter_id) });
    }

    if (action === "chapter-toggle-task") {
      const session = await validateChapterSession(body.token);
      if (!session) return json({ error: "Your chapter session expired. Enter the chapter code again." }, 401);
      const complete = Boolean(body.complete);
      const { error } = await admin.from("tasks").update({ status: complete ? "complete" : "open", completed_at: complete ? new Date().toISOString() : null }).eq("id", String(body.task_id)).eq("assigned_chapter_id", session.chapter_id);
      if (error) throw error;
      return json({ dashboard: await getChapterDashboard(session.chapter_id) });
    }

    if (action === "chapter-logout") {
      const rawToken = String(body.token ?? "");
      if (rawToken) await admin.from("chapter_sessions").delete().eq("token_hash", await sha256(rawToken));
      return json({ ok: true });
    }

    const adminUser = await requireAdmin(req);
    if (!adminUser) return json({ error: "Admin access required." }, 403);

    if (action === "admin-overview") return json(await adminOverview());

    if (action === "admin-create-chapter") {
      const chapter = body.chapter ?? {};
      const rawCode = chapter.code ? String(chapter.code) : generateCode();
      const normalized = normalizeCode(rawCode);
      if (normalized.length < 10) return json({ error: "Use a chapter code with at least 10 letters or numbers." }, 400);
      const payload = {
        name: String(chapter.name ?? "").trim(),
        slug: slugify(String(chapter.name ?? "")),
        location: String(chapter.location ?? "").trim(),
        contact_name: String(chapter.contact_name ?? "").trim(),
        contact_email: String(chapter.contact_email ?? "").trim().toLowerCase(),
        contact_phone: String(chapter.contact_phone ?? "").trim() || null,
        advisor_name: String(chapter.advisor_name ?? "").trim() || null,
        advisor_email: String(chapter.advisor_email ?? "").trim().toLowerCase() || null,
        status: "active",
        access_code_hash: await sha256(normalized),
        access_code_hint: normalized.slice(-4),
      };
      if (!payload.name || !payload.location || !payload.contact_name || !payload.contact_email) return json({ error: "Name, location, lead name, and lead email are required." }, 400);
      const { data, error } = await admin.from("chapters").insert(payload).select("id, name").single();
      if (error) throw error;
      return json({ chapter: data, code: rawCode, overview: await adminOverview() });
    }

    if (action === "admin-approve-application") {
      const applicationId = String(body.application_id ?? "");
      const { data: application, error: applicationError } = await admin.from("chapter_applications").select("*").eq("id", applicationId).single();
      if (applicationError) throw applicationError;
      if (application.status === "approved") return json({ error: "This application is already approved." }, 409);
      const code = generateCode();
      const normalized = normalizeCode(code);
      const { data: chapter, error: chapterError } = await admin.from("chapters").insert({
        name: application.organization_name,
        slug: slugify(application.organization_name),
        location: application.location,
        contact_name: application.contact_name,
        contact_email: String(application.contact_email).toLowerCase(),
        contact_phone: application.contact_phone || null,
        status: "active",
        access_code_hash: await sha256(normalized),
        access_code_hint: normalized.slice(-4),
      }).select("id, name").single();
      if (chapterError) throw chapterError;
      await admin.from("chapter_applications").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", applicationId);
      return json({ chapter, code, overview: await adminOverview() });
    }

    if (action === "admin-update-application") {
      const status = String(body.status ?? "");
      if (!["new", "reviewing", "declined"].includes(status)) return json({ error: "Invalid application status." }, 400);
      const { error } = await admin.from("chapter_applications").update({ status, internal_notes: String(body.internal_notes ?? "").slice(0, 4000), updated_at: new Date().toISOString() }).eq("id", String(body.application_id));
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-reset-code") {
      const chapterId = String(body.chapter_id ?? "");
      const code = generateCode();
      const normalized = normalizeCode(code);
      const { error } = await admin.from("chapters").update({ access_code_hash: await sha256(normalized), access_code_hint: normalized.slice(-4) }).eq("id", chapterId);
      if (error) throw error;
      await admin.from("chapter_sessions").delete().eq("chapter_id", chapterId);
      return json({ code, overview: await adminOverview() });
    }

    if (action === "admin-assign-task") {
      const task = body.task ?? {};
      const { error } = await admin.from("tasks").insert({ title: String(task.title ?? "").trim(), description: String(task.description ?? "").trim() || null, assigned_chapter_id: String(task.chapter_id ?? ""), due_date: task.due_date || null, priority: task.priority === "high" ? "high" : "normal", status: "open", created_by: adminUser.id });
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-create-event") {
      const event = body.event ?? {};
      const { error } = await admin.from("events").insert({ title: String(event.title ?? "").trim(), description: String(event.description ?? "").trim() || null, starts_at: event.starts_at, ends_at: event.ends_at || null, location: String(event.location ?? "").trim() || null, link: String(event.link ?? "").trim() || null, chapter_id: event.chapter_id || null, created_by: adminUser.id });
      if (error) throw error;
      return json(await adminOverview());
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return json({ error: message }, 400);
  }
});
