"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

type View = "home" | "apply" | "signin" | "portal" | "admin";

type Chapter = {
  id: string;
  name: string;
  location: string;
  contact: string;
  email: string;
  status: "On track" | "Needs follow-up" | "New";
  completion: number;
  mentors: number;
  students: number;
  lastReport: string;
};

type Task = {
  id: string;
  title: string;
  chapter: string;
  due: string;
  priority: "High" | "Normal";
  done: boolean;
};

const chapters: Chapter[] = [
  { id: "cedar-grove", name: "Cedar Grove", location: "Cary, NC", contact: "Maya Patel", email: "maya@cedargrove.org", status: "On track", completion: 100, mentors: 12, students: 48, lastReport: "Today" },
  { id: "triangle-prep", name: "Triangle Prep", location: "Durham, NC", contact: "Noah Williams", email: "noah@triangleprep.org", status: "Needs follow-up", completion: 67, mentors: 8, students: 31, lastReport: "4 days ago" },
  { id: "oak-city", name: "Oak City Scholars", location: "Raleigh, NC", contact: "Amara Johnson", email: "amara@oakcity.org", status: "New", completion: 0, mentors: 5, students: 18, lastReport: "Not yet" },
];

const initialTasks: Task[] = [
  { id: "t1", title: "Submit your weekly chapter report", chapter: "Cedar Grove", due: "Today", priority: "High", done: false },
  { id: "t2", title: "Share the AMC 8 practice set", chapter: "Cedar Grove", due: "Thu, Jul 17", priority: "Normal", done: true },
  { id: "t3", title: "Confirm next Saturday’s mentor roster", chapter: "Cedar Grove", due: "Fri, Jul 18", priority: "Normal", done: false },
];

const events = [
  { date: "JUL 19", title: "Summer Mentor Jam", meta: "Saturday · 10:00 AM ET", type: "Shared" },
  { date: "JUL 24", title: "Chapter lead office hours", meta: "Thursday · 7:00 PM ET", type: "Leads" },
  { date: "AUG 02", title: "MathCounts strategy lab", meta: "Saturday · 11:00 AM ET", type: "Students" },
];

const asView = (value: string | null): View => {
  if (value === "apply" || value === "signin" || value === "portal" || value === "admin") return value;
  return "home";
};

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>;
}

