export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <p className="text-sm font-semibold tracking-widest text-teal-700">
          COLLEGE DBMS LEVEL 3 PROJECT
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Smart Lost and Found Management System
        </h1>
        <p className="mt-6 text-base leading-7 text-slate-600">
          A place to help lost items find their way back to their owners.
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          The application is under development. Item reporting and other features
          will be added in upcoming steps.
        </p>
      </div>
    </main>
  );
}
