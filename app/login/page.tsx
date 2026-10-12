import Link from "next/link";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Sign In</h1>
        <p className="mt-2 text-sm text-slate-600">
          Smart Lost and Found Management System
        </p>
        <LoginForm />
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-teal-700 underline">Back to Home</Link>
      </section>
    </main>
  );
}
