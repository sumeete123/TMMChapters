"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type View = "access" | "apply" | "chapter" | "admin";
type Theme = "light" | "dark";
type AdminTab = "overview" | "applications" | "reviews" | "chapters" | "work";
type AuthState = "loading" | "ready" | "error";

type Chapter = {
  id: string;
  name: string;
  location: string;
  chapter_type?: "city" | "school";
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  advisor_name?: string | null;
  advisor_email?: string | null;
  status: string;
  access_code_hint?: string | null;
};

type Task = {
  id: string;
  title: string;
  description?: string | null;
  assigned_chapter_id?: string;
  due_date?: string | null;
  priority: string;
  status: string;
  completed_at?: string | null;
};

type Volunteer = {
  id: string;
  chapter_id?: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  joined_on: string;
  status: "active" | "inactive";
  notes?: string | null;
  created_at: string;
  updated_at?: string;
};

type ChapterEvent = {
  id: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  link?: string | null;
  chapter_id?: string | null;
};

type Report = {
  id: string;
  chapter_id?: string;
  week_start: string;
  sessions_held: number;
  students_served: number;
  instructional_hours: number;
  completed_weekly_tasks: boolean;
  highlights?: string | null;
  blockers?: string | null;
  next_week_plan?: string | null;
  support_needed?: string | null;
  submitted_at: string;
  review_status?: "pending" | "reviewed" | "needs_follow_up";
  public_feedback?: string | null;
  reviewed_at?: string | null;
};

type NationalImpact = {
  name: string;
  students_taught: number;
  students_taught_is_minimum: boolean;
  instructional_hours: number;
  volunteer_count: number;
  session_count: number;
  chapter_count: number;
  as_of_date: string;
};

type ReportReview = {
  report_id: string;
  status: "pending" | "reviewed" | "needs_follow_up";
  rating?: number | null;
  private_notes?: string | null;
  public_feedback?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  updated_at: string;
};

type Application = {
  id: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  additional_contacts?: Array<{ full_name: string; email?: string; phone?: string; role?: string }>;
  organization_name: string;
  location: string;
  chapter_type?: "city" | "school";
  application_kind?: "new_chapter" | "join_existing";
  existing_chapter_id?: string | null;
  student_reach?: string | null;
  why?: string | null;
  status: string;
  created_at: string;
};

type ChapterMatch = Pick<Chapter, "id" | "name" | "location"> & { chapter_type: "city" | "school" };

type ChapterDashboardData = { chapter: Chapter; tasks: Task[]; events: ChapterEvent[]; reports: Report[]; volunteers: Volunteer[] };
type AdminData = { applications: Application[]; chapters: Chapter[]; reports: Report[]; reviews: ReportReview[]; tasks: Task[]; events: ChapterEvent[]; volunteers: Volunteer[]; nationalImpact: NationalImpact };
type AdminActionResult = Partial<AdminData> & { code?: string; chapter?: Chapter; overview?: AdminData };

const foundingImpact: NationalImpact = { name: "TMM National Chapter", students_taught: 65, students_taught_is_minimum: true, instructional_hours: 36, volunteer_count: 19, session_count: 36, chapter_count: 1, as_of_date: "2026-07-15" };
const emptyAdmin: AdminData = { applications: [], chapters: [], reports: [], reviews: [], tasks: [], events: [], volunteers: [], nationalImpact: foundingImpact };
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

function accessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("RATE_LIMITED") || message.toLowerCase().includes("too many attempts")) {
    return "Too many attempts. Please wait 15 minutes and try again.";
  }
  if (message.toLowerCase().includes("expired")) {
    return "Your access session has expired. Enter your access code again.";
  }
  if (message.toLowerCase().includes("not valid") || message.toLowerCase().includes("invalid")) {
    return "That access code is not valid.";
  }
  if (message.includes("AUTH_REQUIRED") || message.toLowerCase().includes("access denied")) {
    return "Access denied. Enter your access code again.";
  }
  return "Access denied. Please try again.";
}