function StatusPill({ children, tone = "gold" }: { children: React.ReactNode; tone?: "gold" | "green" | "muted" | "red" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function Arrow() {
  return <span className="arrow" aria-hidden="true">↗</span>;
}

export default function Home() {
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "home";
    return asView(new URLSearchParams(window.location.search).get("view"));
  });
  const [notice, setNotice] = useState("");
  const [submittedApplication, setSubmittedApplication] = useState(false);
  const [signInSent, setSignInSent] = useState(false);
  const [portalDenied, setPortalDenied] = useState("");
  const [adminDenied, setAdminDenied] = useState("");
  const [liveChapterId, setLiveChapterId] = useState<string | null>(null);
  const [liveChapterName, setLiveChapterName] = useState("Cedar Grove Chapter");
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [adminSearch, setAdminSearch] = useState("");

  const goTo = (next: View) => {
    setView(next);
    setNotice("");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", next === "home" ? "/" : `/?view=${next}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (!supabase || view !== "portal") return;
    let cancelled = false;
    const verifyChapterAccess = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) {
        setPortalDenied("Sign in with the email attached to your registered chapter.");
        setView("signin");
        return;
      }
      const { data: member } = await supabase
        .from("chapter_members")
        .select("chapter_id, chapters(name)")
        .eq("user_id", userData.user.id)
        .eq("status", "active")
        .maybeSingle();
      if (cancelled) return;
      if (!member) {
        setPortalDenied("This email is not attached to an active chapter yet. Ask your chapter lead to add you.");
        setView("signin");
        return;
      }
      const chapter = Array.isArray(member.chapters) ? member.chapters[0] : member.chapters;
      setLiveChapterId(member.chapter_id);
      setLiveChapterName(chapter?.name ? `${chapter.name} Chapter` : "Your chapter");
    };
    void verifyChapterAccess();
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    if (!supabase || view !== "admin") return;
    let cancelled = false;
    const verifyAdminAccess = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      const role = userData.user?.app_metadata?.role;
      if (!userData.user || role !== "admin") {
        setAdminDenied("The director console is for approved Mastery Mentors admins only.");
        setView("signin");
      }
    };
    void verifyAdminAccess();
    return () => { cancelled = true; };
  }, [view]);

  const filteredChapters = useMemo(() => {
    const q = adminSearch.toLowerCase().trim();
    if (!q) return chapters;
    return chapters.filter((chapter) => `${chapter.name} ${chapter.location} ${chapter.contact} ${chapter.email}`.toLowerCase().includes(q));
  }, [adminSearch]);

  const handleApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      contact_name: String(form.get("contact_name") || ""),
      contact_email: String(form.get("contact_email") || ""),
      organization_name: String(form.get("organization_name") || ""),
      location: String(form.get("location") || ""),
      student_reach: String(form.get("student_reach") || ""),
      why: String(form.get("why") || ""),
    };
    if (supabase) {
      const { error } = await supabase.from("chapter_applications").insert(payload);
      if (error) {
        setNotice(error.message);
        return;
      }
    }
    setSubmittedApplication(true);
    setNotice("Application received. We’ll be in touch within 3–5 days.");
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    if (supabase) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/?view=portal` },
      });
      if (error) {
        setNotice(error.message);
        return;
      }
      setSignInSent(true);
      setNotice("Magic link sent. Access is granted only when your email belongs to an active chapter.");
      return;
    }
    setLiveChapterName(email ? `${email.split("@")[0]} Chapter` : "Cedar Grove Chapter");
    goTo("portal");
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      chapter_id: liveChapterId,
      week_start: new Date().toISOString().slice(0, 10),
      sessions_held: Number(form.get("sessions_held") || 0),
      students_served: Number(form.get("students_served") || 0),
      mentors_present: Number(form.get("mentors_present") || 0),
      completed_weekly_tasks: form.get("completed_weekly_tasks") === "on",
      highlights: String(form.get("highlights") || ""),
      blockers: String(form.get("blockers") || ""),
    };
    if (supabase && liveChapterId) {
      const { error } = await supabase.from("weekly_reports").upsert(payload, { onConflict: "chapter_id,week_start" });
      if (error) {
        setNotice(error.message);
        return;
      }
    }
    setReportSubmitted(true);
    setNotice("Weekly report saved. Thank you for keeping the network in rhythm.");
  };

  const toggleTask = (id: string) => setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("task_title") || ""),
      description: String(form.get("task_description") || ""),
      assigned_chapter_id: String(form.get("assigned_chapter_id") || ""),
      due_date: String(form.get("task_due") || "") || null,
      priority: String(form.get("task_priority") || "normal"),
      status: "open",
    };
    if (supabase) {
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) {
        setNotice(error.message);
        return;
      }
    }
    const assigned = chapters.find((chapter) => chapter.id === payload.assigned_chapter_id)?.name || "Chapter";
    setTasks((current) => [{ id: `local-${Date.now()}`, title: payload.title, chapter: assigned, due: payload.due_date || "No due date", priority: payload.priority === "high" ? "High" : "Normal", done: false }, ...current]);
    setNotice("Task assigned. It will appear in the chapter workspace.");
    event.currentTarget.reset();
  };

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("event_title") || ""),
      starts_at: String(form.get("event_starts_at") || ""),
      location: String(form.get("event_location") || ""),
      description: String(form.get("event_description") || ""),
    };
    if (supabase) {
      const { error } = await supabase.from("events").insert(payload);
      if (error) {
        setNotice(error.message);
        return;
      }
    }
    setNotice("Event created and ready to share with chapters.");
    event.currentTarget.reset();
  };

  return (
    <main className="site-shell">
      <header className="site-nav">
        <button className="brand" onClick={() => goTo("home")} aria-label="The Mastery Mentors home">
          <BrandMark />
          <span><strong>The Mastery</strong><small>Mentors</small></span>
        </button>
        <nav className="nav-links" aria-label="Main navigation">
          <button className={view === "home" ? "active" : ""} onClick={() => goTo("home")}>Home</button>
          <a href={view === "home" ? "#how" : "/#how"}>How it works</a>
          <button className={view === "apply" ? "active" : ""} onClick={() => goTo("apply")}>Start a chapter</button>
          <button className={view === "admin" ? "active" : ""} onClick={() => goTo("admin")}>Director console</button>
        </nav>
        <div className="nav-actions">
          {supabase && <span className="connection-dot" title="Supabase connection configured" aria-label="Supabase connection configured" />}
          <button className="sign-in-link" onClick={() => goTo("signin")}>Chapter sign in <Arrow /></button>
        </div>
      </header>

      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}

      {view === "home" && <HomeView goTo={goTo} />}
      {view === "apply" && <ApplyView onSubmit={handleApplication} submitted={submittedApplication} />}
      {view === "signin" && <SignInView onSubmit={handleSignIn} sent={signInSent} denied={portalDenied || adminDenied} goTo={goTo} />}
      {view === "portal" && <PortalView chapterName={liveChapterName} tasks={tasks} toggleTask={toggleTask} onSubmitReport={submitReport} reportSubmitted={reportSubmitted} />}
      {view === "admin" && <AdminView chapters={filteredChapters} search={adminSearch} setSearch={setAdminSearch} onCreateTask={createTask} onCreateEvent={createEvent} />}

      <footer className="site-footer">
        <div className="footer-brand"><BrandMark /><span>Chapter operations for a math access movement.</span></div>
        <div className="footer-links"><a href="https://themasterymentors.vercel.app" target="_blank" rel="noreferrer">Main site <Arrow /></a><a href="mailto:themasterymentors@gmail.com">Email the team <Arrow /></a></div>
        <small>© 2026 The Mastery Mentors</small>
      </footer>
    </main>
  );
}

function HomeView({ goTo }: { goTo: (view: View) => void }) {
  return <>
    <section className="hero home-hero">
      <div className="hero-copy">
        <p className="eyebrow">CHAPTER OPERATIONS · THE MASTERY MENTORS</p>
        <h1>Build a chapter.<br /><em>Build confidence.</em></h1>
        <p className="hero-lede">A simple home base for the people bringing free, high-quality math mentorship closer to their communities.</p>
        <div className="hero-actions"><button className="button primary" onClick={() => goTo("apply")}>Start a chapter <Arrow /></button><button className="button outline" onClick={() => goTo("signin")}>Registered chapter sign in</button></div>
        <div className="hero-footnote"><span className="gold-rule" /> <span>Free K–8 math mentorship · student-led · growing together</span></div>
      </div>
      <div className="hero-visual" aria-label="A chapter network illustration">
        <div className="visual-caption"><span className="live-dot" /> NETWORK VIEW <span>01 / 03</span></div>
        <div className="orbit-stage"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-dot dot-main">TMM</div><div className="orbit-dot dot-one">CG</div><div className="orbit-dot dot-two">TP</div><div className="orbit-dot dot-three">OC</div></div>
        <div className="visual-bottom"><span>01</span><span>Every chapter has a rhythm.<br /><b>We make it easier to keep.</b></span></div>
      </div>
    </section>

    <section className="stat-strip"><div><strong>65+</strong><span>students reached</span></div><div><strong>17</strong><span>student mentors</span></div><div><strong>100%</strong><span>free for families</span></div><div><strong>∞</strong><span>room to grow</span></div></section>

    <section className="how-section" id="how"><div className="section-heading"><p className="eyebrow">A CLEARER WEEK</p><h2>Everything your chapter needs<br /><em>to keep moving.</em></h2><p>From the first “we should start this” to a full calendar of students, mentors, and math moments.</p></div><div className="how-grid"><article><span className="card-index">01</span><h3>Make it official</h3><p>Tell us where you are, who’s leading, and what access looks like in your community.</p><button onClick={() => goTo("apply")} className="text-link">Start the intake <Arrow /></button></article><article><span className="card-index">02</span><h3>Report the rhythm</h3><p>A five-minute weekly check-in keeps your chapter supported and your impact visible.</p><button onClick={() => goTo("signin")} className="text-link">See the chapter view <Arrow /></button></article><article><span className="card-index">03</span><h3>Grow together</h3><p>Get shared events, practical tasks, and a direct line to the people helping chapters thrive.</p><button onClick={() => goTo("admin")} className="text-link">Preview the console <Arrow /></button></article></div></section>

    <section className="quote-band"><div className="quote-mark">“</div><blockquote>Math access is not a one-time event. It is a weekly practice — and every chapter makes that practice more possible.</blockquote><span>THE MASTERY MENTORS · CHAPTER NETWORK</span></section>
  </>;
}

function ApplyView({ onSubmit, submitted }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitted: boolean }) {
  return <section className="page-wrap form-page"><div className="page-intro"><p className="eyebrow">01 / START A CHAPTER</p><h1>Make math access<br /><em>local.</em></h1><p>We’ll help you turn a strong idea into a chapter with a clear weekly rhythm, shared resources, and a support system behind you.</p></div><div className="form-layout"><div className="side-note"><div className="note-card"><span className="note-number">A / 01</span><h2>What happens next?</h2><p>We review your interest form, follow up with a short conversation, and share the chapter starter kit if it’s a fit.</p><div className="note-line"><span className="gold-rule" /> <span>Typical reply: 3–5 days</span></div></div><div className="mini-list"><div><b>01</b><span>Lead contact</span></div><div><b>02</b><span>Chapter shape</span></div><div><b>03</b><span>Local reach</span></div></div></div>{submitted ? <div className="success-card"><span className="success-icon">✓</span><p className="eyebrow">APPLICATION RECEIVED</p><h2>Your chapter idea is<br /><em>in motion.</em></h2><p>We’ll be in touch soon. In the meantime, keep gathering the people who want to make math feel more possible.</p></div> : <form className="portal-form" onSubmit={onSubmit}><div className="form-section-label">ABOUT YOU</div><div className="field-grid"><label>Full name<input name="contact_name" required placeholder="Your name" /></label><label>Email<input name="contact_email" type="email" required placeholder="you@example.com" /></label></div><div className="form-section-label">ABOUT THE CHAPTER</div><div className="field-grid"><label>Chapter or organization name<input name="organization_name" required placeholder="e.g. Oak City Scholars" /></label><label>City + state<input name="location" required placeholder="Raleigh, NC" /></label></div><label>Who would you serve?<select name="student_reach" defaultValue=""><option value="" disabled>Select a starting point</option><option>K–5 students</option><option>Middle school students</option><option>K–8 students</option><option>Competition prep students</option></select></label><label>What makes you want to start a chapter?<textarea name="why" required rows={4} placeholder="Tell us about the need you see and the people ready to help." /></label><button className="button primary full" type="submit">Send chapter interest form <Arrow /></button><p className="form-legal">By submitting, you agree to hear from The Mastery Mentors about chapter formation.</p></form>}</div></section>;
}

function SignInView({ onSubmit, sent, denied, goTo }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; sent: boolean; denied: string; goTo: (view: View) => void }) {
  return <section className="page-wrap signin-page"><div className="signin-card"><div className="signin-copy"><p className="eyebrow">02 / REGISTERED CHAPTERS ONLY</p><h1>Welcome back<br /><em>to the work.</em></h1><p>This space is for active chapter leads and mentors. Use the email attached to your chapter to receive a secure sign-in link.</p><div className="privacy-note"><span className="lock-shape">⌁</span><span><b>Private by design.</b><br />Chapter records stay visible to the people responsible for them.</span></div></div><div className="signin-form-wrap">{sent ? <div className="success-card compact"><span className="success-icon">✦</span><p className="eyebrow">CHECK YOUR INBOX</p><h2>Your secure link<br /><em>is on the way.</em></h2><p>Open the link on this device to continue. If you don’t see it, check spam or email the chapter team.</p></div> : <form className="portal-form" onSubmit={onSubmit}><div className="form-section-label">CHAPTER ACCESS</div><label>Chapter email<input name="email" type="email" required placeholder="lead@yourchapter.org" /></label><button className="button primary full" type="submit">Send secure sign-in link <Arrow /></button><p className="form-legal">No chapter account? <button type="button" className="inline-link" onClick={() => goTo("apply")}>Start a chapter application</button></p>{denied && <p className="form-error">{denied}</p>}</form>}</div></div></section>;
}

function PortalView({ chapterName, tasks, toggleTask, onSubmitReport, reportSubmitted }: { chapterName: string; tasks: Task[]; toggleTask: (id: string) => void; onSubmitReport: (event: FormEvent<HTMLFormElement>) => void; reportSubmitted: boolean }) {
  const completed = tasks.filter((task) => task.done).length;
  return <section className="workspace-wrap"><aside className="workspace-sidebar"><div className="workspace-label">CHAPTER WORKSPACE</div><div className="workspace-chapter"><span className="chapter-avatar">CG</span><span><b>{chapterName}</b><small>Active chapter</small></span></div><div className="workspace-nav"><span className="active">Overview</span><span>Weekly report</span><span>Tasks</span><span>Events</span><span>Resources</span></div><div className="sidebar-help"><span className="gold-rule" /><b>Need a hand?</b><p>Email the chapter team and we’ll help you find the next right step.</p><a href="mailto:themasterymentors@gmail.com">Get support <Arrow /></a></div></aside><div className="workspace-main"><div className="workspace-topline"><div><p className="eyebrow">WEEK OF JULY 14–20, 2026</p><h1>Your chapter, <em>in rhythm.</em></h1></div><StatusPill tone="green">Live chapter</StatusPill></div><div className="metric-grid"><div><span>WEEKLY TASKS</span><strong>{completed} <small>/ {tasks.length}</small></strong><em>completed</em></div><div><span>ACTIVE MENTORS</span><strong>12</strong><em>+2 this month</em></div><div><span>STUDENTS REACHED</span><strong>48</strong><em>across 4 groups</em></div><div><span>REPORT STREAK</span><strong>06</strong><em>weeks in a row</em></div></div><div className="workspace-columns"><div className="workspace-panel report-panel"><div className="panel-heading"><div><p className="eyebrow">THE WEEKLY CHECK-IN</p><h2>{reportSubmitted ? "Your report is saved." : "What moved this week?"}</h2></div><span className="panel-count">5 MIN</span></div>{reportSubmitted ? <div className="report-saved"><span className="success-icon">✓</span><h3>Thanks for keeping the network in rhythm.</h3><p>Your chapter lead team can see this week’s update. You can submit another report next week.</p></div> : <form className="portal-form" onSubmit={onSubmitReport}><div className="field-grid three"><label>Sessions held<input name="sessions_held" type="number" min="0" defaultValue="2" /></label><label>Students served<input name="students_served" type="number" min="0" defaultValue="48" /></label><label>Mentors present<input name="mentors_present" type="number" min="0" defaultValue="12" /></label></div><label className="check-field"><input name="completed_weekly_tasks" type="checkbox" /> <span>We completed our weekly chapter tasks.</span></label><label>One bright spot<textarea name="highlights" rows={3} placeholder="A student breakthrough, a mentor win, a new partner…" /></label><label>Anything blocking momentum?<textarea name="blockers" rows={3} placeholder="Optional — tell us where support would help." /></label><button className="button primary" type="submit">Save weekly report <Arrow /></button></form>}</div><div className="workspace-sidepanels"><div className="workspace-panel task-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR TASKS</p><h2>Keep the promise.</h2></div><span className="panel-count">{completed}/{tasks.length}</span></div><div className="task-list">{tasks.map((task) => <label className={`task-row ${task.done ? "done" : ""}`} key={task.id}><input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} /><span><b>{task.title}</b><small>{task.due} · {task.priority} priority</small></span></label>)}</div></div><div className="workspace-panel event-panel"><div className="panel-heading"><div><p className="eyebrow">UP NEXT</p><h2>Shared calendar.</h2></div><Arrow /></div>{events.slice(0, 2).map((event) => <div className="event-row" key={event.title}><span className="event-date">{event.date}</span><span><b>{event.title}</b><small>{event.meta}</small></span></div>)}</div></div></div></div></section>;
}

function AdminView({ chapters, search, setSearch, onCreateTask, onCreateEvent }: { chapters: Chapter[]; search: string; setSearch: (value: string) => void; onCreateTask: (event: FormEvent<HTMLFormElement>) => void; onCreateEvent: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className="admin-wrap"><div className="admin-header"><div><p className="eyebrow">03 / DIRECTOR CONSOLE</p><h1>The whole network,<br /><em>in one view.</em></h1><p>Track chapter health, see the people behind the work, and make the next step obvious.</p></div><StatusPill tone="green">Operations live</StatusPill></div><div className="admin-metrics"><div><span>ACTIVE CHAPTERS</span><strong>03</strong><em>+1 this quarter</em></div><div><span>WEEKLY REPORTS</span><strong>67%</strong><em>2 due today</em></div><div><span>STUDENTS REACHED</span><strong>97</strong><em>across the network</em></div><div><span>OPEN TASKS</span><strong>08</strong><em>3 high priority</em></div></div><div className="admin-grid"><div className="admin-panel chapters-panel"><div className="admin-panel-heading"><div><p className="eyebrow">CHAPTER DIRECTORY</p><h2>People + progress.</h2></div><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chapters or contacts" /></label></div><div className="table-wrap"><table><thead><tr><th>Chapter</th><th>Lead contact</th><th>Weekly rhythm</th><th>Students</th><th>Status</th></tr></thead><tbody>{chapters.map((chapter) => <tr key={chapter.id}><td><b>{chapter.name}</b><small>{chapter.location}</small></td><td><b>{chapter.contact}</b><small>{chapter.email}</small></td><td><div className="progress-cell"><span><i style={{ width: `${chapter.completion}%` }} /></span><small>{chapter.completion}% · {chapter.lastReport}</small></div></td><td>{chapter.students}</td><td><StatusPill tone={chapter.status === "On track" ? "green" : chapter.status === "New" ? "muted" : "red"}>{chapter.status}</StatusPill></td></tr>)}</tbody></table></div><div className="directory-foot"><span>Showing {chapters.length} chapters</span><button className="text-link">Export directory <Arrow /></button></div></div><div className="admin-panel assign-panel"><div className="admin-panel-heading"><div><p className="eyebrow">ASSIGN A TASK</p><h2>Make momentum visible.</h2></div></div><form className="portal-form compact-form" onSubmit={onCreateTask}><label>Task title<input name="task_title" required placeholder="e.g. Share the new lesson plan" /></label><label>Assign to<select name="assigned_chapter_id" defaultValue="cedar-grove">{chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>{chapter.name}</option>)}</select></label><div className="field-grid"><label>Due date<input name="task_due" type="date" /></label><label>Priority<select name="task_priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></select></label></div><label>Details<textarea name="task_description" rows={3} placeholder="What does done look like?" /></label><button className="button primary full" type="submit">Assign task <Arrow /></button></form></div><div className="admin-panel event-admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">SHARED EVENTS</p><h2>Give the network<br /><em>something to gather around.</em></h2></div></div><form className="portal-form compact-form" onSubmit={onCreateEvent}><label>Event name<input name="event_title" required placeholder="e.g. Chapter lead office hours" /></label><div className="field-grid"><label>Date + time<input name="event_starts_at" type="datetime-local" required /></label><label>Where<select name="event_location" defaultValue="Zoom"><option>Zoom</option><option>In person</option><option>Google Meet</option></select></label></div><label>Short description<textarea name="event_description" rows={3} placeholder="What should chapters know?" /></label><button className="button outline full" type="submit">Create shared event <Arrow /></button></form></div><div className="admin-panel admin-note-panel"><span className="note-number">OPS / NOTE</span><h2>One source of truth.</h2><p>Every application, chapter contact, weekly report, task, and event can live in your TMMChapters workspace with role-based access.</p><div className="note-line"><span className="gold-rule" /><span>Powered by your Supabase project</span></div></div></div></section>;
}
