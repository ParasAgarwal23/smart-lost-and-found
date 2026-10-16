import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import SiteHeader from "@/components/site-header";
import { Icon } from "@/components/icons";
import "./globals.css";

// Fonts are downloaded at build time and self-hosted by Next.js.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: "Campus Lost & Found", template: "%s · Campus Lost & Found" },
  description: "Smart Lost and Found Management System — a college DBMS Level 3 project built on PostgreSQL and pgvector.",
};

export const viewport: Viewport = { themeColor: "#0f5c48" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer className="mt-16 border-t border-line bg-surface">
          <div className="container-page flex flex-col gap-2 py-6 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-display text-base text-ink">Campus Lost &amp; Found</p>
            <p className="flex items-center gap-2"><Icon name="database" size={15} />Smart Lost and Found Management System · PostgreSQL + pgvector</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
