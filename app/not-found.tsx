import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="container-page py-16">
      <div className="mx-auto max-w-xl">
        <EmptyState icon="question" title="This page went missing"
          actions={<>
            <Link href="/" className="btn btn-primary btn-sm"><Icon name="home" size={16} />Back to Home</Link>
            <Link href="/search" className="btn btn-secondary btn-sm"><Icon name="search" size={16} />Search reports</Link>
          </>}>
          <h1 className="sr-only">Page not found</h1>
          We couldn&apos;t find the page you were looking for. Unlike your belongings, it may not turn up.
        </EmptyState>
      </div>
    </main>
  );
}
