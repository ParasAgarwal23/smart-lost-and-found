import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Lost and Found Management System",
  description: "A college DBMS Level 3 project for managing lost and found items.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <header className="site-header">
          <nav aria-label="Site navigation" className="site-nav">
            <Link href="/" className="site-brand"><span className="brand-mark" aria-hidden="true">LF</span><span>Campus Lost &amp; Found<span className="brand-caption">Find it. Claim it. Bring it home.</span></span></Link>
            <Link href="/search" className="nav-search">Search items <span aria-hidden="true">&rarr;</span></Link>
          </nav>
        </header>
        {children}
        <footer className="site-footer">Campus Lost &amp; Found <span aria-hidden="true">&middot;</span> Helping belongings find their way back.</footer>
      </body>
    </html>
  );
}
