"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type View = "access" | "apply" | "chapter" | "admin";
type Theme = "light" | "dark";
type AdminTab = "applications" | "chapters" | "work";

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
  submitted_at: string;
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
type AdminData = { applications: Application[]; chapters: Chapter[]; reports: Report[]; tasks: Task[]; events: ChapterEvent[] };
type AdminActionResult = Partial<AdminData> & { code?: string; chapter?: Chapter; overview?: AdminData };

const emptyAdmin: AdminData = { applications: [], chapters: [], reports: [], tasks: [], events: [] };

function thisMonday() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

async function invokePortal<T>(action: string, payload: Record<string, unknown> = {}) {
  if (!supabase) throw new Error("The portal is not connected yet.");
  const { data, error } = await supabase.functions.invoke("chapter-portal", { body: { action, ...payload } });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      try {
        const details = await response.clone().json() as { error?: string };
        if (details.error) throw new Error(details.error);
      } catch (contextError) {
        if (contextError instanceof Error && contextError.message !== "Unexpected end of JSON input") throw contextError;
      }
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

export default function Page() {
  const [view, setView] = useState<View>("access");
  const [theme, setTheme] = useState<Theme>("light");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [chapterToken, setChapterToken] = useState("");
  const [dashboard, setDashboard] = useState<ChapterDashboardData | null>(null);
  const [adminData, setAdminData] = useState<AdminData>(emptyAdmin);
  const [adminReady, setAdminReady] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("applications");
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

    const token = localStorage.getItem("tmm-chapter-session") ?? "";
    if (!token || initialView !== "access") return;
    void invokePortal<{ dashboard: ChapterDashboardData }>("chapter-dashboard", { token })
      .then((result) => { setChapterToken(token); setDashboard(result.dashboard); setView("chapter"); })
      .catch(() => { localStorage.removeItem("tmm-chapter-session"); setChapterToken(""); });
  }, []);

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
    try {
      const form = new FormData(event.currentTarget);
      const result = await invokePortal<{ token: string; dashboard: ChapterDashboardData }>("chapter-login", { code: form.get("code") });
      localStorage.setItem("tmm-chapter-session", result.token);
      setChapterToken(result.token);
      setDashboard(result.dashboard);
      goTo("chapter");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That code could not be used.");
    } finally { setBusy(false); }
  };

  const chapterLogout = async () => {
    if (chapterToken) void invokePortal("chapter-logout", { token: chapterToken }).catch(() => undefined);
    localStorage.removeItem("tmm-chapter-session");
    setChapterToken("");
    setDashboard(null);
    goTo("access");
  };

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return setMessage("The application form is not connected yet.");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      contact_name: String(form.get("contact_name") ?? ""),
      contact_email: String(form.get("contact_email") ?? ""),
      contact_phone: String(form.get("contact_phone") ?? ""),
      organization_name: String(form.get("organization_name") ?? ""),
      location: String(form.get("location") ?? ""),
      student_reach: String(form.get("student_reach") ?? ""),
      why: String(form.get("why") ?? ""),
    };
    const { error } = await supabase.from("chapter_applications").insert(payload);
    setBusy(false);
    if (error) return setMessage(error.message);
    event.currentTarget.reset();
    setMessage("Application sent. We’ll review it and contact you by email.");
    goTo("access");
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
      };
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-submit-report", { token: chapterToken, report });
      setDashboard(result.dashboard);
      setMessage("Weekly update saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The report could not be saved."); }
    finally { setBusy(false); }
  };

  const toggleTask = async (task: Task) => {
    setBusy(true);
    try {
      const result = await invokePortal<{ dashboard: ChapterDashboardData }>("chapter-toggle-task", { token: chapterToken, task_id: task.id, complete: task.status !== "complete" });
      setDashboard(result.dashboard);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The task could not be updated."); }
    finally { setBusy(false); }
  };

  const loadAdmin = async () => {
    const data = await invokePortal<AdminData>("admin-overview");
    setAdminData(data);
    setAdminReady(true);
  };

  const adminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return setMessage("Admin sign-in is not connected yet.");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    if (error) { setBusy(false); return setMessage(error.message); }
    try { await loadAdmin(); }
    catch (error) { await supabase.auth.signOut(); setMessage(error instanceof Error ? error.message : "Admin access is not enabled for this account."); }
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
    if (supabase) await supabase.auth.signOut();
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

    {view === "access" && <AccessView onLogin={chapterLogin} busy={busy} goTo={goTo} />}
    {view === "apply" && <ApplicationView onSubmit={submitApplication} busy={busy} />}
    {view === "chapter" && dashboard && <ChapterView data={dashboard} onReport={submitReport} onToggleTask={toggleTask} onLogout={chapterLogout} busy={busy} />}
    {view === "admin" && <AdminView data={adminData} ready={adminReady} tab={adminTab} setTab={setAdminTab} onLogin={adminLogin} onAction={adminAction} onLogout={adminLogout} issuedCode={issuedCode} setIssuedCode={setIssuedCode} busy={busy} />}
  </main>;
}

