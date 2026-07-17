import type { Metadata } from "next";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const description = "National chapter impact, weekly reporting, volunteers, tasks, events, and administration for The Mastery Mentors.";
  return {
    title: "TMM Chapters",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "TMM National Chapter", description, type: "website" },
    twitter: { card: "summary", title: "TMM National Chapter", description },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
