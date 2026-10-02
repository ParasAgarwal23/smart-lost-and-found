"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createFoundReport, type FoundReportState } from "@/app/actions/found-report";

type Props = {
  categories: { Category_ID: number; Category_Name: string | null }[];
  locations: { Location_ID: number; Location_Name: string | null; Building: string | null }[];
};

const initialState: FoundReportState = { error: null, success: null };
const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700";

export default function FoundReportForm({ categories, locations }: Props) {
  const [state, action, pending] = useActionState(createFoundReport, initialState);
  const missingOptions = categories.length === 0 || locations.length === 0;

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="itemName" className="block text-sm font-medium">Item Name</label>
        <input id="itemName" name="itemName" required maxLength={100} className={fieldClass} />
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium">Description</label>
        <textarea id="description" name="description" required rows={4} className={fieldClass} />
      </div>
      <div>
        <label htmlFor="categoryId" className="block text-sm font-medium">Category</label>
        <select id="categoryId" name="categoryId" required defaultValue="" className={fieldClass}>
          <option value="" disabled>Select a category</option>
          {categories.map((category) => (
            <option key={category.Category_ID} value={category.Category_ID}>
              {category.Category_Name ?? `Category ${category.Category_ID}`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="locationId" className="block text-sm font-medium">Location</label>
        <select id="locationId" name="locationId" required defaultValue="" className={fieldClass}>
          <option value="" disabled>Select a location</option>
          {locations.map((location) => (
            <option key={location.Location_ID} value={location.Location_ID}>
              {location.Location_Name ?? `Location ${location.Location_ID}`}
              {location.Building ? ` (${location.Building})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="dateFound" className="block text-sm font-medium">Date Found</label>
        <input id="dateFound" name="dateFound" type="date" required className={fieldClass} />
      </div>
      {missingOptions && <p className="text-sm text-slate-600">Categories and locations must be available before a report can be submitted.</p>}
      <p role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      <button type="submit" disabled={pending || missingOptions} className="w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Submit found report"}
      </button>
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/">Back to Home</Link>
          <Link href="/search">Search</Link>
        </nav>
      )}
    </form>
  );
}