function AccessView({ onLogin, busy, goTo }: { onLogin: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; goTo: (view: View) => void }) {
  return <section className="access-shell">
    <div className="access-card">
      <div className="card-heading"><span className="tiny-label">Chapter access</span><h1>Enter your chapter code</h1><p>Use the code provided when your chapter was approved.</p></div>
      <form onSubmit={onLogin} className="stack-form">
        <Field label="Chapter code"><input className="code-input" name="code" autoComplete="one-time-code" autoCapitalize="characters" placeholder="TMM-••••-••••-••••" required /></Field>
        <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Open chapter dashboard"}</Button>
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
  return <section className="workspace">
    <aside className="sidebar">
      <div><span className="tiny-label">Current chapter</span><h2>{data.chapter.name}</h2><p>{data.chapter.location}</p></div>
      <nav><a href="#weekly">Weekly update</a><a href="#tasks">Tasks</a><a href="#events">Events</a><a href="#history">History</a></nav>
      <button className="sidebar-action" onClick={onLogout}>Sign out chapter</button>
    </aside>
    <div className="workspace-content">
      <div className="workspace-heading"><div><span className="tiny-label">Chapter dashboard</span><h1>{data.chapter.name}</h1></div><Status value={data.chapter.status} /></div>
      <section className="work-section weekly-section" id="weekly">
        <div className="section-title"><div><h2>Weekly update</h2><p>One report per week. Submitting again updates the same week.</p></div>{latest && <span className="last-saved">Last saved {new Date(latest.submitted_at).toLocaleDateString()}</span>}</div>
        <form className="weekly-form" onSubmit={onReport}>
          <div className="form-grid four">
            <Field label="Week starting"><input type="date" name="week_start" defaultValue={thisMonday()} required /></Field>
            <Field label="Sessions held"><input type="number" min="0" name="sessions_held" defaultValue={latest?.week_start === thisMonday() ? latest.sessions_held : 0} required /></Field>
            <Field label="Students served"><input type="number" min="0" name="students_served" defaultValue={latest?.week_start === thisMonday() ? latest.students_served : 0} required /></Field>
            <Field label="Mentors present"><input type="number" min="0" name="mentors_present" defaultValue={latest?.week_start === thisMonday() ? latest.mentors_present : 0} required /></Field>
          </div>
          <label className="check-row"><input type="checkbox" name="completed_weekly_tasks" defaultChecked={latest?.week_start === thisMonday() ? latest.completed_weekly_tasks : false} /><span>We completed the required weekly tasks.</span></label>
          <div className="form-grid"><Field label="What did you do this week?"><textarea name="highlights" rows={4} defaultValue={latest?.week_start === thisMonday() ? latest.highlights ?? "" : ""} placeholder="Sessions, outreach, curriculum work…" /></Field><Field label="Do you need help with anything?"><textarea name="blockers" rows={4} defaultValue={latest?.week_start === thisMonday() ? latest.blockers ?? "" : ""} placeholder="Optional" /></Field></div>
          <div className="align-right"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save weekly update"}</Button></div>
        </form>
      </section>
      <div className="content-grid">
        <section className="work-section" id="tasks"><div className="section-title"><div><h2>Assigned tasks</h2><p>Check tasks off when they’re complete.</p></div></div><div className="item-list">{data.tasks.length ? data.tasks.map((task) => <button className={`task-item ${task.status === "complete" ? "complete" : ""}`} onClick={() => onToggleTask(task)} key={task.id} disabled={busy}><span className="check-box">{task.status === "complete" ? "✓" : ""}</span><span><strong>{task.title}</strong><small>{task.due_date ? `Due ${new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}` : "No due date"}{task.priority === "high" ? " · High priority" : ""}</small></span></button>) : <Empty text="No assigned tasks." />}</div></section>
        <section className="work-section" id="events"><div className="section-title"><div><h2>Upcoming events</h2><p>Shared and chapter-specific events.</p></div></div><div className="item-list">{data.events.length ? data.events.map((event) => <div className="event-item" key={event.id}><time>{new Date(event.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><span><strong>{event.title}</strong><small>{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{event.location ? ` · ${event.location}` : ""}</small></span></div>) : <Empty text="No upcoming events." />}</div></section>
      </div>
      <section className="work-section" id="history"><div className="section-title"><div><h2>Report history</h2><p>Your most recent weekly submissions.</p></div></div>{data.reports.length ? <div className="simple-table"><div className="table-head"><span>Week</span><span>Sessions</span><span>Students</span><span>Tasks done</span></div>{data.reports.map((report) => <div className="table-row" key={report.id}><span>{new Date(`${report.week_start}T12:00:00`).toLocaleDateString()}</span><span>{report.sessions_held}</span><span>{report.students_served}</span><span>{report.completed_weekly_tasks ? "Yes" : "No"}</span></div>)}</div> : <Empty text="No weekly reports yet." />}</section>
    </div>
  </section>;
}

function AdminView({ data, ready, tab, setTab, onLogin, onAction, onLogout, issuedCode, setIssuedCode, busy }: { data: AdminData; ready: boolean; tab: AdminTab; setTab: (tab: AdminTab) => void; onLogin: (event: FormEvent<HTMLFormElement>) => void; onAction: (action: string, payload: Record<string, unknown>, codeName?: string) => Promise<void>; onLogout: () => void; issuedCode: { name: string; code: string } | null; setIssuedCode: (value: { name: string; code: string } | null) => void; busy: boolean }) {
  const pending = data.applications.filter((application) => application.status === "new" || application.status === "reviewing").length;
  const latestReport = useMemo(() => new Map(data.reports.map((report) => [report.chapter_id, report])), [data.reports]);
  if (!ready) return <section className="access-shell"><div className="access-card"><div className="card-heading"><span className="tiny-label">Admin</span><h1>Sign in</h1><p>Use the admin account configured in Supabase.</p></div><form className="stack-form" onSubmit={onLogin}><Field label="Email"><input name="email" type="email" required /></Field><Field label="Password"><input name="password" type="password" required /></Field><Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Open admin dashboard"}</Button></form></div></section>;

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

  return <section className="admin-layout">
    <aside className="admin-sidebar"><div><span className="tiny-label">Administration</span><h2>Chapter operations</h2></div><nav><button className={tab === "applications" ? "active" : ""} onClick={() => setTab("applications")}>Applications {pending > 0 && <b>{pending}</b>}</button><button className={tab === "chapters" ? "active" : ""} onClick={() => setTab("chapters")}>Chapters</button><button className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}>Tasks & events</button></nav><button className="sidebar-action" onClick={onLogout}>Sign out admin</button></aside>
    <div className="admin-content">
      <div className="workspace-heading"><div><span className="tiny-label">Admin dashboard</span><h1>{tab === "applications" ? "Applications" : tab === "chapters" ? "Chapters" : "Tasks & events"}</h1></div></div>
      {issuedCode && <div className="code-result"><div><span className="tiny-label">New chapter code · shown once</span><strong>{issuedCode.name}</strong><code>{issuedCode.code}</code></div><div><Button kind="secondary" onClick={() => navigator.clipboard.writeText(issuedCode.code)}>Copy code</Button><Button kind="quiet" onClick={() => setIssuedCode(null)}>Dismiss</Button></div></div>}

      {tab === "applications" && <section className="admin-section"><div className="section-title"><div><h2>Chapter applications</h2><p>Approve to create the chapter and issue its access code.</p></div></div><div className="application-list">{data.applications.length ? data.applications.map((application) => <article className="application-card" key={application.id}><div className="application-top"><div><strong>{application.organization_name}</strong><span>{application.location}</span></div><Status value={application.status} /></div><div className="application-meta"><span>{application.contact_name}</span><a href={`mailto:${application.contact_email}`}>{application.contact_email}</a>{application.contact_phone && <a href={`tel:${application.contact_phone}`}>{application.contact_phone}</a>}<span>{new Date(application.created_at).toLocaleDateString()}</span></div>{application.why && <p>{application.why}</p>}<div className="row-actions">{application.status !== "approved" && <Button disabled={busy} onClick={() => onAction("admin-approve-application", { application_id: application.id }, application.organization_name)}>Approve & create code</Button>}{application.status !== "declined" && application.status !== "approved" && <Button kind="danger" disabled={busy} onClick={() => onAction("admin-update-application", { application_id: application.id, status: "declined" })}>Reject</Button>}</div></article>) : <Empty text="No applications yet." />}</div></section>}

      {tab === "chapters" && <><section className="admin-section"><div className="section-title"><div><h2>Add a chapter manually</h2><p>Leave the code blank to generate one automatically.</p></div></div><form className="surface-form compact" onSubmit={submitChapter}><div className="form-grid three"><Field label="Chapter name"><input name="name" required /></Field><Field label="City and state"><input name="location" required /></Field><Field label="Lead name"><input name="contact_name" required /></Field><Field label="Lead email"><input name="contact_email" type="email" required /></Field><Field label="Lead phone"><input name="contact_phone" type="tel" /></Field><Field label="Custom code" hint="Optional · at least 10 letters or numbers"><input name="code" className="code-input small" /></Field><Field label="Advisor name"><input name="advisor_name" /></Field><Field label="Advisor email"><input name="advisor_email" type="email" /></Field></div><div className="align-right"><Button type="submit" disabled={busy}>Add chapter</Button></div></form></section><section className="admin-section"><div className="section-title"><div><h2>Chapter directory</h2><p>Contacts, reporting status, and code management.</p></div></div>{data.chapters.length ? <div className="chapter-list">{data.chapters.map((chapter) => { const report = latestReport.get(chapter.id); return <article className="chapter-row" key={chapter.id}><div><strong>{chapter.name}</strong><span>{chapter.location}</span></div><div><span>{chapter.contact_name}</span><a href={`mailto:${chapter.contact_email}`}>{chapter.contact_email}</a>{chapter.contact_phone && <span>{chapter.contact_phone}</span>}</div><div><span>Latest report</span><strong className="plain-strong">{report ? new Date(`${report.week_start}T12:00:00`).toLocaleDateString() : "Not submitted"}</strong></div><div className="chapter-row-end"><Status value={chapter.status} /><span className="code-hint">Code ends •{chapter.access_code_hint ?? "—"}</span><Button kind="secondary" disabled={busy} onClick={() => onAction("admin-reset-code", { chapter_id: chapter.id }, chapter.name)}>Reset code</Button></div></article>; })}</div> : <Empty text="No chapters have been added." />}</section></>}

      {tab === "work" && <div className="admin-two-column"><section className="admin-section"><div className="section-title"><div><h2>Assign a task</h2><p>Tasks appear immediately in the selected chapter dashboard.</p></div></div><form className="surface-form compact" onSubmit={submitTask}><Field label="Task"><input name="title" required /></Field><Field label="Chapter"><select name="chapter_id" required defaultValue=""><option value="" disabled>Select a chapter</option>{data.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></Field><div className="form-grid"><Field label="Due date"><input name="due_date" type="date" /></Field><Field label="Priority"><select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></select></Field></div><Field label="Details"><textarea name="description" rows={3} /></Field><Button type="submit" disabled={busy}>Assign task</Button></form><div className="admin-item-list">{data.tasks.slice(0, 12).map((task) => <div key={task.id}><span><strong>{task.title}</strong><small>{data.chapters.find((chapter) => chapter.id === task.assigned_chapter_id)?.name ?? "Chapter"}</small></span><Status value={task.status} /></div>)}</div></section><section className="admin-section"><div className="section-title"><div><h2>Create an event</h2><p>Leave chapter blank to share with every chapter.</p></div></div><form className="surface-form compact" onSubmit={submitEvent}><Field label="Event"><input name="title" required /></Field><Field label="Chapter"><select name="chapter_id" defaultValue=""><option value="">All chapters</option>{data.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></Field><div className="form-grid"><Field label="Starts"><input name="starts_at" type="datetime-local" required /></Field><Field label="Ends"><input name="ends_at" type="datetime-local" /></Field></div><Field label="Location"><input name="location" /></Field><Field label="Link"><input name="link" type="url" /></Field><Field label="Details"><textarea name="description" rows={3} /></Field><Button type="submit" disabled={busy}>Create event</Button></form><div className="admin-item-list">{data.events.slice(0, 12).map((event) => <div key={event.id}><span><strong>{event.title}</strong><small>{new Date(event.starts_at).toLocaleString()}</small></span>{event.chapter_id ? <Status value="chapter" /> : <Status value="all chapters" />}</div>)}</div></section></div>}
    </div>
  </section>;
}

function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
