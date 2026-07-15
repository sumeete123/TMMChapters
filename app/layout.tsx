import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TMM Chapters",
  description: "Chapter access, weekly reporting, tasks, events, and administration for The Mastery Mentors.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
