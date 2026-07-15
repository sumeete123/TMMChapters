import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chapter Operations | The Mastery Mentors",
  description: "A chapter workspace for building free, high-quality math mentorship in more communities.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
