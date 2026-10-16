// Route-level skeleton shown while a Server Component page loads its data.
export default function Loading() {
  return (
    <main id="main-content" tabIndex={-1} aria-busy="true" className="container-page py-8 sm:py-12">
      <p className="sr-only" role="status">Loading…</p>
      <div aria-hidden="true">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-4 h-10 w-2/3 max-w-md" />
        <div className="skeleton mt-3 h-4 w-full max-w-xl" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="card grid gap-3 p-5">
              <div className="skeleton h-5 w-20 rounded-full" />
              <div className="skeleton h-6 w-1/2" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
