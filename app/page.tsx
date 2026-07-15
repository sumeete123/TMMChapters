"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type View = "access" | "apply" | "chapter" | "admin";
type Theme = "light" | "dark";
type AdminTab = "overview" | "applications" | "reviews" | "chapters" | "work";
type AuthState = "loading" | "ready" | "error";

type Chapter = {
  id: string;
  name: string;
  location: string;
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
  mentors_present: number;
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
  organization_name: string;
  location: string;
  student_reach?: string | null;
  why?: string | null;
  status: string;
  created_at: string;
};

type ChapterDashboardData = { chapter: Chapter; tasks: Task[]; events: ChapterEvent[]; reports: Report[] };
type AdminData = { applications: Application[]; chapters: Chapter[]; reports: Report[]; reviews: ReportReview[]; tasks: Task[]; events: ChapterEvent[] };
type AdminActionResult = Partial<AdminData> & { code?: string; chapter?: Chapter; overview?: AdminData };

const emptyAdmin: AdminData = { applications: [], chapters: [], reports: [], reviews: [], tasks: [], events: [] };
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
  if (current.session) return current.session;
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

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return setMessage("The application form is not connected yet.");
    const formElement = event.currentTarget;
    setBusy(true);
    const form = new FormData(formElement);
    const payload = {
      contact_name: String(form.get("contact_name") ?? ""),
      contact_email: String(form.get("contact_email") ?? ""),
      contact_phone: String(form.get("contact_phone") ?? ""),
      organization_name: String(form.get("organization_name") ?? ""),
      location: String(form.get("location") ?? ""),
      student_reach: String(form.get("student_reach") ?? ""),
      why: String(form.get("why") ?? ""),
    };
    try {
      const { error } = await supabase.from("chapter_applications").insert(payload);
      if (error) throw error;
      formElement.reset();
      goTo("access");
      setMessage("Application sent. We’ll review it and contact you by email.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn’t send your application. Please try again.");
    } finally {
      setBusy(false);
    }
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
        mentors_present: Number(form.get("mentors_present") ?? 0),
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

    {view === "access" && <AccessView onLogin={chapterLogin} busy={busy} authState={authState} authMessage={authMessage} onCaptcha={setCaptchaToken} goTo={goTo} />}
    {view === "apply" && <ApplicationView onSubmit={submitApplication} busy={busy} />}
    {view === "chapter" && dashboard && <ChapterView data={dashboard} onReport={submitReport} onToggleTask={toggleTask} onLogout={chapterLogout} busy={busy} />}
    {view === "admin" && <AdminView data={adminData} ready={adminReady} tab={adminTab} setTab={setAdminTab} onLogin={adminLogin} onAction={adminAction} onLogout={adminLogout} issuedCode={issuedCode} setIssuedCode={setIssuedCode} onCaptcha={setCaptchaToken} busy={busy} />}
  </main>;
}

function AccessView({ onLogin, busy, authState, authMessage, onCaptcha, goTo }: { onLogin: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; authState: AuthState; authMessage: string; onCaptcha: (token: string) => void; goTo: (view: View) => void }) {
  return <section className="access-shell">
    <div className="access-card">
      <div className="card-heading"><span className="tiny-label">Chapter access</span><h1>Enter your chapter code</h1><p>Use the code provided when your chapter was approved.</p></div>
      <form onSubmit={onLogin} className="stack-form">
        <Field label="6-digit chapter code"><input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="••••••" required /></Field>
        {turnstileSiteKey && authState !== "ready" && <TurnstileChallenge onToken={onCaptcha} />}
        {authMessage && <p className={`access-state ${authState}`}>{authMessage}</p>}
        <Button type="submit" disabled={busy || authState !== "ready"}>{busy ? "Checking…" : authState === "loading" ? "Preparing secure access…" : "Open chapter dashboard"}</Button>
      </form>
      <div className="access-help"><span>Don’t have a code?</span><button onClick={() => goTo("apply")}>Apply to start a chapter</button></div>
    </div>
    <button className="admin-entry" onClick={() => goTo("admin")}>Admin sign in</button>
  </section>;
}

