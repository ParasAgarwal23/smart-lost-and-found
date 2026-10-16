export default function LoadingCampusSummary() {
  return (
    <main id="main-content" tabIndex={-1} aria-busy="true" className="container-page py-8 sm:py-12">
      <p className="eyebrow">ADMIN · READ ONLY</p>
      <h1 className="page-title mt-2">Campus Summary</h1>
      <p role="status" className="mt-3 text-ink-2">Loading campus summary…</p>
      <div aria-hidden="true" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="card p-5"><div className="skeleton h-4 w-28" /><div className="skeleton mt-3 h-9 w-16" /></div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-10 grid gap-5 xl:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="card grid gap-3 p-6">
            {[0, 1, 2, 3, 4].map((row) => <div key={row} className="skeleton h-6 w-full" />)}
          </div>
        ))}
      </div>
    </main>
  );
}
