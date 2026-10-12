export default function LoadingCampusSummary() {
  return (
    <main id="main-content" tabIndex={-1} aria-busy="true" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="page-title">Campus Summary</h1>
      <p role="status" className="mt-6 text-slate-600">Loading campus summary…</p>
    </main>
  );
}