function ApplicationView({ onSubmit, busy }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <section className="form-page">
    <div className="page-heading"><span className="tiny-label">Chapter application</span><h1>Start a chapter</h1><p>Tell us who will lead it and where it will operate. We’ll review the application before issuing a chapter code.</p></div>
    <form className="surface-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Lead name"><input name="contact_name" required /></Field>
        <Field label="Lead email"><input name="contact_email" type="email" required /></Field>
        <Field label="Phone"><input name="contact_phone" type="tel" required /></Field>
        <Field label="School or organization"><input name="organization_name" required /></Field>
        <Field label="City and state"><input name="location" placeholder="Raleigh, NC" required /></Field>
        <Field label="Students you plan to serve"><select name="student_reach" required defaultValue=""><option value="" disabled>Select one</option><option>K–5</option><option>Middle school</option><option>K–8</option><option>Competition math</option></select></Field>
      </div>
      <Field label="Why do you want to start this chapter?"><textarea name="why" rows={5} required /></Field>
      <div className="form-footer"><p>Applications are reviewed manually. Approved chapters receive a private access code.</p><Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send application"}</Button></div>
    </form>
  </section>;
}

function ChapterView({ data, onReport, onToggleTask, onLogout, busy }: { data: ChapterDashboardData; onReport: (event: FormEvent<HTMLFormElement>) => void; onToggleTask: (task: Task) => void; onLogout: () => void; busy: boolean }) {
  const latest = data.reports[0];
  const current = data.reports.find((report) => report.week_start === thisMonday());
  const due = weekDueDate();
  const openTasks = orderedOpenTasks(data.tasks);
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
      <nav><a href="#home">Home</a><a href="#notifications">Notifications <b>{notifications.length}</b></a><a href="#tasks">Assignments {openTasks.length > 0 && <b>{openTasks.length}</b>}</a><a href="#events">Calendar</a><a href="#history">Report history</a><a href="#weekly">Weekly report</a></nav>
      <button className="sidebar-action" onClick={onLogout}>Sign out chapter</button>
    </aside>
    <div className="workspace-content" id="home">
      <div className="workspace-heading command-heading"><div><span className="tiny-label">Chapter command center</span><h1>{data.chapter.name}</h1><p>Your assignments, deadlines, updates, and reporting are organized by what needs attention first.</p></div><Status value={data.chapter.status} /></div>

      <section className={`priority-board ${current ? "is-complete" : ""}`} aria-label="Most important this week">
        <div className="sunday-signal"><span>Weekly deadline</span><strong>SUN</strong><time>{due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>
        <div className="priority-copy"><span className="priority-eyebrow">{current ? "Weekly report complete" : dueTiming(due)}</span><h2>{current ? "You’re checked in for this week." : "Your weekly report is due Sunday."}</h2><p>{current ? `${reviewLabel(current.review_status)}. You can update the report until the week closes.` : "Share what your chapter accomplished, what comes next, and any support you need."}</p><a className="button primary" href={current ? "#history" : "#weekly"}>{current ? "View report status" : "Complete weekly report"}</a></div>
        <div className="priority-assignments"><div className="priority-list-heading"><span>Assigned to your chapter</span><b>{openTasks.length} open</b></div>{openTasks.length ? openTasks.slice(0, 3).map((task) => <a href="#tasks" className="priority-task" key={task.id}><span className={`priority-dot ${task.priority === "high" ? "high" : ""}`} /><span><strong>{task.title}</strong><small>{task.due_date ? `Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "No due date"}{task.priority === "high" ? " · High priority" : ""}</small></span></a>) : <p className="priority-clear">No open assignments. You’re all caught up.</p>}<a className="text-link" href="#tasks">View all assignments →</a></div>
      </section>

      <div className="metric-strip">
        <div><span>Weekly check-in</span><strong>{current ? "Submitted" : "Due Sunday"}</strong><small>{longDate(due)}</small></div>
        <div><span>TMM review</span><strong>{current ? reviewLabel(current.review_status) : "Starts after submission"}</strong><small>Private ratings stay with TMM</small></div>
        <div><span>Assignments</span><strong>{openTasks.length} open</strong><small>{data.tasks.length - openTasks.length} completed</small></div>
      </div>

      <section className="work-section notification-center" id="notifications">
        <div className="section-title"><div><span className="section-kicker">Stay on track</span><h2>Notifications</h2><p>Important deadlines, assignments, feedback, and upcoming events in one place.</p></div><span className="notification-count">{notifications.length} active</span></div>
        <div className="notification-list">{notifications.map((item, index) => <a href={item.href} className={`notification-item ${item.tone}`} key={`${item.label}-${index}`}><span className="notification-indicator" /><span><small>{item.label}</small><strong>{item.title}</strong><p>{item.detail}</p></span><b>→</b></a>)}</div>
      </section>

      {current?.public_feedback && <div className="feedback-callout" id="feedback"><span className="tiny-label">Feedback from TMM</span><strong>{current.review_status === "needs_follow_up" ? "Follow-up requested" : "Your report was reviewed"}</strong><p>{current.public_feedback}</p></div>}

      <div className="content-grid">
        <section className="work-section assignments-section" id="tasks"><div className="section-title"><div><span className="section-kicker">Action required</span><h2>Assignments</h2><p>High-priority and nearest-due work appears first. Check an item when it is finished.</p></div><span className="notification-count">{openTasks.length} open</span></div><div className="item-list">{data.tasks.length ? [...data.tasks].sort((a, b) => Number(a.status === "complete") - Number(b.status === "complete") || Number(b.priority === "high") - Number(a.priority === "high") || (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")).map((task) => <button className={`task-item ${task.status === "complete" ? "complete" : ""}`} onClick={() => onToggleTask(task)} key={task.id} disabled={busy}><span className="check-box">{task.status === "complete" ? "✓" : ""}</span><span><span className="task-title-line"><strong>{task.title}</strong>{task.priority === "high" && <em>High priority</em>}</span>{task.description && <p>{task.description}</p>}<small>{task.due_date ? `Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "No due date"}</small></span></button>) : <Empty text="No assignments right now. New work from TMM will appear here and in Notifications." />}</div></section>
        <section className="work-section" id="events"><div className="section-title"><div><span className="section-kicker">Plan ahead</span><h2>Upcoming events</h2><p>Shared events and dates created for your chapter.</p></div></div><div className="item-list">{data.events.length ? data.events.map((event) => <div className="event-item" key={event.id}><time>{new Date(event.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><span><strong>{event.title}</strong><small>{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{event.location ? ` · ${event.location}` : ""}</small>{event.description && <p>{event.description}</p>}{event.link && <a className="text-link" href={event.link} target="_blank" rel="noreferrer">Open event link →</a>}</span></div>) : <Empty text="No upcoming events. New dates will also appear in Notifications." />}</div></section>
      </div>
      <section className="work-section" id="history"><div className="section-title"><div><span className="section-kicker">Your record</span><h2>Report history</h2><p>Submission and review status for recent weeks. Private TMM ratings are never shown here.</p></div></div>{data.reports.length ? <div className="simple-table five"><div className="table-head"><span>Week</span><span>Sessions</span><span>Students</span><span>Tasks done</span><span>Status</span></div>{data.reports.map((report) => <div className="table-row" key={report.id}><span>{new Date(`${report.week_start}T12:00:00`).toLocaleDateString()}</span><span>{report.sessions_held}</span><span>{report.students_served}</span><span>{report.completed_weekly_tasks ? "Yes" : "No"}</span><span>{reviewLabel(report.review_status)}</span></div>)}</div> : <Empty text="No weekly reports yet. Your first report will appear here after you submit it." />}</section>

      <section className="work-section weekly-section form-zone" id="weekly">
        <div className="form-zone-heading"><div><span className="section-kicker">Weekly check-in · due every Sunday</span><h2>{current ? "Update this week’s report" : "Complete this week’s report"}</h2><p>Use this form after reviewing your assignments and chapter activity above.</p></div><div className="sunday-chip"><span>Due</span><strong>{longDate(due)}</strong><small>{dueTiming(due)}</small></div></div>
        <div className="section-title"><div><p>Tell TMM what happened, what is next, and where your chapter needs support.</p></div><div className="review-meta">{current && <span className={`review-pill ${current.review_status ?? "pending"}`}>{reviewLabel(current.review_status)}</span>}{latest && <span className="last-saved">Last saved {new Date(latest.submitted_at).toLocaleDateString()}</span>}</div></div>
        <form className="weekly-form" onSubmit={onReport}>
          <div className="form-grid four"><Field label="Week starting"><input type="date" name="week_start" defaultValue={thisMonday()} required /></Field><Field label="Sessions held"><input type="number" min="0" name="sessions_held" defaultValue={current?.sessions_held ?? 0} required /></Field><Field label="Students served"><input type="number" min="0" name="students_served" defaultValue={current?.students_served ?? 0} required /></Field><Field label="Mentors present"><input type="number" min="0" name="mentors_present" defaultValue={current?.mentors_present ?? 0} required /></Field></div>
          <label className="check-row"><input type="checkbox" name="completed_weekly_tasks" defaultChecked={current?.completed_weekly_tasks ?? false} /><span>We completed the required weekly tasks.</span></label>
          <div className="form-grid"><Field label="What did your chapter accomplish?"><textarea name="highlights" rows={4} defaultValue={current?.highlights ?? ""} placeholder="Sessions, outreach, curriculum work, wins…" required /></Field><Field label="What challenges came up?"><textarea name="blockers" rows={4} defaultValue={current?.blockers ?? ""} placeholder="Attendance, scheduling, materials…" /></Field><Field label="What is planned for next week?"><textarea name="next_week_plan" rows={4} defaultValue={current?.next_week_plan ?? ""} placeholder="Goals, sessions, outreach, deadlines…" required /></Field><Field label="What support do you need from TMM?"><textarea name="support_needed" rows={4} defaultValue={current?.support_needed ?? ""} placeholder="Optional — resources, advice, introductions…" /></Field></div>
          <div className="form-footer"><p>Submitting again replaces this week’s report and returns it to TMM’s review queue.</p><Button type="submit" disabled={busy}>{busy ? "Submitting…" : current ? "Update weekly report" : "Submit weekly report"}</Button></div>
        </form>
      </section>
    </div>
  </section>;
}

function AdminView({ data, ready, tab, setTab, onLogin, onAction, onLogout, issuedCode, setIssuedCode, onCaptcha, busy }: { data: AdminData; ready: boolean; tab: AdminTab; setTab: (tab: AdminTab) => void; onLogin: (event: FormEvent<HTMLFormElement>) => void; onAction: (action: string, payload: Record<string, unknown>, codeName?: string) => Promise<void>; onLogout: () => void; issuedCode: { name: string; code: string } | null; setIssuedCode: (value: { name: string; code: string } | null) => void; onCaptcha: (token: string) => void; busy: boolean }) {
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
    const header = ["Chapter", "Week", "Submitted", "Sessions", "Students", "Mentors", "Tasks complete", "Review status", "Private rating", "Private notes", "Public feedback"];
    const rows = data.reports.map((report) => {
      const chapter = data.chapters.find((item) => item.id === report.chapter_id);
      const review = reviewByReport.get(report.id);
      return [chapter?.name, report.week_start, report.submitted_at, report.sessions_held, report.students_served, report.mentors_present, report.completed_weekly_tasks ? "Yes" : "No", review?.status ?? "pending", review?.rating ?? "", review?.private_notes ?? "", review?.public_feedback ?? ""];
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
        <section className="priority-board admin-priority" aria-label="Admin priorities">
          <div className="sunday-signal"><span>Chapter reports</span><strong>SUN</strong><time>{weekDueDate().toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>
          <div className="priority-copy"><span className="priority-eyebrow">{dueTiming(weekDueDate())}</span><h2>Weekly reports are due every Sunday.</h2><p>{currentWeekReportChapters.size} of {data.chapters.filter((chapter) => chapter.status === "active").length} active chapters have checked in. Missing reports stay visible here until submitted.</p><Button onClick={() => setTab("reviews")}>Open weekly reviews</Button></div>
          <div className="priority-assignments"><div className="priority-list-heading"><span>Needs your attention</span><b>{adminAttention} items</b></div><button className="priority-task" onClick={() => setTab("reviews")}><span className="priority-dot high" /><span><strong>{missingReports.length} missing weekly reports</strong><small>Due {longDate(weekDueDate())}</small></span></button><button className="priority-task" onClick={() => setTab("reviews")}><span className="priority-dot" /><span><strong>{reviewQueue.length} reports awaiting review</strong><small>Rate and add team feedback</small></span></button><button className="priority-task" onClick={() => setTab("applications")}><span className="priority-dot" /><span><strong>{pending} applications waiting</strong><small>Approve, review, or decline</small></span></button></div>
        </section>
        <div className="metric-strip admin-metrics">
          <div><span>Active chapters</span><strong>{data.chapters.filter((chapter) => chapter.status === "active").length}</strong><small>{data.chapters.length} total chapters</small></div>
          <div><span>Submitted this week</span><strong>{currentWeekReportChapters.size}</strong><small>Reports due Sunday</small></div>
          <div><span>Awaiting review</span><strong>{reviewQueue.length}</strong><small>Private ratings to complete</small></div>
          <div><span>Open assignments</span><strong>{openAdminTasks.length}</strong><small>Across all chapters</small></div>
        </div>
        <section className="admin-section notification-center">
          <div className="section-title"><div><span className="section-kicker">Operations inbox</span><h2>Notifications</h2><p>A second, scannable place for every item that needs follow-through.</p></div><span className="notification-count">{adminAttention} active</span></div>
          <div className="notification-list admin-notifications">
            <button className={`notification-item ${missingReports.length ? "urgent" : "success"}`} onClick={() => setTab("reviews")}><span className="notification-indicator" /><span><small>Sunday reporting</small><strong>{missingReports.length ? `${missingReports.length} chapters have not submitted` : "Every active chapter has submitted"}</strong><p>{missingReports.length ? `Reports are due ${longDate(weekDueDate())}.` : "This week’s reporting is complete."}</p></span><b>→</b></button>
            <button className="notification-item info" onClick={() => setTab("reviews")}><span className="notification-indicator" /><span><small>Review queue</small><strong>{reviewQueue.length} reports need a private rating</strong><p>{followUps} reports are marked for follow-up.</p></span><b>→</b></button>
            <button className="notification-item neutral" onClick={() => setTab("applications")}><span className="notification-indicator" /><span><small>Applications</small><strong>{pending} applications need a decision</strong><p>Approved chapters receive a secure code.</p></span><b>→</b></button>
            <button className="notification-item neutral" onClick={() => setTab("work")}><span className="notification-indicator" /><span><small>Chapter work</small><strong>{openAdminTasks.length} assignments remain open</strong><p>Assign new work and manage the chapter calendar.</p></span><b>→</b></button>
          </div>
        </section>
        <div className="admin-two-column">
          <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Due this week</span><h2>Missing reports</h2><p>Active chapters that still need to check in by Sunday.</p></div><Button kind="quiet" onClick={() => setTab("reviews")}>View reviews</Button></div>{missingReports.length ? <div className="missing-list">{missingReports.slice(0, 6).map((chapter) => <div key={chapter.id}><span><strong>{chapter.name}</strong><small>{chapter.contact_name} · {chapter.contact_email}</small></span><Status value="missing" /></div>)}</div> : <Empty text="Every active chapter has submitted this week." />}</section>
          <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Recently assigned</span><h2>Open chapter work</h2><p>Highest-priority assignments across the network.</p></div><Button kind="quiet" onClick={() => setTab("work")}>Manage work</Button></div>{openAdminTasks.length ? <div className="admin-item-list home-list">{openAdminTasks.slice(0, 6).map((task) => <div key={task.id}><span><strong>{task.title}</strong><small>{data.chapters.find((chapter) => chapter.id === task.assigned_chapter_id)?.name ?? "Chapter"}{task.due_date ? ` · Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}` : ""}</small></span><Status value={task.priority === "high" ? "high" : task.status} /></div>)}</div> : <Empty text="No open assignments across the chapter network." />}</section>
        </div>
      </>}

      {tab === "applications" && <section className="admin-section"><div className="section-title"><div><h2>Chapter applications</h2><p>Approve to create the chapter and issue its access code.</p></div></div><div className="application-list">{data.applications.length ? data.applications.map((application) => <article className="application-card" key={application.id}><div className="application-top"><div><strong>{application.organization_name}</strong><span>{application.location}</span></div><Status value={application.status} /></div><div className="application-meta"><span>{application.contact_name}</span><a href={`mailto:${application.contact_email}`}>{application.contact_email}</a>{application.contact_phone && <a href={`tel:${application.contact_phone}`}>{application.contact_phone}</a>}<span>{new Date(application.created_at).toLocaleDateString()}</span></div>{application.why && <p>{application.why}</p>}<div className="row-actions">{application.status !== "approved" && <Button disabled={busy} onClick={() => onAction("admin-approve-application", { application_id: application.id }, application.organization_name)}>Approve & create code</Button>}{application.status !== "declined" && application.status !== "approved" && <Button kind="danger" disabled={busy} onClick={() => onAction("admin-update-application", { application_id: application.id, status: "declined" })}>Reject</Button>}</div></article>) : <Empty text="No applications yet." />}</div></section>}

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
        <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Network directory</span><h2>All chapters</h2><p>Contacts, weekly reporting status, and secure code management.</p></div></div>{data.chapters.length ? <div className="chapter-list">{data.chapters.map((chapter) => { const report = latestReport.get(chapter.id); return <article className="chapter-row" key={chapter.id}><div><strong>{chapter.name}</strong><span>{chapter.location}</span></div><div><span>{chapter.contact_name}</span><a href={`mailto:${chapter.contact_email}`}>{chapter.contact_email}</a>{chapter.contact_phone && <span>{chapter.contact_phone}</span>}</div><div><span>Latest report</span><strong className="plain-strong">{report ? new Date(`${report.week_start}T12:00:00`).toLocaleDateString() : "Not submitted"}</strong></div><div className="chapter-row-end"><Status value={chapter.status} /><span className="code-hint">Code ends •{chapter.access_code_hint ?? "—"}</span><Button kind="secondary" disabled={busy} onClick={() => onAction("admin-reset-code", { chapter_id: chapter.id }, chapter.name)}>Reset code</Button></div></article>; })}</div> : <Empty text="No chapters have been added." />}</section>
        <section className="admin-section form-zone"><div className="section-title"><div><span className="section-kicker">Add a record</span><h2>Add a chapter manually</h2><p>This form stays below the directory. Leave the code blank to generate one securely.</p></div></div><form className="surface-form compact" onSubmit={submitChapter}><div className="form-grid three"><Field label="Chapter name"><input name="name" required /></Field><Field label="City and state"><input name="location" required /></Field><Field label="Lead name"><input name="contact_name" required /></Field><Field label="Lead email"><input name="contact_email" type="email" required /></Field><Field label="Lead phone"><input name="contact_phone" type="tel" /></Field><Field label="Custom 6-digit code" hint="Optional · exactly 6 digits"><input name="code" className="code-input small" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} /></Field><Field label="Advisor name"><input name="advisor_name" /></Field><Field label="Advisor email"><input name="advisor_email" type="email" /></Field></div><div className="align-right"><Button type="submit" disabled={busy}>Add chapter</Button></div></form></section>
      </>}

      {tab === "work" && <>
        <div className="admin-two-column">
          <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Assigned work</span><h2>Chapter assignments</h2><p>Open and completed tasks across every chapter.</p></div><span className="notification-count">{openAdminTasks.length} open</span></div><div className="admin-item-list home-list">{data.tasks.length ? [...data.tasks].sort((a, b) => Number(a.status === "complete") - Number(b.status === "complete") || Number(b.priority === "high") - Number(a.priority === "high")).slice(0, 20).map((task) => <div key={task.id}><span><strong>{task.title}</strong><small>{data.chapters.find((chapter) => chapter.id === task.assigned_chapter_id)?.name ?? "Chapter"}{task.due_date ? ` · Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}` : ""}</small></span><Status value={task.priority === "high" && task.status !== "complete" ? "high" : task.status} /></div>) : <Empty text="No assignments have been created." />}</div></section>
          <section className="admin-section"><div className="section-title"><div><span className="section-kicker">Network calendar</span><h2>Upcoming events</h2><p>Shared dates and chapter-specific events.</p></div></div><div className="admin-item-list home-list">{data.events.length ? data.events.slice(0, 20).map((event) => <div key={event.id}><span><strong>{event.title}</strong><small>{new Date(event.starts_at).toLocaleString()}{event.location ? ` · ${event.location}` : ""}</small></span>{event.chapter_id ? <Status value="chapter" /> : <Status value="all chapters" />}</div>) : <Empty text="No upcoming events have been created." />}</div></section>
        </div>
        <div className="admin-two-column form-zone-grid">
          <section className="admin-section form-zone"><div className="section-title"><div><span className="section-kicker">Create below</span><h2>Assign a task</h2><p>New assignments appear at the top of the selected chapter’s dashboard and in Notifications.</p></div></div><form className="surface-form compact" onSubmit={submitTask}><Field label="Task"><input name="title" required /></Field><Field label="Chapter"><select name="chapter_id" required defaultValue=""><option value="" disabled>Select a chapter</option>{data.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></Field><div className="form-grid"><Field label="Due date"><input name="due_date" type="date" /></Field><Field label="Priority"><select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></select></Field></div><Field label="Details"><textarea name="description" rows={3} /></Field><Button type="submit" disabled={busy}>Assign task</Button></form></section>
          <section className="admin-section form-zone"><div className="section-title"><div><span className="section-kicker">Create below</span><h2>Create an event</h2><p>Leave chapter blank to share the event with every chapter.</p></div></div><form className="surface-form compact" onSubmit={submitEvent}><Field label="Event"><input name="title" required /></Field><Field label="Chapter"><select name="chapter_id" defaultValue=""><option value="">All chapters</option>{data.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></Field><div className="form-grid"><Field label="Starts"><input name="starts_at" type="datetime-local" required /></Field><Field label="Ends"><input name="ends_at" type="datetime-local" /></Field></div><Field label="Location"><input name="location" /></Field><Field label="Link"><input name="link" type="url" /></Field><Field label="Details"><textarea name="description" rows={3} /></Field><Button type="submit" disabled={busy}>Create event</Button></form></section>
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
    <div className="report-stats"><span><strong>{report.sessions_held}</strong> sessions</span><span><strong>{report.students_served}</strong> students</span><span><strong>{report.mentors_present}</strong> mentors</span><span><strong>{report.completed_weekly_tasks ? "Yes" : "No"}</strong> tasks done</span></div>
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