async function ensureAnonymousSession(captchaToken?: string) {
  if (!supabase) throw new Error("The portal is not connected yet.");
  const { data: current, error: currentError } = await supabase.auth.getSession();
  if (currentError) throw currentError;
  if (current.session) {
    const { data: verified, error: verificationError } = await supabase.auth.getUser();
    if (!verificationError && verified.user) return current.session;
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  if (turnstileSiteKey && !captchaToken) throw new Error("CAPTCHA_REQUIRED");
  const { data, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error) throw error;
  if (!data.session) throw new Error("AUTH_REQUIRED");
  return data.session;
}

function thisMonday() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function weekDueDate(weekStart = thisMonday()) {
  const date = new Date(`${weekStart}T12:00:00`);
  date.setDate(date.getDate() + 6);
  return date;
}

function longDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function dueTiming(date: Date) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.ceil((due.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return "Past due";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `${days} days left`;
}

function orderedOpenTasks(tasks: Task[]) {
  return tasks
    .filter((task) => task.status !== "complete")
    .sort((a, b) => {
      const priority = Number(b.priority === "high") - Number(a.priority === "high");
      return priority || (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
    });
}

function reviewLabel(status?: string) {
  if (status === "reviewed") return "Reviewed";
  if (status === "needs_follow_up") return "Follow-up needed";
  return "Awaiting review";
}

async function invokePortal<T>(action: string, payload: Record<string, unknown> = {}) {
  if (!supabase) throw new Error("The portal is not connected yet.");
  const { data, error } = await supabase.functions.invoke("chapter-portal", { body: { action, ...payload } });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      let details: { error?: string } | null = null;
      try {
        details = await response.clone().json() as { error?: string };
      } catch { /* The status-specific fallback below still gives a plain-language error. */ }
      if (details?.error) throw new Error(details.error);
      if (response.status === 429) throw new Error("Too many attempts. Please wait 15 minutes and try again.");
      if (action === "chapter-login" && response.status === 401) throw new Error("That access code is not valid.");
      if (response.status === 401 || response.status === 403) throw new Error("Your access session has expired. Enter your access code again.");
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

function Logo() {
  return <span className="logo-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function Button({ children, kind = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button className={`button ${kind}`} {...props}>{children}</button>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Status({ value }: { value: string }) {
  return <span className={`status status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function TurnstileChallenge({ onToken }: { onToken: (token: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!turnstileSiteKey || !host.current) return;
    let widgetId = "";
    let cancelled = false;
    const render = () => {
      if (cancelled || !host.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(host.current, {
        sitekey: turnstileSiteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-tmm-turnstile="true"]');
    if (existing) {
      if (window.turnstile) render();
      else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.tmmTurnstile = "true";
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken]);
  return turnstileSiteKey ? <div className="turnstile-shell" ref={host} aria-label="Security check" /> : null;
}

export default function Page() {
  const [view, setView] = useState<View>("access");
  const [theme, setTheme] = useState<Theme>("light");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [authMessage, setAuthMessage] = useState(turnstileSiteKey ? "Complete the security check to create a secure access session." : "Creating a secure access session…");
  const [captchaToken, setCaptchaToken] = useState("");
  const [dashboard, setDashboard] = useState<ChapterDashboardData | null>(null);
  const [nationalImpact, setNationalImpact] = useState<NationalImpact>(foundingImpact);
  const [adminData, setAdminData] = useState<AdminData>(emptyAdmin);
  const [adminReady, setAdminReady] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("overview");
  const [issuedCode, setIssuedCode] = useState<{ name: string; code: string } | null>(null);

  const goTo = (next: View) => {
    setView(next);
    setNotice("");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", next === "access" ? "/" : `/?view=${next}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  useEffect(() => {
    const route = new URLSearchParams(window.location.search).get("view");
    const initialView: View = route === "apply" || route === "admin" ? route : "access";
    const saved = localStorage.getItem("tmm-theme") as Theme | null;
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    window.setTimeout(() => {
      setTheme(saved === "dark" || saved === "light" ? saved : preferred);
      setView(initialView);
    }, 0);

  }, []);

  useEffect(() => {
    if (turnstileSiteKey && !captchaToken) {
      return;
    }
    const route = new URLSearchParams(window.location.search).get("view");
    const initialView: View = route === "apply" || route === "admin" ? route : "access";
    let active = true;
    void ensureAnonymousSession(captchaToken || undefined)
      .then(async () => {
        if (!active) return;
        setAuthState("ready");
        setAuthMessage("");
        try {
          const result = await invokePortal<{ impact: NationalImpact }>("national-impact");
          if (active && result.impact) setNationalImpact(result.impact);
        } catch { /* Keep the verified founding baseline visible if the live summary is temporarily unavailable. */ }
        if (initialView === "admin" && supabase) {
          const { data: allowed } = await supabase.rpc("is_admin");
          if (allowed === true) {
            const admin = await invokePortal<AdminData>("admin-overview");
            setAdminData(admin);
            setAdminReady(true);
          }
          return;
        }
        if (initialView !== "access") return;
        try {
          const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-dashboard");
          setDashboard(result.dashboard);
          setView("chapter");
        } catch {
          setDashboard(null);
        }
      })
      .catch(() => {
        if (!active) return;
        setAuthState("error");
        setAuthMessage("Secure access is temporarily unavailable. Please try again.");
      });
    return () => { active = false; };
  }, [captchaToken]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tmm-theme", theme);
  }, [theme]);

  const setMessage = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 5000);
  };

  const chapterLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await ensureAnonymousSession(captchaToken || undefined);
      const { data: verified, error } = await supabase!.rpc("verify_chapter_code", { input_code: String(form.get("code") ?? "").trim() });
      if (error) throw error;
      if (verified !== true) throw new Error("That access code is not valid.");
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-dashboard");
      setDashboard(result.dashboard);
      goTo("chapter");
    } catch (error) {
      setMessage(accessError(error));
    } finally { setBusy(false); }
  };

  const chapterLogout = async () => {
    void invokePortal("chapter-logout").catch(() => undefined);
    setDashboard(null);
    goTo("access");
  };

  const findApplicationMatch = useCallback(async (chapterType: "city" | "school", organizationName: string, location: string) => {
    await ensureAnonymousSession(captchaToken || undefined);
    const result = await invokePortal<{ match: ChapterMatch | null }>("application-find-match", {
      chapter_type: chapterType,
      organization_name: organizationName,
      location,
    });
    return result.match;
  }, [captchaToken]);

  const submitApplication = async (event: FormEvent<HTMLFormElement>): Promise<ChapterMatch | null> => {
    event.preventDefault();
    if (!supabase) {
      setMessage("The application form is not connected yet.");
      return null;
    }
    const formElement = event.currentTarget;
    setBusy(true);
    const form = new FormData(formElement);
    const payload = {
      contact_name: String(form.get("contact_name") ?? "").trim().slice(0, 120),
      contact_email: String(form.get("contact_email") ?? "").trim().toLowerCase().slice(0, 254),
      contact_phone: String(form.get("contact_phone") ?? "").trim().slice(0, 40),
      organization_name: String(form.get("organization_name") ?? "").trim().slice(0, 160),
      location: String(form.get("location") ?? "").trim().slice(0, 160),
      chapter_type: String(form.get("chapter_type") ?? ""),
      application_kind: String(form.get("application_kind") ?? "new_chapter"),
      existing_chapter_id: String(form.get("existing_chapter_id") ?? "") || null,
      create_separate: form.get("create_separate") === "true",
      student_reach: String(form.get("student_reach") ?? "").slice(0, 120),
      why: String(form.get("why") ?? "").trim().slice(0, 5000),
      additional_contacts: form.getAll("additional_name").map((name, index) => ({
        full_name: String(name).trim().slice(0, 120),
        email: String(form.getAll("additional_email")[index] ?? "").trim().toLowerCase().slice(0, 254),
        phone: String(form.getAll("additional_phone")[index] ?? "").trim().slice(0, 40),
        role: String(form.getAll("additional_role")[index] ?? "Volunteer").trim().slice(0, 80),
      })).filter((contact) => contact.full_name.length >= 2),
    };
    try {
      await ensureAnonymousSession(captchaToken || undefined);
      const result = await invokePortal<{ submitted?: boolean; match?: ChapterMatch; requires_choice?: boolean; application_kind?: string }>("application-submit", { application: payload });
      if (result.requires_choice && result.match) {
        setMessage("A matching chapter already exists. Choose whether to join it or continue separately.");
        return result.match;
      }
      formElement.reset();
      goTo("access");
      setMessage(result.application_kind === "join_existing" ? "Join request sent. We’ll contact you by email." : "Application sent. We’ll review it and contact you by email.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn’t send your application. Please try again.");
    } finally {
      setBusy(false);
    }
    return null;
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const report = {
        week_start: String(form.get("week_start") ?? thisMonday()),
        sessions_held: Number(form.get("sessions_held") ?? 0),
        students_served: Number(form.get("students_served") ?? 0),
        instructional_hours: Number(form.get("instructional_hours") ?? 0),
        completed_weekly_tasks: form.get("completed_weekly_tasks") === "on",
        highlights: String(form.get("highlights") ?? ""),
        blockers: String(form.get("blockers") ?? ""),
        next_week_plan: String(form.get("next_week_plan") ?? ""),
        support_needed: String(form.get("support_needed") ?? ""),
      };
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-submit-report", { report });
      setDashboard(result.dashboard);
      setMessage("Weekly update saved.");
    } catch (error) { setMessage(accessError(error)); }
    finally { setBusy(false); }
  };

  const toggleTask = async (task: Task) => {
    setBusy(true);
    try {
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-toggle-task", { task_id: task.id, complete: task.status !== "complete" });
      setDashboard(result.dashboard);
    } catch (error) { setMessage(accessError(error)); }
    finally { setBusy(false); }
  };

  const addVolunteer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    try {
      const form = new FormData(formElement);
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-add-volunteer", { volunteer: Object.fromEntries(form) });
      setDashboard(result.dashboard);
      formElement.reset();
      setMessage("Volunteer added.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The volunteer could not be added."); }
    finally { setBusy(false); }
  };

  const updateVolunteer = async (volunteer: Volunteer) => {
    setBusy(true);
    try {
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-update-volunteer", { volunteer_id: volunteer.id, status: volunteer.status === "active" ? "inactive" : "active" });
      setDashboard(result.dashboard);
      setMessage(volunteer.status === "active" ? "Volunteer marked inactive." : "Volunteer reactivated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The volunteer could not be updated."); }
    finally { setBusy(false); }
  };

  const deleteVolunteer = async (volunteer: Volunteer) => {
    if (!window.confirm(`Delete ${volunteer.full_name} from this chapter? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-delete-volunteer", { volunteer_id: volunteer.id });
      setDashboard(result.dashboard);
      setMessage("Volunteer deleted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The volunteer could not be deleted."); }
    finally { setBusy(false); }
  };

  const loadAdmin = async () => {
    if (!supabase) throw new Error("AUTH_REQUIRED");
    const { data: allowed, error } = await supabase.rpc("is_admin");
    if (error || allowed !== true) throw new Error("Your access session has expired.");
    const data = await invokePortal<AdminData>("admin-overview");
    setAdminData(data);
    setAdminReady(true);
  };

  const adminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return setMessage("Admin sign-in is not connected yet.");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await ensureAnonymousSession(captchaToken || undefined);
      const { data: verified, error } = await supabase.rpc("verify_admin_code", { input_code: String(form.get("code") ?? "").trim() });
      if (error) throw error;
      if (verified !== true) throw new Error("That access code is not valid.");
      const { data: allowed, error: authorizationError } = await supabase.rpc("is_admin");
      if (authorizationError || allowed !== true) throw new Error("Access denied.");
      await loadAdmin();
    }
    catch (error) { setAdminReady(false); setMessage(accessError(error)); }
    finally { setBusy(false); }
  };

  const adminAction = async (action: string, payload: Record<string, unknown>, codeName?: string) => {
    setBusy(true);
    try {
      const result = await invokePortal<AdminActionResult>(action, payload);
      if ("overview" in result && result.overview) setAdminData(result.overview as AdminData);
      else if ("applications" in result) setAdminData(result as AdminData);
      else await loadAdmin();
      if (result.code) setIssuedCode({ name: result.chapter?.name ?? codeName ?? "Chapter", code: result.code });
      setMessage("Saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };

  const adminLogout = async () => {
    if (supabase) await supabase.rpc("clear_admin_session");
    setAdminReady(false);
    setAdminData(emptyAdmin);
    goTo("access");
  };

  return <main className="app-root">
    <header className="topbar">
      <button className="brand" onClick={() => goTo("access")}><Logo /><span>The Mastery Mentors</span><small>Chapters</small></button>
      <div className="topbar-actions">
        {view !== "chapter" && view !== "admin" && <button className="nav-link" onClick={() => goTo(view === "apply" ? "access" : "apply")}>{view === "apply" ? "Chapter access" : "Apply for a chapter"}</button>}
        <button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} mode`}><span>{theme === "light" ? "☾" : "☀"}</span></button>
      </div>
    </header>

    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

    {view === "access" && <AccessView impact={nationalImpact} onLogin={chapterLogin} busy={busy} authState={authState} authMessage={authMessage} onCaptcha={setCaptchaToken} goTo={goTo} />}
    {view === "apply" && <ApplicationView onSubmit={submitApplication} onFindMatch={findApplicationMatch} busy={busy} authState={authState} authMessage={authMessage} onCaptcha={setCaptchaToken} />}
    {view === "chapter" && dashboard && <ChapterView data={dashboard} onReport={submitReport} onToggleTask={toggleTask} onAddVolunteer={addVolunteer} onUpdateVolunteer={updateVolunteer} onDeleteVolunteer={deleteVolunteer} onLogout={chapterLogout} busy={busy} />}
    {view === "admin" && <AdminView data={adminData} ready={adminReady} tab={adminTab} setTab={setAdminTab} onLogin={adminLogin} onAction={adminAction} onLogout={adminLogout} issuedCode={issuedCode} setIssuedCode={setIssuedCode} onCaptcha={setCaptchaToken} busy={busy} />}
  </main>;
}

function NationalImpactCard({ impact }: { impact: NationalImpact }) {
  const studentSuffix = impact.students_taught_is_minimum ? "+" : "";
  return <article className="national-impact-card" aria-label={`${impact.name} founding impact`}>
    <div className="national-impact-copy"><span className="tiny-label">Built by two friends · growing nationally</span><h1>{impact.name}</h1><p>The work completed before the chapter network expands—real sessions, real instruction, and the volunteer team that made them possible.</p><div className="national-student-total"><strong>{impact.students_taught.toLocaleString()}{studentSuffix}</strong><span>students taught so far</span></div></div>
    <div className="session-ledger" aria-label={`${impact.session_count} sessions held`}><div className="session-ledger-heading"><span>Session ledger</span><strong>{impact.session_count} held</strong></div><div className="session-marks" aria-hidden="true">{Array.from({ length: Math.min(36, impact.session_count) }, (_, index) => <i key={index} />)}</div></div>
    <dl className="national-impact-stats"><div><dt>Instruction</dt><dd>{Number(impact.instructional_hours).toLocaleString(undefined, { maximumFractionDigits: 2 })} hours</dd></div><div><dt>Volunteer team</dt><dd>{impact.volunteer_count} people</dd></div><div><dt>National network</dt><dd>{impact.chapter_count} chapter</dd></div></dl>
  </article>;
}

function AccessView({ impact, onLogin, busy, authState, authMessage, onCaptcha, goTo }: { impact: NationalImpact; onLogin: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; authState: AuthState; authMessage: string; onCaptcha: (token: string) => void; goTo: (view: View) => void }) {
  return <section className="access-shell national-access">
    <NationalImpactCard impact={impact} />
    <div className="access-column"><div className="access-card">
        <div className="card-heading"><span className="tiny-label">Chapter access</span><h1>Enter your chapter code</h1><p>Use the code provided when your chapter was approved.</p></div>
        <form onSubmit={onLogin} className="stack-form">
          <Field label="6-digit chapter code"><input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="••••••" required /></Field>
          {turnstileSiteKey && authState !== "ready" && <TurnstileChallenge onToken={onCaptcha} />}
          {authMessage && <p className={`access-state ${authState}`}>{authMessage}</p>}
          <Button type="submit" disabled={busy || authState !== "ready"}>{busy ? "Checking…" : authState === "loading" ? "Preparing secure access…" : "Open chapter dashboard"}</Button>
        </form>
        <div className="access-help"><span>Don’t have a code?</span><button onClick={() => goTo("apply")}>Apply to start a chapter</button></div>
      </div><button className="admin-entry" onClick={() => goTo("admin")}>Admin sign in</button></div>
  </section>;
}

function ApplicationView({ onSubmit, onFindMatch, busy, authState, authMessage, onCaptcha }: { onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<ChapterMatch | null>; onFindMatch: (chapterType: "city" | "school", organizationName: string, location: string) => Promise<ChapterMatch | null>; busy: boolean; authState: AuthState; authMessage: string; onCaptcha: (token: string) => void }) {
  const [additionalPeople, setAdditionalPeople] = useState<string[]>([]);
  const [chapterType, setChapterType] = useState<"city" | "school">("school");
  const [organizationName, setOrganizationName] = useState("");
  const [location, setLocation] = useState("");
  const [match, setMatch] = useState<ChapterMatch | null>(null);
  const [intent, setIntent] = useState<"new" | "unresolved" | "join" | "separate">("new");
  const [checking, setChecking] = useState(false);
  const matchRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const searchable = chapterType === "city" ? location.trim().length >= 2 : organizationName.trim().length >= 2 && location.trim().length >= 2;
    if (!searchable || authState !== "ready") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setChecking(true);
      void onFindMatch(chapterType, organizationName, location)
        .then((found) => {
          if (!active) return;
          setMatch(found);
          setIntent(found ? "unresolved" : "new");
        })
        .catch(() => {
          if (!active) return;
          setMatch(null);
          setIntent("new");
        })
        .finally(() => { if (active) setChecking(false); });
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [authState, chapterType, location, onFindMatch, organizationName]);

  useEffect(() => {
    if (match && intent === "unresolved") matchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [intent, match]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (match && intent === "unresolved") {
      event.preventDefault();
      matchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const lateMatch = await onSubmit(event);
    if (lateMatch) {
      setMatch(lateMatch);
      setIntent("unresolved");
    }
  };

  const changeType = (next: "city" | "school") => {
    setChapterType(next);
    setMatch(null);
    setIntent("new");
  };

  const changeOrganizationName = (value: string) => {
    setOrganizationName(value);
    setMatch(null);
    setIntent("new");
    setChecking(false);
  };

  const changeLocation = (value: string) => {
    setLocation(value);
    setMatch(null);
    setIntent("new");
    setChecking(false);
  };

  return <section className="form-page">
    <div className="page-heading"><span className="tiny-label">Chapter application</span><h1>Start a chapter</h1><p>Choose a city or school chapter first. We’ll check for an existing chapter so you can join the same team instead of accidentally starting a duplicate.</p></div>
    <form className="surface-form" onSubmit={handleSubmit}>
      <fieldset className="chapter-type-fieldset"><legend>What kind of chapter are you starting?</legend><div className="chapter-type-grid">
        <label className={chapterType === "school" ? "selected" : ""}><input type="radio" name="chapter_type_choice" value="school" checked={chapterType === "school"} onChange={() => changeType("school")} /><span className="type-icon" aria-hidden="true">S</span><span><strong>School chapter</strong><small>For students at one specific school.</small></span></label>
        <label className={chapterType === "city" ? "selected" : ""}><input type="radio" name="chapter_type_choice" value="city" checked={chapterType === "city"} onChange={() => changeType("city")} /><span className="type-icon" aria-hidden="true">C</span><span><strong>City chapter</strong><small>For students across the same city.</small></span></label>
      </div></fieldset>
      <input type="hidden" name="chapter_type" value={chapterType} />
      <input type="hidden" name="application_kind" value={intent === "join" ? "join_existing" : "new_chapter"} />
      <input type="hidden" name="existing_chapter_id" value={intent === "join" ? match?.id ?? "" : ""} />
      <input type="hidden" name="create_separate" value={intent === "separate" ? "true" : "false"} />

      <div className="chapter-identity"><div><span className="section-kicker">Chapter identity</span><h2>{chapterType === "school" ? "Name the school" : "Name the city team"}</h2><p>{chapterType === "school" ? "School chapters match by school name." : "City chapters match by city and state."}</p></div><div className="form-grid">
        <Field label={chapterType === "school" ? "School name" : "Chapter name"}><input name="organization_name" value={organizationName} onChange={(event) => changeOrganizationName(event.target.value)} minLength={2} maxLength={160} placeholder={chapterType === "school" ? "East Ridge High School" : "Raleigh Chapter"} required /></Field>
        <Field label="City and state" hint={checking ? "Checking for an existing chapter…" : undefined}><input name="location" value={location} onChange={(event) => changeLocation(event.target.value)} minLength={2} maxLength={160} placeholder="Raleigh, NC" required /></Field>
      </div></div>

      {match && <section ref={matchRef} className={`chapter-match ${intent === "join" || intent === "separate" ? "decided" : ""}`} aria-live="polite">
        <div className="match-marker"><Logo /></div><div className="match-copy"><span className="section-kicker">Existing {match.chapter_type} chapter found</span><h2>{match.name}</h2><p>{match.location}</p>{intent === "unresolved" ? <><strong className="match-question">Would you rather join this team?</strong><small>Joining keeps everyone from the same {match.chapter_type === "city" ? "city" : "school"} together. You can still request a separate chapter.</small></> : <strong className="match-decision">{intent === "join" ? "Your application will be a request to join this chapter." : "You’re continuing with a separate chapter application."}</strong>}</div>
        <div className="match-actions">{intent === "unresolved" ? <><Button type="button" onClick={() => setIntent("join")}>Request to join</Button><Button type="button" kind="secondary" onClick={() => setIntent("separate")}>Start separately</Button></> : <Button type="button" kind="quiet" onClick={() => setIntent("unresolved")}>Change choice</Button>}</div>
      </section>}

      <div className="form-grid">
        <Field label="Primary lead name"><input name="contact_name" minLength={2} maxLength={120} required /></Field>
        <Field label="Primary lead email"><input name="contact_email" type="email" maxLength={254} required /></Field>
        <Field label="Primary lead phone"><input name="contact_phone" type="tel" maxLength={40} required /></Field>
        <Field label="Students you plan to serve"><select name="student_reach" required defaultValue=""><option value="" disabled>Select one</option><option>K–5</option><option>Middle school</option><option>K–8</option><option>Competition math</option></select></Field>
      </div>
      <section className="people-builder"><div className="people-builder-heading"><div><h2>Additional team members</h2><p>Add co-leads, officers, or volunteers who are joining with the primary lead.</p></div><Button type="button" kind="secondary" onClick={() => setAdditionalPeople((people) => [...people, crypto.randomUUID()])}>Add another person</Button></div>{additionalPeople.length ? <div className="people-stack">{additionalPeople.map((person, index) => <div className="person-row" key={person}><div className="person-row-heading"><strong>Person {index + 2}</strong><button type="button" onClick={() => setAdditionalPeople((people) => people.filter((id) => id !== person))}>Remove</button></div><div className="form-grid four"><Field label="Full name"><input name="additional_name" minLength={2} maxLength={120} required /></Field><Field label="Email"><input name="additional_email" type="email" maxLength={254} /></Field><Field label="Phone"><input name="additional_phone" type="tel" maxLength={40} /></Field><Field label="Role"><input name="additional_role" maxLength={80} placeholder="Co-lead, volunteer…" defaultValue="Volunteer" /></Field></div></div>)}</div> : <p className="people-empty">Only one person? You can continue without adding anyone else.</p>}</section>
      <Field label={intent === "join" ? "Why do you want to join this chapter?" : "Why do you want to start this chapter?"}><textarea name="why" rows={5} maxLength={5000} required /></Field>
      {turnstileSiteKey && authState !== "ready" && <TurnstileChallenge onToken={onCaptcha} />}
      {authMessage && <p className={`access-state ${authState}`}>{authMessage}</p>}
      <div className="form-footer"><p>{intent === "join" ? "TMM will review your join request and connect you with the existing chapter." : "Applications are reviewed manually. Approved chapters receive a private access code."}</p><Button type="submit" disabled={busy || checking || authState !== "ready"}>{busy ? "Sending…" : checking ? "Checking chapter…" : authState === "loading" ? "Preparing secure form…" : intent === "join" ? "Send join request" : "Send application"}</Button></div>
    </form>
  </section>;
}

function ChapterView({ data, onReport, onToggleTask, onAddVolunteer, onUpdateVolunteer, onDeleteVolunteer, onLogout, busy }: { data: ChapterDashboardData; onReport: (event: FormEvent<HTMLFormElement>) => void; onToggleTask: (task: Task) => void; onAddVolunteer: (event: FormEvent<HTMLFormElement>) => void; onUpdateVolunteer: (volunteer: Volunteer) => void; onDeleteVolunteer: (volunteer: Volunteer) => void; onLogout: () => void; busy: boolean }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [showInactiveVolunteers, setShowInactiveVolunteers] = useState(false);
  const latest = data.reports[0];
  const current = data.reports.find((report) => report.week_start === thisMonday());
  const due = weekDueDate();
  const openTasks = orderedOpenTasks(data.tasks);
  const completedTasks = data.tasks.filter((task) => task.status === "complete");
  const activeVolunteers = data.volunteers.filter((volunteer) => volunteer.status === "active");
  const inactiveVolunteers = data.volunteers.filter((volunteer) => volunteer.status === "inactive");
  const visibleTasks = showCompleted ? [...openTasks, ...completedTasks] : openTasks;
  const visibleVolunteers = showInactiveVolunteers ? data.volunteers : activeVolunteers;
  const chapterStudents = data.reports.reduce((sum, report) => sum + report.students_served, 0);
  const chapterSessions = data.reports.reduce((sum, report) => sum + report.sessions_held, 0);
  const chapterHours = data.reports.reduce((sum, report) => sum + Number(report.instructional_hours), 0);
  const nextEvent = [...data.events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const notifications: { tone: string; label: string; title: string; detail: string; href: string }[] = [];
  notifications.push(current
    ? { tone: "success", label: "Weekly report", title: "This week is submitted", detail: `${reviewLabel(current.review_status)} · Next report is due next Sunday.`, href: "#history" }
    : { tone: "urgent", label: "Due Sunday", title: "Submit this week’s chapter report", detail: `${longDate(due)} · ${dueTiming(due)}`, href: "#weekly" });
  openTasks.slice(0, 3).forEach((task) => notifications.push({
    tone: task.priority === "high" ? "urgent" : "info",
    label: task.priority === "high" ? "High-priority assignment" : "New assignment",
    title: task.title,
    detail: task.due_date ? `Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}` : "No due date",
    href: "#tasks",
  }));
  if (current?.public_feedback) notifications.push({ tone: "info", label: "TMM feedback", title: current.review_status === "needs_follow_up" ? "Follow-up requested" : "Your report was reviewed", detail: current.public_feedback, href: "#feedback" });
  if (nextEvent) notifications.push({ tone: "neutral", label: "Upcoming event", title: nextEvent.title, detail: new Date(nextEvent.starts_at).toLocaleString(), href: "#events" });
  return <section className="workspace">
    <aside className="sidebar">
      <div><span className="tiny-label">Current chapter</span><h2>{data.chapter.name}</h2><p>{data.chapter.location}</p></div>
      <nav><a href="#home">Home</a><a href="#notifications">Notifications <b>{notifications.length}</b></a><a href="#tasks">Assignments {openTasks.length > 0 && <b>{openTasks.length}</b>}</a><a href="#events">Calendar</a><a href="#volunteers">Volunteers <b>{activeVolunteers.length}</b></a><a href="#history">Report history</a><a href="#weekly">Weekly report</a></nav>
      <button className="sidebar-action" onClick={onLogout}>Sign out chapter</button>
    </aside>
    <div className="workspace-content" id="home">
      <div className="workspace-heading command-heading"><div><span className="tiny-label">Chapter command center</span><h1>{data.chapter.name}</h1><p>Your assignments, deadlines, updates, and reporting are organized by what needs attention first.</p></div><Status value={data.chapter.status} /></div>

      <section className={`priority-board ${current ? "is-complete" : ""}`} aria-label="Most important this week">
        <div className="sunday-signal"><span>Weekly deadline</span><strong>SUN</strong><time>{due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>
        <div className="priority-copy"><span className="priority-eyebrow">{current ? "Weekly report complete" : dueTiming(due)}</span><h2>{current ? "You’re checked in for this week." : "Your weekly report is due Sunday."}</h2><p>{current ? `${reviewLabel(current.review_status)}. You can update the report until the week closes.` : "Share what your chapter accomplished, what comes next, and any support you need."}</p><a className="button primary" href={current ? "#history" : "#weekly"}>{current ? "View report status" : "Complete weekly report"}</a></div>
        <div className="priority-assignments"><div className="priority-list-heading"><span>Assigned to your chapter</span><b>{openTasks.length} open</b></div>{openTasks.length ? openTasks.slice(0, 3).map((task) => <a href="#tasks" className="priority-task" key={task.id}><span className={`priority-dot ${task.priority === "high" ? "high" : ""}`} /><span><strong>{task.title}</strong><small>{task.due_date ? `Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "No due date"}{task.priority === "high" ? " · High priority" : ""}</small></span></a>) : <p className="priority-clear">No open assignments. You’re all caught up.</p>}<a className="text-link" href="#tasks">View all assignments →</a></div>
      </section>

      <div className="metric-strip chapter-metrics">
        <div><span>Students impacted</span><strong>{chapterStudents.toLocaleString()}</strong><small>Reported by your chapter</small></div>
        <div><span>Sessions held</span><strong>{chapterSessions.toLocaleString()}</strong><small>Across all weekly reports</small></div>
        <div><span>Instructional hours</span><strong>{chapterHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><small>Direct teaching time</small></div>
        <div><span>Weekly check-in</span><strong>{current ? "Submitted" : "Due Sunday"}</strong><small>{longDate(due)}</small></div>
        <div><span>Assignments</span><strong>{openTasks.length} open</strong><small>{data.tasks.length - openTasks.length} completed</small></div>
        <div><span>Volunteer team</span><strong>{activeVolunteers.length} active</strong><small>{data.volunteers.length} total people</small></div>
      </div>

      <section className="work-section notification-center" id="notifications">
        <div className="section-title"><div><span className="section-kicker">Stay on track</span><h2>Notifications</h2><p>Important deadlines, assignments, feedback, and upcoming events in one place.</p></div><span className="notification-count">{notifications.length} active</span></div>
        <div className="notification-list">{notifications.map((item, index) => <a href={item.href} className={`notification-item ${item.tone}`} key={`${item.label}-${index}`}><span className="notification-indicator" /><span><small>{item.label}</small><strong>{item.title}</strong><p>{item.detail}</p></span><b>→</b></a>)}</div>
      </section>

      {current?.public_feedback && <div className="feedback-callout" id="feedback"><span className="tiny-label">Feedback from TMM</span><strong>{current.review_status === "needs_follow_up" ? "Follow-up requested" : "Your report was reviewed"}</strong><p>{current.public_feedback}</p></div>}

      <div className="content-grid">
        <section className="work-section assignments-section" id="tasks"><div className="section-title"><div><span className="section-kicker">Action required</span><h2>Assignments</h2><p>Open work stays visible. Finished items are tucked away automatically.</p></div><div className="section-controls"><span className="notification-count">{openTasks.length} open</span>{completedTasks.length > 0 && <button className="visibility-toggle" onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? "Hide completed" : `Show ${completedTasks.length} completed`}</button>}</div></div><div className="item-list">{visibleTasks.length ? visibleTasks.map((task) => <button className={`task-item ${task.status === "complete" ? "complete" : ""}`} onClick={() => onToggleTask(task)} key={task.id} disabled={busy}><span className="check-box">{task.status === "complete" ? "✓" : ""}</span><span><span className="task-title-line"><strong>{task.title}</strong>{task.priority === "high" && <em>High priority</em>}</span>{task.description && <p>{task.description}</p>}<small>{task.due_date ? `Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "No due date"}</small></span></button>) : <Empty text={completedTasks.length ? "All assignments are complete. Use Show completed to see them." : "No assignments right now. New work from TMM will appear here and in Notifications."} />}</div></section>
        <section className="work-section" id="events"><div className="section-title"><div><span className="section-kicker">Plan ahead</span><h2>Upcoming events</h2><p>Shared events and dates created for your chapter.</p></div></div><div className="item-list">{data.events.length ? data.events.map((event) => <div className="event-item" key={event.id}><time>{new Date(event.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><span><strong>{event.title}</strong><small>{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{event.location ? ` · ${event.location}` : ""}</small>{event.description && <p>{event.description}</p>}{event.link && <a className="text-link" href={event.link} target="_blank" rel="noreferrer">Open event link →</a>}</span></div>) : <Empty text="No upcoming events. New dates will also appear in Notifications." />}</div></section>
      </div>
      <section className="work-section volunteer-section" id="volunteers">
        <div className="section-title"><div><span className="section-kicker">People directory</span><h2>Chapter volunteers</h2><p>Active people stay visible. Inactive records are hidden until you need them.</p></div><div className="section-controls"><span className="notification-count">{activeVolunteers.length} active</span>{inactiveVolunteers.length > 0 && <button className="visibility-toggle" onClick={() => setShowInactiveVolunteers((value) => !value)}>{showInactiveVolunteers ? "Hide inactive" : `Show ${inactiveVolunteers.length} inactive`}</button>}</div></div>
        {visibleVolunteers.length ? <div className="volunteer-list">{[...visibleVolunteers].sort((a, b) => Number(a.status === "inactive") - Number(b.status === "inactive") || a.full_name.localeCompare(b.full_name)).map((volunteer) => <article className={`volunteer-row ${volunteer.status}`} key={volunteer.id}><span className="volunteer-avatar" aria-hidden="true">{volunteer.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{volunteer.full_name}</strong><small>{volunteer.role} · Joined {new Date(`${volunteer.joined_on}T12:00:00`).toLocaleDateString()}</small></div><div className="volunteer-contact">{volunteer.email ? <a href={`mailto:${volunteer.email}`}>{volunteer.email}</a> : <span>No email</span>}{volunteer.phone && <span>{volunteer.phone}</span>}</div><div className="volunteer-actions"><Status value={volunteer.status} /><Button kind="quiet" disabled={busy} onClick={() => onUpdateVolunteer(volunteer)}>{volunteer.status === "active" ? "Mark inactive" : "Reactivate"}</Button>{volunteer.role.toLowerCase() !== "chapter lead" && <Button kind="danger" disabled={busy} onClick={() => onDeleteVolunteer(volunteer)}>Delete</Button>}</div></article>)}</div> : <Empty text={inactiveVolunteers.length ? "No active volunteers. Use Show inactive to view older records." : "No volunteers have been added yet."} />}
        <details className="disclosure-form"><summary><span><strong>Add a volunteer</strong><small>Open the form only when someone joins.</small></span><b>＋</b></summary><div className="inline-form-zone"><div><span className="section-kicker">Add someone</span><h3>New volunteer</h3><p>Add each new person as they join so TMM can track chapter growth.</p></div><form className="volunteer-form" onSubmit={onAddVolunteer}><div className="form-grid four"><Field label="Full name"><input name="full_name" required /></Field><Field label="Email"><input name="email" type="email" /></Field><Field label="Phone"><input name="phone" type="tel" /></Field><Field label="Role"><input name="role" defaultValue="Volunteer" placeholder="Volunteer, mentor…" required /></Field></div><div className="form-grid"><Field label="Joined on"><input name="joined_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field><Field label="Notes"><input name="notes" placeholder="Optional skills, availability, or context" /></Field></div><div className="align-right"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add volunteer"}</Button></div></form></div></details>
      </section>
      <section className="work-section" id="history"><div className="section-title"><div><span className="section-kicker">Your record</span><h2>Report history</h2><p>Submission and review status for recent weeks. Private TMM ratings are never shown here.</p></div></div>{data.reports.length ? <div className="simple-table five"><div className="table-head"><span>Week</span><span>Sessions</span><span>Students</span><span>Tasks done</span><span>Status</span></div>{data.reports.map((report) => <div className="table-row" key={report.id}><span>{new Date(`${report.week_start}T12:00:00`).toLocaleDateString()}</span><span>{report.sessions_held}</span><span>{report.students_served}</span><span>{report.completed_weekly_tasks ? "Yes" : "No"}</span><span>{reviewLabel(report.review_status)}</span></div>)}</div> : <Empty text="No weekly reports yet. Your first report will appear here after you submit it." />}</section>

      <section className="work-section weekly-section form-zone" id="weekly">
        <div className="form-zone-heading"><div><span className="section-kicker">Weekly check-in · due every Sunday</span><h2>{current ? "Update this week’s report" : "Complete this week’s report"}</h2><p>Use this form after reviewing your assignments and chapter activity above.</p></div><div className="sunday-chip"><span>Due</span><strong>{longDate(due)}</strong><small>{dueTiming(due)}</small></div></div>
        <div className="section-title"><div><p>Tell TMM what happened, what is next, and where your chapter needs support.</p></div><div className="review-meta">{current && <span className={`review-pill ${current.review_status ?? "pending"}`}>{reviewLabel(current.review_status)}</span>}{latest && <span className="last-saved">Last saved {new Date(latest.submitted_at).toLocaleDateString()}</span>}</div></div>
        <form className="weekly-form" onSubmit={onReport}>
          <div className="form-grid four"><Field label="Week starting"><input type="date" name="week_start" defaultValue={thisMonday()} required /></Field><Field label="Sessions held"><input type="number" min="0" name="sessions_held" defaultValue={current?.sessions_held ?? 0} required /></Field><Field label="Students served"><input type="number" min="0" name="students_served" defaultValue={current?.students_served ?? 0} required /></Field><Field label="Instructional hours"><input type="number" min="0" max="1000" step="0.25" name="instructional_hours" defaultValue={current?.instructional_hours ?? 0} required /></Field></div>
          <label className="check-row"><input type="checkbox" name="completed_weekly_tasks" defaultChecked={current?.completed_weekly_tasks ?? false} /><span>We completed the required weekly tasks.</span></label>
          <div className="form-grid"><Field label="What did your chapter accomplish?"><textarea name="highlights" rows={4} defaultValue={current?.highlights ?? ""} placeholder="Sessions, outreach, curriculum work, wins…" required /></Field><Field label="What challenges came up?"><textarea name="blockers" rows={4} defaultValue={current?.blockers ?? ""} placeholder="Attendance, scheduling, materials…" /></Field><Field label="What is planned for next week?"><textarea name="next_week_plan" rows={4} defaultValue={current?.next_week_plan ?? ""} placeholder="Goals, sessions, outreach, deadlines…" required /></Field><Field label="What support do you need from TMM?"><textarea name="support_needed" rows={4} defaultValue={current?.support_needed ?? ""} placeholder="Optional — resources, advice, introductions…" /></Field></div>
          <div className="form-footer"><p>Submitting again replaces this week’s report and returns it to TMM’s review queue.</p><Button type="submit" disabled={busy}>{busy ? "Submitting…" : current ? "Update weekly report" : "Submit weekly report"}</Button></div>
        </form>
      </section>
    </div>
  </section>;
}

function AdminView({ data, ready, tab, setTab, onLogin, onAction, onLogout, issuedCode, setIssuedCode, onCaptcha, busy }: { data: AdminData; ready: boolean; tab: AdminTab; setTab: (tab: AdminTab) => void; onLogin: (event: FormEvent<HTMLFormElement>) => void; onAction: (action: string, payload: Record<string, unknown>, codeName?: string) => Promise<void>; onLogout: () => void; issuedCode: { name: string; code: string } | null; setIssuedCode: (value: { name: string; code: string } | null) => void; onCaptcha: (token: string) => void; busy: boolean }) {
  const [showClosedApplications, setShowClosedApplications] = useState(false);
  const [showCompletedAdminTasks, setShowCompletedAdminTasks] = useState(false);
  const pending = data.applications.filter((application) => application.status === "new" || application.status === "reviewing").length;
  const latestReport = useMemo(() => {
    const result = new Map<string | undefined, Report>();
    data.reports.forEach((report) => { if (!result.has(report.chapter_id)) result.set(report.chapter_id, report); });
    return result;
  }, [data.reports]);
  const reviewByReport = useMemo(() => new Map(data.reviews.map((review) => [review.report_id, review])), [data.reviews]);
  const reviewQueue = data.reports.filter((report) => (reviewByReport.get(report.id)?.status ?? "pending") === "pending");
  const followUps = data.reviews.filter((review) => review.status === "needs_follow_up").length;
  const currentWeekReportChapters = new Set(data.reports.filter((report) => report.week_start === thisMonday()).map((report) => report.chapter_id));
  const missingReports = data.chapters.filter((chapter) => chapter.status === "active" && !currentWeekReportChapters.has(chapter.id));
  const orderedReports = [...data.reports].sort((a, b) => {
    const aPending = (reviewByReport.get(a.id)?.status ?? "pending") === "pending" ? 0 : 1;
    const bPending = (reviewByReport.get(b.id)?.status ?? "pending") === "pending" ? 0 : 1;
    return aPending - bPending || b.week_start.localeCompare(a.week_start);
  });
  const adminAttention = pending + reviewQueue.length + followUps + missingReports.length;
  const openAdminTasks = orderedOpenTasks(data.tasks);
  const chapterScores = data.chapters.map((chapter) => {
    const ratings = data.reports
      .filter((report) => report.chapter_id === chapter.id)
      .map((report) => reviewByReport.get(report.id)?.rating)
      .filter((rating): rating is number => typeof rating === "number");
    return { chapter, average: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null, reviews: ratings.length };
  }).filter((item) => item.average !== null);
  const bestRated = [...chapterScores].sort((a, b) => (b.average ?? 0) - (a.average ?? 0)).slice(0, 3);
  const needsSupport = [...chapterScores].sort((a, b) => (a.average ?? 0) - (b.average ?? 0)).slice(0, 3);
  const mostEvents = data.chapters.map((chapter) => ({ chapter, count: data.events.filter((event) => event.chapter_id === chapter.id).length })).sort((a, b) => b.count - a.count).slice(0, 3);
  const pendingApplications = data.applications.filter((application) => application.status === "new" || application.status === "reviewing");
  const closedApplications = data.applications.filter((application) => application.status === "approved" || application.status === "declined");
  const visibleApplications = showClosedApplications ? data.applications : pendingApplications;
  const completedAdminTasks = data.tasks.filter((task) => task.status === "complete");
  const visibleAdminTasks = showCompletedAdminTasks ? data.tasks : openAdminTasks;
  const nationalBaseline = data.nationalImpact ?? foundingImpact;
  if (!ready) return <section className="access-shell"><div className="access-card"><div className="card-heading"><span className="tiny-label">Admin access</span><h1>Enter admin code</h1><p>Use the secure 6-digit administrator access code.</p></div><form className="stack-form" onSubmit={onLogin}><Field label="6-digit admin code"><input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="••••••" required /></Field>{turnstileSiteKey && <TurnstileChallenge onToken={onCaptcha} />}<Button type="submit" disabled={busy}>{busy ? "Checking…" : "Open admin dashboard"}</Button></form></div></section>;

  const submitChapter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onAction("admin-create-chapter", { chapter: Object.fromEntries(form) }, String(form.get("name") ?? "Chapter"));
    event.currentTarget.reset();
  };
  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onAction("admin-assign-task", { task: Object.fromEntries(new FormData(event.currentTarget)) });
    event.currentTarget.reset();
  };
  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onAction("admin-create-event", { event: Object.fromEntries(new FormData(event.currentTarget)) });
    event.currentTarget.reset();
  };
  const exportReviews = () => {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["Chapter", "Week", "Submitted", "Sessions", "Students", "Instructional hours", "Tasks complete", "Review status", "Private rating", "Private notes", "Public feedback"];
    const rows = data.reports.map((report) => {
      const chapter = data.chapters.find((item) => item.id === report.chapter_id);
      const review = reviewByReport.get(report.id);
      return [chapter?.name, report.week_start, report.submitted_at, report.sessions_held, report.students_served, report.instructional_hours, report.completed_weekly_tasks ? "Yes" : "No", review?.status ?? "pending", review?.rating ?? "", review?.private_notes ?? "", review?.public_feedback ?? ""];
    });
    const blob = new Blob([[header, ...rows].map((row) => row.map(quote).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tmm-weekly-reviews-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <section className="admin-layout">
    <aside className="admin-sidebar"><div><span className="tiny-label">Administration</span><h2>Chapter operations</h2><p>Weekly deadline: Sunday</p></div><nav><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Home {adminAttention > 0 && <b>{adminAttention}</b>}</button><button className={tab === "applications" ? "active" : ""} onClick={() => setTab("applications")}>Applications {pending > 0 && <b>{pending}</b>}</button><button className={tab === "reviews" ? "active" : ""} onClick={() => setTab("reviews")}>Weekly reviews {reviewQueue.length > 0 && <b>{reviewQueue.length}</b>}</button><button className={tab === "chapters" ? "active" : ""} onClick={() => setTab("chapters")}>Chapters</button><button className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}>Assignments & events</button></nav><button className="sidebar-action" onClick={onLogout}>Sign out admin</button></aside>
    <div className="admin-content">
      <div className="workspace-heading command-heading"><div><span className="tiny-label">Admin command center</span><h1>{tab === "overview" ? "Today’s priorities" : tab === "applications" ? "Applications" : tab === "reviews" ? "Weekly reviews" : tab === "chapters" ? "Chapters" : "Assignments & events"}</h1><p>{tab === "overview" ? "The work that needs attention is collected here. Detailed tools stay one click away." : "Use the sections below to review details and make changes."}</p></div></div>
      {issuedCode && <div className="code-result"><div><span className="tiny-label">New chapter code · shown once</span><strong>{issuedCode.name}</strong><code>{issuedCode.code}</code></div><div><Button kind="secondary" onClick={() => navigator.clipboard.writeText(issuedCode.code)}>Copy code</Button><Button kind="quiet" onClick={() => setIssuedCode(null)}>Dismiss</Button></div></div>}

      {tab === "overview" && <>
        <div className="admin-deadline-line"><span>Weekly reports are due every Sunday</span><strong>{currentWeekReportChapters.size}/{data.chapters.filter((chapter) => chapter.status === "active").length} submitted</strong><small>{longDate(weekDueDate())} · {dueTiming(weekDueDate())}</small></div>
        <section className="impact-panel" aria-label="Our impact"><div className="impact-heading"><div><span className="section-kicker">{nationalBaseline.name} · founding baseline</span><h2>Our impact</h2></div><small>Verified totals from the work completed so far.</small></div><div className="impact-grid"><div><strong>{nationalBaseline.students_taught.toLocaleString()}{nationalBaseline.students_taught_is_minimum ? "+" : ""}</strong><span>Students taught</span></div><div><strong>{nationalBaseline.instructional_hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span>Instructional hours</span></div><div><strong>{nationalBaseline.volunteer_count.toLocaleString()}</strong><span>Volunteers</span></div><div><strong>{nationalBaseline.session_count.toLocaleString()}</strong><span>Sessions held</span></div><div><strong>{nationalBaseline.chapter_count.toLocaleString()}</strong><span>National chapter</span></div></div></section>
        <div className="admin-focus-grid">
          <button className={missingReports.length ? "urgent" : "clear"} onClick={() => setTab("reviews")}><span>Missing reports</span><strong>{missingReports.length}</strong><small>Due Sunday</small></button>
          <button onClick={() => setTab("reviews")}><span>Awaiting review</span><strong>{reviewQueue.length}</strong><small>{followUps} need follow-up</small></button>
          <button onClick={() => setTab("applications")}><span>Applications</span><strong>{pending}</strong><small>Need a decision</small></button>
          <button onClick={() => setTab("work")}><span>Open assignments</span><strong>{openAdminTasks.length}</strong><small>All marked high priority</small></button>
        </div>
        <details className="dashboard-disclosure"><summary><span><strong>Chapter performance</strong><small>Ratings, support needs, event activity, and intake</small></span><b>Show details</b></summary><div className="admin-ranking-grid">
          <section className="ranking-card best"><div className="ranking-heading"><span>Performance</span><h2>Best rated chapters</h2></div>{bestRated.length ? <div className="ranking-list">{bestRated.map((item, index) => <div key={item.chapter.id}><b>{index + 1}</b><span><strong>{item.chapter.name}</strong><small>{item.reviews} reviewed report{item.reviews === 1 ? "" : "s"}</small></span><em>{item.average?.toFixed(1)}</em></div>)}</div> : <Empty text="Ratings will appear after reports are reviewed." />}</section>
          <section className="ranking-card support"><div className="ranking-heading"><span>Coaching</span><h2>Chapters needing support</h2></div>{needsSupport.length ? <div className="ranking-list">{needsSupport.map((item, index) => <div key={item.chapter.id}><b>{index + 1}</b><span><strong>{item.chapter.name}</strong><small>{item.reviews} reviewed report{item.reviews === 1 ? "" : "s"}</small></span><em>{item.average?.toFixed(1)}</em></div>)}</div> : <Empty text="Ratings will appear after reports are reviewed." />}</section>
          <section className="ranking-card"><div className="ranking-heading"><span>Activity</span><h2>Chapters with most events</h2></div>{mostEvents.some((item) => item.count > 0) ? <div className="ranking-list">{mostEvents.filter((item) => item.count > 0).map((item, index) => <div key={item.chapter.id}><b>{index + 1}</b><span><strong>{item.chapter.name}</strong><small>Chapter-specific events</small></span><em>{item.count}</em></div>)}</div> : <Empty text="Chapter event activity will appear here." />}</section>
          <section className="ranking-card applications-summary"><div className="ranking-heading"><span>Intake</span><h2>Applications</h2><Button kind="quiet" onClick={() => setTab("applications")}>View all</Button></div>{pendingApplications.length ? <div className="ranking-list">{pendingApplications.slice(0, 3).map((application, index) => <div key={application.id}><b>{index + 1}</b><span><strong>{application.organization_name}</strong><small>{application.location} · {(application.additional_contacts?.length ?? 0) + 1} team member{(application.additional_contacts?.length ?? 0) === 0 ? "" : "s"}</small></span><Status value={application.status} /></div>)}</div> : <Empty text="No applications are waiting." />}</section>
        </div></details>
      </>}

      {tab === "applications" && <section className="admin-section">
        <div className="section-title"><div><h2>Chapter applications</h2><p>New chapter applications and requests to join existing teams are reviewed here.</p></div>{closedApplications.length > 0 && <button className="visibility-toggle" onClick={() => setShowClosedApplications((value) => !value)}>{showClosedApplications ? "Hide closed" : `Show ${closedApplications.length} closed`}</button>}</div>
        <div className="application-list">{visibleApplications.length ? visibleApplications.map((application) => {
          const joinChapter = application.existing_chapter_id ? data.chapters.find((chapter) => chapter.id === application.existing_chapter_id) : undefined;
          const isJoin = application.application_kind === "join_existing";
          return <article className={`application-card ${isJoin ? "join-request" : ""}`} key={application.id}>
            <div className="application-top"><div><span className="application-kind">{isJoin ? "Join request" : `${application.chapter_type === "city" ? "City" : "School"} chapter`}</span><strong>{isJoin ? joinChapter?.name ?? application.organization_name : application.organization_name}</strong><span>{application.location}</span></div><Status value={application.status} /></div>
            <div className="application-meta"><span>Applicant: {application.contact_name}</span><a href={`mailto:${application.contact_email}`}>{application.contact_email}</a>{application.contact_phone && <a href={`tel:${application.contact_phone}`}>{application.contact_phone}</a>}<span>{new Date(application.created_at).toLocaleDateString()}</span></div>
            {isJoin && <div className="join-target"><span>Existing chapter</span><strong>{joinChapter?.name ?? "Chapter unavailable"}</strong><small>{joinChapter?.location ?? "The selected chapter could not be found."}</small></div>}
            {application.additional_contacts?.length ? <div className="applicant-team"><span className="section-kicker">Additional team members</span>{application.additional_contacts.map((contact, index) => <div key={`${contact.email}-${index}`}><strong>{contact.full_name}</strong><span>{contact.role || "Volunteer"}</span>{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}{contact.phone && <span>{contact.phone}</span>}</div>)}</div> : null}
            {application.why && <p>{application.why}</p>}
            <div className="row-actions">{application.status !== "approved" && <Button disabled={busy} onClick={() => onAction("admin-approve-application", { application_id: application.id }, application.organization_name)}>{isJoin ? "Approve & add to chapter" : "Approve & create code"}</Button>}{application.status !== "declined" && application.status !== "approved" && <Button kind="danger" disabled={busy} onClick={() => onAction("admin-update-application", { application_id: application.id, status: "declined" })}>Reject</Button>}{application.status === "declined" && <Button kind="danger" disabled={busy} onClick={() => window.confirm(`Permanently delete the declined application from ${application.organization_name}?`) && onAction("admin-delete-application", { application_id: application.id })}>Delete</Button>}</div>
          </article>;
        }) : <Empty text={closedApplications.length ? "No applications need a decision. Use Show closed to view older records." : "No applications yet."} />}</div>
      </section>}

      {tab === "reviews" && <>
        <div className="metric-strip admin-metrics">
          <div><span>Submitted this week</span><strong>{currentWeekReportChapters.size}</strong><small>of {data.chapters.filter((chapter) => chapter.status === "active").length} active chapters</small></div>
          <div><span>Awaiting review</span><strong>{reviewQueue.length}</strong><small>Private ratings not yet saved</small></div>
          <div><span>Follow-up needed</span><strong>{followUps}</strong><small>Flagged by your team</small></div>
          <div><span>Missing this week</span><strong>{missingReports.length}</strong><small>Reminder-ready</small></div>
        </div>
        <section className="admin-section">
          <div className="section-title"><div><h2>Missing weekly reports</h2><p>Active chapters without a report for the week of {new Date(`${thisMonday()}T12:00:00`).toLocaleDateString()}.</p></div></div>
          {missingReports.length ? <div className="missing-list">{missingReports.map((chapter) => <div key={chapter.id}><span><strong>{chapter.name}</strong><small>{chapter.contact_name} · {chapter.contact_email}</small></span><a className="button secondary" href={`mailto:${chapter.contact_email}?subject=${encodeURIComponent("TMM weekly report reminder")}&body=${encodeURIComponent(`Hi ${chapter.contact_name},\n\nYour TMM chapter weekly report for the week of ${new Date(`${thisMonday()}T12:00:00`).toLocaleDateString()} is still due. Please sign in to the chapter portal and submit it by ${weekDueDate().toLocaleDateString()}.\n\nThank you!`)}`}>Email reminder</a></div>)}</div> : <Empty text="Every active chapter has submitted this week." />}
        </section>
        <section className="admin-section">
          <div className="section-title"><div><h2>Review queue</h2><p>Ratings and internal notes are visible only to administrators. Public feedback is shown to the matching chapter.</p></div><Button kind="secondary" onClick={exportReviews}>Export CSV</Button></div>
          <div className="review-list">{orderedReports.length ? orderedReports.map((report) => <ReviewCard key={report.id} report={report} review={reviewByReport.get(report.id)} chapter={data.chapters.find((chapter) => chapter.id === report.chapter_id)} onAction={onAction} busy={busy} />) : <Empty text="No weekly reports have been submitted yet." />}</div>
        </section>
      </>}

      {tab === "chapters" && <>
        <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Network directory</span><h2>All chapters</h2><p>Contacts, volunteers, weekly reporting status, and secure code management.</p></div></div>{data.chapters.length ? <div className="chapter-list">{data.chapters.map((chapter) => { const report = latestReport.get(chapter.id); const volunteers = data.volunteers.filter((volunteer) => volunteer.chapter_id === chapter.id && volunteer.status === "active").length; return <article className="chapter-row" key={chapter.id}><div><strong>{chapter.name}</strong><span>{chapter.chapter_type === "city" ? "City chapter" : "School chapter"} · {chapter.location} · {volunteers} active volunteer{volunteers === 1 ? "" : "s"}</span></div><div><span>{chapter.contact_name}</span><a href={`mailto:${chapter.contact_email}`}>{chapter.contact_email}</a>{chapter.contact_phone && <span>{chapter.contact_phone}</span>}</div><div><span>Latest report</span><strong className="plain-strong">{report ? new Date(`${report.week_start}T12:00:00`).toLocaleDateString() : "Not submitted"}</strong></div><div className="chapter-row-end"><Status value={chapter.status} /><span className="code-hint">Code ends •{chapter.access_code_hint ?? "—"}</span><Button kind="secondary" disabled={busy} onClick={() => onAction("admin-reset-code", { chapter_id: chapter.id }, chapter.name)}>Reset code</Button></div></article>; })}</div> : <Empty text="No chapters have been added." />}</section>
        <details className="admin-section disclosure-form form-zone"><summary><span><strong>Add a chapter manually</strong><small>Open only when you need to create a chapter without an application.</small></span><b>＋</b></summary><form className="surface-form compact disclosure-content" onSubmit={submitChapter}><div className="form-grid three"><Field label="Chapter type"><select name="chapter_type" defaultValue="school" required><option value="school">School chapter</option><option value="city">City chapter</option></select></Field><Field label="Chapter name"><input name="name" required /></Field><Field label="City and state"><input name="location" required /></Field><Field label="Lead name"><input name="contact_name" required /></Field><Field label="Lead email"><input name="contact_email" type="email" required /></Field><Field label="Lead phone"><input name="contact_phone" type="tel" /></Field><Field label="Custom 6-digit code" hint="Optional · exactly 6 digits"><input name="code" className="code-input small" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} /></Field><Field label="Advisor name"><input name="advisor_name" /></Field><Field label="Advisor email"><input name="advisor_email" type="email" /></Field></div><div className="align-right"><Button type="submit" disabled={busy}>Add chapter</Button></div></form></details>
      </>}

      {tab === "work" && <>
        <div className="admin-two-column">
          <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Assigned work</span><h2>Chapter assignments</h2><p>Completed assignments are hidden by default.</p></div><div className="section-controls"><span className="notification-count">{openAdminTasks.length} open</span>{completedAdminTasks.length > 0 && <button className="visibility-toggle" onClick={() => setShowCompletedAdminTasks((value) => !value)}>{showCompletedAdminTasks ? "Hide completed" : `Show ${completedAdminTasks.length} completed`}</button>}</div></div><div className="admin-item-list home-list">{visibleAdminTasks.length ? [...visibleAdminTasks].sort((a, b) => Number(a.status === "complete") - Number(b.status === "complete") || Number(b.priority === "high") - Number(a.priority === "high")).slice(0, 20).map((task) => <div key={task.id}><span><strong>{task.title}</strong><small>{data.chapters.find((chapter) => chapter.id === task.assigned_chapter_id)?.name ?? "Chapter"}{task.due_date ? ` · Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}` : ""}</small></span><span className="admin-row-actions"><Status value={task.priority === "high" && task.status !== "complete" ? "high" : task.status} /><Button kind="danger" disabled={busy} onClick={() => window.confirm(`Delete assignment “${task.title}”?`) && onAction("admin-delete-task", { task_id: task.id })}>Delete</Button></span></div>) : <Empty text={completedAdminTasks.length ? "No open assignments. Use Show completed to see finished work." : "No assignments have been created."} />}</div></section>
          <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Network calendar</span><h2>Upcoming events</h2><p>Shared dates and chapter-specific events.</p></div></div><div className="admin-item-list home-list">{data.events.length ? data.events.slice(0, 20).map((event) => <div key={event.id}><span><strong>{event.title}</strong><small>{new Date(event.starts_at).toLocaleString()}{event.location ? ` · ${event.location}` : ""}</small></span><span className="admin-row-actions">{event.chapter_id ? <Status value="chapter" /> : <Status value="all chapters" />}<Button kind="danger" disabled={busy} onClick={() => window.confirm(`Delete event “${event.title}”?`) && onAction("admin-delete-event", { event_id: event.id })}>Delete</Button></span></div>) : <Empty text="No upcoming events have been created." />}</div></section>
        </div>
        <div className="admin-two-column form-zone-grid">
          <details className="admin-section disclosure-form form-zone"><summary><span><strong>Assign a high-priority task</strong><small>Open the task form</small></span><b>＋</b></summary><form className="surface-form compact disclosure-content" onSubmit={submitTask}><Field label="Task"><input name="title" required /></Field><Field label="Chapter"><select name="chapter_id" required defaultValue=""><option value="" disabled>Select a chapter</option>{data.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></Field><Field label="Due date"><input name="due_date" type="date" /></Field><Field label="Details"><textarea name="description" rows={3} /></Field><Button type="submit" disabled={busy}>Assign high-priority task</Button></form></details>
          <details className="admin-section disclosure-form form-zone"><summary><span><strong>Create an event</strong><small>Open the event form</small></span><b>＋</b></summary><form className="surface-form compact disclosure-content" onSubmit={submitEvent}><Field label="Event"><input name="title" required /></Field><Field label="Chapter"><select name="chapter_id" defaultValue=""><option value="">All chapters</option>{data.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></Field><div className="form-grid"><Field label="Starts"><input name="starts_at" type="datetime-local" required /></Field><Field label="Ends"><input name="ends_at" type="datetime-local" /></Field></div><Field label="Location"><input name="location" /></Field><Field label="Link"><input name="link" type="url" /></Field><Field label="Details"><textarea name="description" rows={3} /></Field><Button type="submit" disabled={busy}>Create event</Button></form></details>
        </div>
      </>}
    </div>
  </section>;
}

function ReviewCard({ report, review, chapter, onAction, busy }: { report: Report; review?: ReportReview; chapter?: Chapter; onAction: (action: string, payload: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onAction("admin-review-report", {
      review: {
        report_id: report.id,
        rating: Number(form.get("rating")),
        status: String(form.get("status") ?? "reviewed"),
        private_notes: String(form.get("private_notes") ?? ""),
        public_feedback: String(form.get("public_feedback") ?? ""),
      },
    });
  };
  return <article className={`review-card ${review?.status ?? "pending"}`}>
    <div className="review-card-heading">
      <div><span className="tiny-label">Week of {new Date(`${report.week_start}T12:00:00`).toLocaleDateString()}</span><h3>{chapter?.name ?? "Chapter"}</h3><p>Submitted {new Date(report.submitted_at).toLocaleString()}</p></div>
      <span className={`review-pill ${review?.status ?? "pending"}`}>{reviewLabel(review?.status)}</span>
    </div>
    <div className="report-stats"><span><strong>{report.sessions_held}</strong> sessions</span><span><strong>{report.students_served}</strong> students</span><span><strong>{Number(report.instructional_hours).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> instruction hours</span><span><strong>{report.completed_weekly_tasks ? "Yes" : "No"}</strong> tasks done</span></div>
    <div className="report-narrative">
      <div><span>Accomplishments</span><p>{report.highlights || "Nothing entered."}</p></div>
      <div><span>Challenges</span><p>{report.blockers || "Nothing entered."}</p></div>
      <div><span>Next week</span><p>{report.next_week_plan || "Nothing entered."}</p></div>
      <div><span>Support requested</span><p>{report.support_needed || "Nothing entered."}</p></div>
    </div>
    <form className="review-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Private rating" hint="1 = needs major support · 5 = excellent"><select name="rating" defaultValue={String(review?.rating ?? "")} required><option value="" disabled>Select 1–5</option><option value="1">1 — Needs major support</option><option value="2">2 — Below expectations</option><option value="3">3 — Meeting expectations</option><option value="4">4 — Strong</option><option value="5">5 — Excellent</option></select></Field>
        <Field label="Review outcome"><select name="status" defaultValue={review?.status === "needs_follow_up" ? "needs_follow_up" : "reviewed"}><option value="reviewed">Reviewed</option><option value="needs_follow_up">Needs follow-up</option></select></Field>
        <Field label="Private admin notes" hint="Never shown to the chapter"><textarea name="private_notes" rows={4} defaultValue={review?.private_notes ?? ""} placeholder="Internal observations, concerns, coaching notes…" /></Field>
        <Field label="Feedback for the chapter" hint="Shown in their dashboard"><textarea name="public_feedback" rows={4} defaultValue={review?.public_feedback ?? ""} placeholder="Optional encouragement or next steps…" /></Field>
      </div>
      <div className="form-footer"><p>{review?.reviewed_at ? `Last reviewed ${new Date(review.reviewed_at).toLocaleString()}` : "This report has not been rated yet."}</p><Button type="submit" disabled={busy}>{busy ? "Saving…" : review?.reviewed_at ? "Update review" : "Save private review"}</Button></div>
    </form>
  </article>;
}

function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
