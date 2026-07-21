import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
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
      if (result.length === 0 && byte < 252) result.push((byte % 9) + 1);
      else if (result.length > 0 && byte < 250) result.push(byte % 10);
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

function boundedWholeNumber(value: unknown, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum ? number : null;
}

function boundedDecimal(value: unknown, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? Math.round(number * 100) / 100 : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function chapterGeography(value: Record<string, unknown>) {
  const chapterScope = String(value.chapter_scope ?? "").trim();
  const city = String(value.city ?? "").trim().slice(0, 120);
  const requestedRegion = String(value.region ?? "").trim().slice(0, 120);
  const schoolName = String(value.school_name ?? "").trim().slice(0, 160);
  if (city.length < 2) throw new Error("INVALID_CHAPTER_CITY");

  if (chapterScope === "school") {
    if (schoolName.length < 2) throw new Error("INVALID_CHAPTER_SCHOOL");
    if (!["nc", "north carolina"].includes(requestedRegion.toLowerCase())) throw new Error("INVALID_NC_CHAPTER_REGION");
    return {
      chapter_scope: "school",
      city,
      region: "North Carolina",
      school_name: schoolName,
      name: schoolName,
      location: `${city}, North Carolina`,
    };
  }

  if (chapterScope === "regional") {
    if (requestedRegion.length < 2) throw new Error("INVALID_CHAPTER_REGION");
    if (["nc", "north carolina"].includes(requestedRegion.toLowerCase())) throw new Error("INVALID_REGIONAL_CHAPTER_REGION");
    return {
      chapter_scope: "regional",
      city,
      region: requestedRegion,
      school_name: null,
      name: `${city} Chapter`,
      location: `${city}, ${requestedRegion}`,
    };
  }

  throw new Error("INVALID_CHAPTER_SCOPE");
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

async function getNationalImpact() {
  const { data, error } = await admin.from("national_chapter_impact")
    .select("name, students_impacted, students_taught, students_taught_is_minimum, instructional_hours, volunteer_count, session_count, chapter_count, as_of_date")
    .eq("id", "national")
    .single();
  if (error) throw error;
  return data;
}

async function getNationalChapterId() {
  const { data, error } = await admin.from("chapters").select("id, is_official").eq("slug", "national").single();
  if (error) throw error;
  if (!data.is_official) throw new Error("The National Chapter is not marked official.");
  return data.id as string;
}

async function getChapterDashboard(chapterId: string) {
  const now = new Date().toISOString();
  const [chapterResult, tasksResult, eventsResult, reportsResult, volunteersResult] = await Promise.all([
    admin.from("chapters").select("id, name, location, contact_name, contact_email, status, is_official, chapter_scope, city, region, school_name").eq("id", chapterId).single(),
    admin.from("tasks").select("id, title, description, due_date, priority, status, completed_at").eq("assigned_chapter_id", chapterId).neq("status", "archived").order("due_date", { ascending: true, nullsFirst: false }),
    admin.from("events").select("id, title, description, starts_at, ends_at, location, link, chapter_id").or(`chapter_id.is.null,chapter_id.eq.${chapterId}`).gte("starts_at", now).order("starts_at", { ascending: true }).limit(10),
    admin.from("weekly_reports").select("id, week_start, sessions_held, students_served, instructional_hours, completed_weekly_tasks, highlights, blockers, next_week_plan, support_needed, submitted_at").eq("chapter_id", chapterId).order("week_start", { ascending: false }).limit(8),
    admin.from("chapter_volunteers").select("id, full_name, email, phone, role, joined_on, status, notes, created_at, updated_at").eq("chapter_id", chapterId).order("status").order("full_name"),
  ]);
  const firstError = [chapterResult.error, tasksResult.error, eventsResult.error, reportsResult.error, volunteersResult.error].find(Boolean);
  if (firstError) throw firstError;
  const reports = reportsResult.data ?? [];
  let safeReviews: Array<{ report_id: string; status: string; public_feedback: string | null; reviewed_at: string | null }> = [];
  if (reports.length) {
    const { data, error } = await admin.from("weekly_report_reviews")
      .select("report_id, status, public_feedback, reviewed_at")
      .in("report_id", reports.map((report) => report.id));
    if (error) throw error;
    safeReviews = data ?? [];
  }
  const reviewByReport = new Map(safeReviews.map((review) => [review.report_id, review]));
  const chapterReports = reports.map((report) => {
    const review = reviewByReport.get(report.id);
    return {
      ...report,
      review_status: review?.status ?? "pending",
      public_feedback: review?.public_feedback ?? null,
      reviewed_at: review?.reviewed_at ?? null,
    };
  });
  return { chapter: chapterResult.data, tasks: tasksResult.data ?? [], events: eventsResult.data ?? [], reports: chapterReports, volunteers: volunteersResult.data ?? [] };
}

async function adminOverview() {
  const [applications, chapters, reports, reviews, tasks, events, volunteers, nationalImpact] = await Promise.all([
    admin.from("chapter_applications").select("id, contact_name, contact_email, contact_phone, additional_contacts, organization_name, location, chapter_scope, city, region, school_name, student_reach, why, status, internal_notes, created_at").order("created_at", { ascending: false }),
    admin.from("chapters").select("id, name, slug, location, chapter_scope, city, region, school_name, contact_name, contact_email, contact_phone, advisor_name, advisor_email, status, access_code_hint, is_official, created_at").order("name"),
    admin.from("weekly_reports").select("id, chapter_id, week_start, sessions_held, students_served, instructional_hours, completed_weekly_tasks, highlights, blockers, next_week_plan, support_needed, submitted_at").order("week_start", { ascending: false }).limit(200),
    admin.from("weekly_report_reviews").select("report_id, status, rating, private_notes, public_feedback, reviewed_at, reviewed_by, updated_at").order("updated_at", { ascending: false }).limit(200),
    admin.from("tasks").select("id, title, description, assigned_chapter_id, due_date, priority, status, completed_at, created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("events").select("id, title, description, starts_at, ends_at, location, link, chapter_id, created_at").order("starts_at", { ascending: true }).limit(100),
    admin.from("chapter_volunteers").select("id, chapter_id, full_name, email, phone, role, joined_on, status, notes, created_at, updated_at").order("created_at", { ascending: false }).limit(500),
    getNationalImpact(),
  ]);
  const firstError = [applications.error, chapters.error, reports.error, reviews.error, tasks.error, events.error, volunteers.error].find(Boolean);
  if (firstError) throw firstError;
  // Attach each chapter's raw access code for the admin-only overview. Codes live
  // in the private schema and are readable solely via this service-role RPC; the
  // admin gate on this action is enforced before adminOverview() is ever called.
  const codeByChapter = new Map<string, string>();
  try {
    const { data: codes } = await admin.rpc("admin_chapter_codes");
    if (Array.isArray(codes)) {
      for (const row of codes as Array<{ chapter_id: string; code: string }>) {
        if (row?.chapter_id && row?.code) codeByChapter.set(row.chapter_id, row.code);
      }
    }
  } catch { /* Codes are a convenience; the overview still loads without them. */ }
  const chapters_with_codes = (chapters.data ?? []).map((chapter) => ({ ...chapter, access_code: codeByChapter.get(chapter.id) ?? null }));
  return { applications: applications.data ?? [], chapters: chapters_with_codes, reports: reports.data ?? [], reviews: reviews.data ?? [], tasks: tasks.data ?? [], events: events.data ?? [], volunteers: volunteers.data ?? [], nationalImpact };
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
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 65_536) return json({ error: "The request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      body = asRecord(await req.json());
    } catch {
      return json({ error: "Send a valid JSON request." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Send a valid JSON request." }, 400);
    const action = String(body.action ?? "");

    if (action === "national-impact") return json({ impact: await getNationalImpact() });

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
      const report = asRecord(body.report);
      const sessionsHeld = boundedWholeNumber(report.sessions_held, 1000);
      const studentsServed = boundedWholeNumber(report.students_served, 100_000);
      const instructionalHours = boundedDecimal(report.instructional_hours, 1000);
      const highlights = String(report.highlights ?? "").trim().slice(0, 4000);
      const nextWeekPlan = String(report.next_week_plan ?? "").trim().slice(0, 4000);
      if (sessionsHeld === null || studentsServed === null || instructionalHours === null) return json({ error: "Enter valid weekly totals." }, 400);
      if (highlights.length < 2 || nextWeekPlan.length < 2) return json({ error: "Add this week’s highlights and next week’s plan." }, 400);
      const payload = {
        chapter_id: chapterId,
        week_start: String(report.week_start ?? new Date().toISOString().slice(0, 10)),
        sessions_held: sessionsHeld,
        students_served: studentsServed,
        instructional_hours: instructionalHours,
        completed_weekly_tasks: Boolean(report.completed_weekly_tasks),
        highlights,
        blockers: String(report.blockers ?? "").trim().slice(0, 4000),
        next_week_plan: nextWeekPlan,
        support_needed: String(report.support_needed ?? "").trim().slice(0, 4000),
        submitted_by: auth.user.id,
        submitted_at: new Date().toISOString(),
      };
      const { data: savedReport, error } = await admin.from("weekly_reports")
        .upsert(payload, { onConflict: "chapter_id,week_start" })
        .select("id")
        .single();
      if (error) throw error;
      const { error: reviewResetError } = await admin.from("weekly_report_reviews").upsert({
        report_id: savedReport.id,
        status: "pending",
        rating: null,
        private_notes: null,
        public_feedback: null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "report_id" });
      if (reviewResetError) throw reviewResetError;
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

    if (action === "chapter-add-volunteer") {
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Your access session has expired. Enter your access code again." }, 401);
      const volunteer = asRecord(body.volunteer);
      const payload = {
        chapter_id: chapterId,
        full_name: String(volunteer.full_name ?? "").trim().slice(0, 120),
        email: String(volunteer.email ?? "").trim().toLowerCase().slice(0, 254) || null,
        phone: String(volunteer.phone ?? "").trim().slice(0, 40) || null,
        role: String(volunteer.role ?? "Volunteer").trim().slice(0, 80) || "Volunteer",
        joined_on: String(volunteer.joined_on ?? new Date().toISOString().slice(0, 10)),
        notes: String(volunteer.notes ?? "").trim().slice(0, 2000) || null,
        status: "active",
        created_by: auth.user.id,
      };
      if (payload.full_name.length < 2) return json({ error: "Enter the volunteer’s full name." }, 400);
      if (payload.email && !payload.email.includes("@")) return json({ error: "Enter a valid volunteer email." }, 400);
      const { error } = await admin.from("chapter_volunteers").insert(payload);
      if (error) throw error;
      return json({ dashboard: await getChapterDashboard(chapterId) });
    }

    if (action === "chapter-update-volunteer") {
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Your access session has expired. Enter your access code again." }, 401);
      const status = String(body.status ?? "");
      if (!["active", "inactive"].includes(status)) return json({ error: "Choose a valid volunteer status." }, 400);
      const { error } = await admin.from("chapter_volunteers").update({ status, updated_at: new Date().toISOString() }).eq("id", String(body.volunteer_id ?? "")).eq("chapter_id", chapterId);
      if (error) throw error;
      return json({ dashboard: await getChapterDashboard(chapterId) });
    }

    if (action === "chapter-delete-volunteer") {
      const chapterId = await currentChapterId(auth.userClient);
      if (!chapterId) return json({ error: "Your access session has expired. Enter your access code again." }, 401);
      const volunteerId = String(body.volunteer_id ?? "");
      const { data: volunteer, error: lookupError } = await admin.from("chapter_volunteers").select("id, role").eq("id", volunteerId).eq("chapter_id", chapterId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!volunteer) return json({ error: "That volunteer could not be found." }, 404);
      if (String(volunteer.role).toLowerCase() === "chapter lead") return json({ error: "The chapter lead cannot be deleted. Mark them inactive instead." }, 400);
      const { error } = await admin.from("chapter_volunteers").delete().eq("id", volunteerId).eq("chapter_id", chapterId);
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

    if (action === "admin-update-national-impact") {
      const impact = asRecord(body.impact);
      const studentsImpacted = boundedWholeNumber(impact.students_impacted, 1_000_000);
      const studentsTaught = boundedWholeNumber(impact.students_taught, 1_000_000);
      const instructionalHours = boundedDecimal(impact.instructional_hours, 1_000_000);
      const volunteerCount = boundedWholeNumber(impact.volunteer_count, 1_000_000);
      const sessionCount = boundedWholeNumber(impact.session_count, 1_000_000);
      const chapterCount = boundedWholeNumber(impact.chapter_count, 100_000);
      const asOfDate = String(impact.as_of_date ?? "").trim();
      if ([studentsImpacted, studentsTaught, instructionalHours, volunteerCount, sessionCount, chapterCount].some((value) => value === null) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        return json({ error: "Enter valid National Chapter impact totals and an as-of date." }, 400);
      }
      const { error } = await admin.from("national_chapter_impact").update({
        students_impacted: studentsImpacted,
        students_taught: studentsTaught,
        students_taught_is_minimum: false,
        instructional_hours: instructionalHours,
        volunteer_count: volunteerCount,
        session_count: sessionCount,
        chapter_count: chapterCount,
        as_of_date: asOfDate,
        updated_at: new Date().toISOString(),
      }).eq("id", "national");
      if (error) throw error;
      return json({ overview: await adminOverview() });
    }

    if (action === "admin-submit-national-report") {
      const report = asRecord(body.report);
      const chapterId = await getNationalChapterId();
      const sessionsHeld = boundedWholeNumber(report.sessions_held, 1000);
      const studentsServed = boundedWholeNumber(report.students_served, 100_000);
      const instructionalHours = boundedDecimal(report.instructional_hours, 1000);
      const highlights = String(report.highlights ?? "").trim().slice(0, 4000);
      const nextWeekPlan = String(report.next_week_plan ?? "").trim().slice(0, 4000);
      if (sessionsHeld === null || studentsServed === null || instructionalHours === null) return json({ error: "Enter valid National Chapter weekly totals." }, 400);
      if (highlights.length < 2 || nextWeekPlan.length < 2) return json({ error: "Add this week’s National Chapter highlights and next week’s plan." }, 400);
      const { data: savedReport, error } = await admin.from("weekly_reports").upsert({
        chapter_id: chapterId,
        week_start: String(report.week_start ?? new Date().toISOString().slice(0, 10)),
        sessions_held: sessionsHeld,
        students_served: studentsServed,
        instructional_hours: instructionalHours,
        completed_weekly_tasks: Boolean(report.completed_weekly_tasks),
        highlights,
        blockers: String(report.blockers ?? "").trim().slice(0, 4000),
        next_week_plan: nextWeekPlan,
        support_needed: String(report.support_needed ?? "").trim().slice(0, 4000),
        submitted_by: auth.user.id,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "chapter_id,week_start" }).select("id").single();
      if (error) throw error;
      const { error: reviewResetError } = await admin.from("weekly_report_reviews").upsert({
        report_id: savedReport.id,
        status: "pending",
        rating: null,
        private_notes: null,
        public_feedback: null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "report_id" });
      if (reviewResetError) throw reviewResetError;
      return json({ overview: await adminOverview() });
    }

    if (action === "admin-create-chapter") {
      const chapter = asRecord(body.chapter);
      const geography = chapterGeography(chapter);
      const payload = {
        name: geography.name,
        slug: slugify(geography.name),
        location: geography.location,
        chapter_scope: geography.chapter_scope,
        city: geography.city,
        region: geography.region,
        school_name: geography.school_name,
        contact_name: String(chapter.contact_name ?? "").trim(),
        contact_email: String(chapter.contact_email ?? "").trim().toLowerCase(),
        contact_phone: String(chapter.contact_phone ?? "").trim() || null,
        advisor_name: String(chapter.advisor_name ?? "").trim() || null,
        advisor_email: String(chapter.advisor_email ?? "").trim().toLowerCase() || null,
        status: "active",
      };
      if (!payload.contact_name || !payload.contact_email) return json({ error: "Lead name and lead email are required." }, 400);
      const { data, error } = await admin.from("chapters").insert(payload).select("id, name, contact_name, contact_email").single();
      if (error) throw error;
      let code: string;
      try {
        code = await provisionUniqueChapterCode(data.id, chapter.code);
      } catch (provisionError) {
        await admin.from("chapters").delete().eq("id", data.id);
        throw provisionError;
      }
      return json({ chapter: data, code, overview: await adminOverview() });
    }

    if (action === "admin-approve-application") {
      const applicationId = String(body.application_id ?? "");
      const { data: application, error: applicationError } = await admin.from("chapter_applications").select("*").eq("id", applicationId).single();
      if (applicationError) throw applicationError;
      if (application.status === "approved") return json({ error: "This application is already approved." }, 409);
      const geography = chapterGeography(application);
      const { data: chapter, error: chapterError } = await admin.from("chapters").insert({
        name: geography.name,
        slug: slugify(geography.name),
        location: geography.location,
        chapter_scope: geography.chapter_scope,
        city: geography.city,
        region: geography.region,
        school_name: geography.school_name,
        contact_name: application.contact_name,
        contact_email: String(application.contact_email).toLowerCase(),
        contact_phone: application.contact_phone || null,
        status: "active",
      }).select("id, name, contact_name, contact_email").single();
      if (chapterError) throw chapterError;
      let code: string;
      try {
        code = await provisionUniqueChapterCode(chapter.id);
      } catch (provisionError) {
        await admin.from("chapters").delete().eq("id", chapter.id);
        throw provisionError;
      }
      const { error: approvalError } = await admin.from("chapter_applications").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", applicationId);
      if (approvalError) {
        await admin.from("chapters").delete().eq("id", chapter.id);
        throw approvalError;
      }
      const additionalContacts = Array.isArray(application.additional_contacts) ? application.additional_contacts : [];
      const volunteerRows = additionalContacts
        .slice(0, 12)
        .map((contact: Record<string, unknown>) => ({
          chapter_id: chapter.id,
          full_name: String(contact.full_name ?? contact.name ?? "").trim().slice(0, 120),
          email: String(contact.email ?? "").trim().toLowerCase().slice(0, 254) || null,
          phone: String(contact.phone ?? "").trim().slice(0, 40) || null,
          role: String(contact.role ?? "Volunteer").trim().slice(0, 80) || "Volunteer",
          status: "active",
        }))
        .filter((contact: { full_name: string }) => contact.full_name.length >= 2);
      if (volunteerRows.length) {
        const { error: volunteerError } = await admin.from("chapter_volunteers").insert(volunteerRows);
        if (volunteerError) throw volunteerError;
      }
      return json({ chapter, code, overview: await adminOverview() });
    }

    if (action === "admin-update-application") {
      const status = String(body.status ?? "");
      if (!["new", "reviewing", "declined"].includes(status)) return json({ error: "Invalid application status." }, 400);
      const { error } = await admin.from("chapter_applications").update({ status, internal_notes: String(body.internal_notes ?? "").slice(0, 4000), updated_at: new Date().toISOString() }).eq("id", String(body.application_id));
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-delete-application") {
      const applicationId = String(body.application_id ?? "");
      const { data: application, error: lookupError } = await admin.from("chapter_applications").select("id, status").eq("id", applicationId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!application) return json({ error: "That application could not be found." }, 404);
      if (application.status !== "declined") return json({ error: "Only declined applications can be deleted." }, 400);
      const { error } = await admin.from("chapter_applications").delete().eq("id", applicationId).eq("status", "declined");
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-reset-code") {
      const chapterId = String(body.chapter_id ?? "");
      const code = await provisionUniqueChapterCode(chapterId);
      return json({ code, overview: await adminOverview() });
    }

    if (action === "admin-review-report") {
      const review = asRecord(body.review);
      const reportId = String(review.report_id ?? "");
      const rating = Number(review.rating);
      const status = String(review.status ?? "reviewed");
      if (!reportId) return json({ error: "Choose a weekly report to review." }, 400);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "Choose a rating from 1 to 5." }, 400);
      if (!["reviewed", "needs_follow_up"].includes(status)) return json({ error: "Choose a valid review status." }, 400);
      const { data: existingReport, error: reportError } = await admin.from("weekly_reports").select("id").eq("id", reportId).maybeSingle();
      if (reportError) throw reportError;
      if (!existingReport) return json({ error: "That weekly report could not be found." }, 404);
      const { error } = await admin.from("weekly_report_reviews").upsert({
        report_id: reportId,
        status,
        rating,
        private_notes: String(review.private_notes ?? "").trim().slice(0, 4000) || null,
        public_feedback: String(review.public_feedback ?? "").trim().slice(0, 2000) || null,
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "report_id" });
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-assign-task") {
      const task = asRecord(body.task);
      const { error } = await admin.from("tasks").insert({ title: String(task.title ?? "").trim(), description: String(task.description ?? "").trim() || null, assigned_chapter_id: String(task.chapter_id ?? ""), due_date: task.due_date || null, priority: "high", status: "open", created_by: auth.user.id });
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-delete-task") {
      const { error } = await admin.from("tasks").delete().eq("id", String(body.task_id ?? ""));
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-create-event") {
      const event = asRecord(body.event);
      const link = String(event.link ?? "").trim().slice(0, 2048);
      if (link) {
        try {
          const protocol = new URL(link).protocol;
          if (protocol !== "https:" && protocol !== "http:") return json({ error: "Use an http or https event link." }, 400);
        } catch {
          return json({ error: "Enter a valid event link." }, 400);
        }
      }
      const { error } = await admin.from("events").insert({ title: String(event.title ?? "").trim().slice(0, 160), description: String(event.description ?? "").trim().slice(0, 4000) || null, starts_at: event.starts_at, ends_at: event.ends_at || null, location: String(event.location ?? "").trim().slice(0, 240) || null, link: link || null, chapter_id: event.chapter_id || null, created_by: auth.user.id });
      if (error) throw error;
      return json(await adminOverview());
    }

    if (action === "admin-delete-event") {
      const { error } = await admin.from("events").delete().eq("id", String(body.event_id ?? ""));
      if (error) throw error;
      return json(await adminOverview());
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    if (message.includes("RATE_LIMITED")) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
    if (message.includes("INVALID_CODE_FORMAT")) return json({ error: "Enter a 6-digit access code." }, 400);
    if (message.includes("chapters_one_open_school_idx")) return json({ error: "That school already has an active chapter." }, 409);
    if (message.includes("chapters_one_open_regional_city_idx")) return json({ error: "That city already has an active regional chapter." }, 409);
    if (message.includes("INVALID_NC_CHAPTER_REGION") || message.includes("INVALID_REGIONAL_CHAPTER_REGION")) return json({ error: "North Carolina uses school chapters. Locations outside North Carolina use regional city chapters." }, 400);
    if (message.includes("INVALID_CHAPTER_SCHOOL")) return json({ error: "Enter the North Carolina school name." }, 400);
    if (message.includes("INVALID_CHAPTER_CITY") || message.includes("INVALID_CHAPTER_REGION") || message.includes("INVALID_CHAPTER_SCOPE")) return json({ error: "Choose the chapter type and enter a valid city and region." }, 400);
    return json({ error: "The request could not be completed." }, 400);
  }
});
