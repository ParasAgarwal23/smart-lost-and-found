"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createLostReport, type LostReportState } from "@/app/actions/lost-report";

type Props = {
  categories: { Category_ID: number; Category_Name: string | null }[];
  locations: { Location_ID: number; Location_Name: string | null; Building: string | null }[];
};

const initialState: LostReportState = { error: null, success: null };
const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700";

export default function LostReportForm({ categories, locations }: Props) {
  const emptyFields = { itemName: "", description: "", categoryId: "", locationId: "", dateLost: "" };
  const [values, setValues] = useState(emptyFields);
  const [state, action, pending] = useActionState(async (previous: LostReportState, data: FormData) => {
    const result = await createLostReport(previous, data);
    if (result.success && !result.error) setValues(emptyFields);
    return result;
  }, initialState);
  const missingOptions = categories.length === 0 || locations.length === 0;

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-6 space-y-4">
      <p className="text-sm text-slate-600">All fields are required. Include distinctive details, but keep contact details and private proof of ownership out of this public report.</p>
      <div>
        <label htmlFor="itemName" className="block text-sm font-medium">Item Name</label>
        <input id="itemName" name="itemName" value={values.itemName} onChange={(event) => setValues({ ...values, itemName: event.target.value })} aria-invalid={!!state.fieldErrors?.itemName} aria-describedby="report-feedback" required maxLength={100} className={fieldClass} />
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium">Description</label>
        <textarea id="description" name="description" value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} aria-invalid={!!state.fieldErrors?.description} aria-describedby="report-feedback" required rows={4} className={fieldClass} />
      </div>
      <div>
        <label htmlFor="categoryId" className="block text-sm font-medium">Category</label>
        <select id="categoryId" name="categoryId" value={values.categoryId} onChange={(event) => setValues({ ...values, categoryId: event.target.value })} aria-invalid={!!state.fieldErrors?.categoryId} aria-describedby="report-feedback" required className={fieldClass}>
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
        <select id="locationId" name="locationId" value={values.locationId} onChange={(event) => setValues({ ...values, locationId: event.target.value })} aria-invalid={!!state.fieldErrors?.locationId} aria-describedby="report-feedback" required className={fieldClass}>
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
        <label htmlFor="dateLost" className="block text-sm font-medium">Date Lost</label>
        <input id="dateLost" name="dateLost" value={values.dateLost} onChange={(event) => setValues({ ...values, dateLost: event.target.value })} aria-invalid={!!state.fieldErrors?.dateLost} aria-describedby="report-feedback" type="date" required className={fieldClass} />
      </div>
      {missingOptions && <p className="text-sm text-slate-600">Categories and locations must be available before a report can be submitted.</p>}
      <p id="report-feedback" role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
        {state.fieldErrors && <span className="mt-1 block">{Object.values(state.fieldErrors).join(" ")}</span>}
      </p>
      <button type="submit" disabled={pending || missingOptions} className="min-h-11 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Submit lost report"}
      </button>
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/">Back to Home</Link>
          <Link href="/search?type=Found">Search found items</Link>
          <Link href={state.reportId ? `/potential-matches?lostId=${state.reportId}` : "/potential-matches"}>Potential Matches</Link>
        </nav>
      )}
    </form>
  );
}
