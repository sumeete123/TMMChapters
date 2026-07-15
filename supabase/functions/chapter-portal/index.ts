import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const url = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function randomSixDigitCode() {
  const result: number[] = [];
  while (result.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    for (const byte of bytes) {
      if (byte < 250) result.push(byte % 10);
      if (result.length === 6) break;
    }
  }
  return result.join("");
}

function slugify(value: string) {
  const suffix = crypto.randomUUID().slice(0, 6);
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "chapter";
  return `${base}-${suffix}`;
}

async function requestAuth(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, userClient };
}

async function requireAdmin(userClient: SupabaseClient) {
  const { data, error } = await userClient.rpc("is_admin");
  return !error && data === true;
}

async function currentChapterId(userClient: SupabaseClient) {
  const { data, error } = await userClient.rpc("current_chapter_id");
  return error ? null : data as string | null;
}

async function getChapterDashboard(chapterId: string) {
  const now = new Date().toISOString();
  const [chapterResult, tasksResult, eventsResult, reportsResult] = await Promise.all([
    admin.from("chapters").select("id, name, location, contact_name, contact_email, status").eq("id", chapterId).single(),
    admin.from("tasks").select("id, title, description, due_date, priority, status, completed_at").eq("assigned_chapter_id", chapterId).neq("status", "archived").order("due_date", { ascending: true, nullsFirst: false }),
    admin.from("events").select("id, title, description, starts_at, ends_at, location, link, chapter_id").or(`chapter_id.is.null,chapter_id.eq.${chapterId}`).gte("starts_at", now).order("starts_at", { ascending: true }).limit(10),
    admin.from("weekly_reports").select("id, week_start, sessions_held, students_served, mentors_present, completed_weekly_tasks, highlights, blockers, submitted_at").eq("chapter_id", chapterId).order("week_start", { ascending: false }).limit(8),
  ]);
  const firstError = [chapterResult.error, tasksResult.error, eventsResult.error, reportsResult.error].find(Boolean);
  if (firstError) throw firstError;
  return { chapter: chapterResult.data, tasks: tasksResult.data ?? [], events: eventsResult.data ?? [], reports: reportsResult.data ?? [] };
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

async function provisionUniqueChapterCode(chapterId: string, requestedCode?: unknown) {
  if (requestedCode !== undefined && requestedCode !== null && String(requestedCode).trim() !== "") {
    const code = String(requestedCode).trim();
    const { error } = await admin.rpc("provision_chapter_code", { target_chapter_id: chapterId, input_code: code });
    if (error) throw error;
    return code;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomSixDigitCode();
    const { error } = await admin.rpc("provision_chapter_code", { target_chapter_id: chapterId, input_code: code });
    if (!error) return code;
    if (!error.message.includes("CHAPTER_CODE_COLLISION")) throw error;
  }
  throw new Error("A unique chapter code could not be generated. Try again.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await requestAuth(req);
    if (!auth) return json({ error: "Access denied. Start a new access session and try again." }, 401);
    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "chapter-login") {
      const { data, error } = await auth.userClient.rpc("verify_chapter_code", { input_code: String(body.code ?? "") });
      if (error?.message.includes("RATE_LIMITED")) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
      if (error) return json({ error: "Access denied." }, 403);
      if (data !== true) return json({ error: "That access code is not valid." }, 401);
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Access denied." }, 403);
      return json({ dashboard: await getChapterDashboard(chapterId) });
    }

    if (action === "chapter-dashboard") {
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Your access session has expired. Enter your access code again." }, 401);
      return json({ dashboard: await getChapterDashboard(chapterId) });
    }

    if (action === "chapter-submit-report") {
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Your access session has expired. Enter your access code again." }, 401);
      const report = body.report ?? {};
      const payload = {
        chapter_id: chapterId,
        week_start: String(report.week_start ?? new Date().toISOString().slice(0, 10)),
        sessions_held: Math.max(0, Number(report.sessions_held ?? 0)),
        students_served: Math.max(0, Number(report.students_served ?? 0)),
        mentors_present: Math.max(0, Number(report.mentors_present ?? 0)),
        completed_weekly_tasks: Boolean(report.completed_weekly_tasks),
        highlights: String(report.highlights ?? "").slice(0, 4000),
        blockers: String(report.blockers ?? "").slice(0, 4000),
        submitted_by: auth.user.id,
        submitted_at: new Date().toISOString(),
      };
      const { error } = await admin.from("weekly_reports").upsert(payload, { onConflict: "chapter_id,week_start" });
      if (error) throw error;
      return json({ dashboard: await getChapterDashboard(chapterId) });
    }

    if (action === "chapter-toggle-task") {
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Your access session has expired. Enter your access code again." }, 401);
      const complete = Boolean(body.complete);
      const { error } = await admin.from("tasks").update({ status: complete ? "complete" : "open", completed_at: complete ? new Date().toISOString() : null }).eq("id", String(body.task_id)).eq("assigned_chapter_id", chapterId);
      if (error) throw error;
      return json({ dashboard: await getChapterDashboard(chapterId) });
    }

    if (action === "chapter-logout") {
      await auth.userClient.rpc("clear_chapter_session");
      return json({ ok: true });
    }

    if (!await requireAdmin(auth.userClient)) {
      return json({ error: "Your access session has expired. Enter your access code again." }, 403);
    }

    if (action === "admin-overview") return json(await adminOverview());

    if (action === "admin-create-chapter") {
      const chapter = body.chapter ?? {};
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
      };
      if (!payload.name || !payload.location || !payload.contact_name || !payload.contact_email) return json({ error: "Name, location, lead name, and lead email are required." }, 400);
      const { data, error } = await admin.from("chapters").insert(payload).select("id, name").single();
      if (error) throw error;
      const code = await provisionUniqueChapterCode(data.id, chapter.code);
      return json({ chapter: data, code, overview: await adminOverview() });
    }

    if (action === "admin-approve-application") {
      const applicationId = String(body.application_id ?? "");
      const { data: application, error: applicationError } = await admin.from("chapter_applications").select("*").eq("id", applicationId).single();
      if (applicationError) throw applicationError;
      if (application.status === "approved") return json({ error: "This application is already approved." }, 409);
      const { data: chapter, error: chapterError } = await admin.from("chapters").insert({
        name: application.organization_name,
        slug: slugify(application.organization_name),
        location: application.location,
        contact_name: application.contact_name,
        contact_email: String(application.contact_email).toLowerCase(),
        contact_phone: application.contact_phone || null,
        status: "active",
      }).select("id, name").single();
      if (chapterError) throw chapterError;
      const code = await provisionUniqueChapterCode(chapter.id);
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
      const code = await provisionUniqueChapterCode(chapterId);
      return json({ code, overview: await adminOverview() });
    }

    if (action === "admin-assign-task") {
      const task = body.task ?? {};
      const { error } = await admin.from("tasks").insert({ title: String(task.title ?? "").trim(), description: String(task.description ?? "").trim() || null, assigned_chapter_id: String(task.chapter_id ?? ""), due_date: task.due_date || null, priority: task.priority === "high" ? "high" : "normal", status: "open", created_by: auth.user.id });
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-create-event") {
      const event = body.event ?? {};
      const { error } = await admin.from("events").insert({ title: String(event.title ?? "").trim(), description: String(event.description ?? "").trim() || null, starts_at: event.starts_at, ends_at: event.ends_at || null, location: String(event.location ?? "").trim() || null, link: String(event.link ?? "").trim() || null, chapter_id: event.chapter_id || null, created_by: auth.user.id });
      if (error) throw error;
      return json(await adminOverview());
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    if (message.includes("RATE_LIMITED")) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
    if (message.includes("INVALID_CODE_FORMAT")) return json({ error: "Enter a 6-digit access code." }, 400);
    return json({ error: "The request could not be completed." }, 400);
  }
});
