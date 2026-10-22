"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createFoundReport } from "@/app/actions/found-report";
import { createLostReport } from "@/app/actions/lost-report";
import { editReport } from "@/app/actions/report-edit";
import { describedBy, Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import type { ReportState } from "@/lib/report-writes";
import type { CategoryOption, LocationOption } from "@/lib/reference-data";

type Values = { itemName: string; description: string; categoryId: string; locationId: string; date: string };

const DESCRIPTION_MAX = 2000;
const emptyValues: Values = { itemName: "", description: "", categoryId: "", locationId: "", date: "" };
const initialState: ReportState = { error: null, success: null };

export default function ReportForm({ kind, categories, locations, today, edit }: {
  kind: "lost" | "found";
  categories: CategoryOption[];
  locations: LocationOption[];
  today: string;
  edit?: { reportId: number; values: Values };
}) {
  const dateField = kind === "lost" ? "dateLost" : "dateFound";
  const [values, setValues] = useState<Values>(edit?.values ?? emptyValues);
  const [state, action, pending] = useActionState(async (previous: ReportState, data: FormData) => {
    const submit = edit ? editReport : kind === "lost" ? createLostReport : createFoundReport;
    const result = await submit(previous, data);
    // Create clears the draft on success; edit keeps the saved values visible.
    if (result.success && !result.error && !edit) setValues(emptyValues);
    return result;
  }, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};

  // Move keyboard focus to the first invalid field after a rejected submission.
  useEffect(() => {
    const first = Object.keys(state.fieldErrors ?? {})[0];
    if (!first) return;
    formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }, [state]);

  const missingOptions = categories.length === 0 || locations.length === 0;
  const set = (key: keyof Values) => (event: { target: { value: string } }) => setValues({ ...values, [key]: event.target.value });
  const succeeded = !!state.success && !state.error;
  const lost = kind === "lost";

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form ref={formRef} onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="grid gap-6">
      {edit && <><input type="hidden" name="kind" value={kind} /><input type="hidden" name="reportId" value={edit.reportId} /></>}
      <p className="text-sm text-ink-3">All fields are required.</p>

      <fieldset className="grid gap-5">
        <legend className="mb-3 text-base font-bold">About the item</legend>
        <Field id="itemName" label="What is it?" error={errors.itemName}>
          <input id="itemName" name="itemName" value={values.itemName} onChange={set("itemName")} required maxLength={100}
            autoComplete="off" placeholder={lost ? "e.g. Black phone in a navy case" : "e.g. Grey calculator with cover"}
            className="input" aria-invalid={!!errors.itemName}
            aria-describedby={describedBy("itemName", { error: !!errors.itemName }, "report-feedback")} />
        </Field>
        <Field id="categoryId" label="Category" error={errors.categoryId}>
          <select id="categoryId" name="categoryId" value={values.categoryId} onChange={set("categoryId")} required
            className="input" aria-invalid={!!errors.categoryId}
            aria-describedby={describedBy("categoryId", { error: !!errors.categoryId }, "report-feedback")}>
            <option value="" disabled>Choose a category</option>
            {categories.map((category) => (
              <option key={category.Category_ID} value={category.Category_ID}>
                {category.Category_Name ?? `Category ${category.Category_ID}`}
              </option>
            ))}
          </select>
        </Field>
        <Field id="description" label="Description" error={errors.description}
          hint="Colour, brand, stickers or marks help people recognise it. Don't include phone numbers or private proof — save that for your claim."
          counter={<span className="counter" aria-hidden="true">{values.description.length.toLocaleString("en-US")}/{DESCRIPTION_MAX.toLocaleString("en-US")}</span>}>
          <textarea id="description" name="description" value={values.description} onChange={set("description")} required
            maxLength={DESCRIPTION_MAX} rows={4} className="input" aria-invalid={!!errors.description}
            aria-describedby={describedBy("description", { hint: true, error: !!errors.description }, "report-feedback")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-3 text-base font-bold">Where and when</legend>
        <Field id="locationId" label={lost ? "Where did you lose it?" : "Where did you find it?"} error={errors.locationId}>
          <select id="locationId" name="locationId" value={values.locationId} onChange={set("locationId")} required
            className="input" aria-invalid={!!errors.locationId}
            aria-describedby={describedBy("locationId", { error: !!errors.locationId }, "report-feedback")}>
            <option value="" disabled>Choose a place</option>
            {locations.map((location) => (
              <option key={location.Location_ID} value={location.Location_ID}>
                {location.Location_Name ?? `Location ${location.Location_ID}`}
                {location.Building ? ` (${location.Building})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field id={dateField} label={lost ? "Date lost" : "Date found"} error={errors[dateField]}>
          <input id={dateField} name={dateField} type="date" value={values.date} onChange={set("date")} required max={today}
            className="input sm:max-w-60" aria-invalid={!!errors[dateField]}
            aria-describedby={describedBy(dateField, { error: !!errors[dateField] }, "report-feedback")} />
        </Field>
      </fieldset>

      {missingOptions && <p className="hint">Categories and locations must be available before a report can be submitted.</p>}

      <FormFeedback id="report-feedback" error={state.error} success={state.success} signedOut={state.signedOut}>
        {state.error && Object.keys(errors).length > 0 && <p className="mt-0.5">The fields that need attention are marked below each one.</p>}
        {succeeded && !edit && <p className="mt-0.5">{lost ? "Next, check whether anyone has found something similar." : "The owner can now find it in search and claim it."}</p>}
        {succeeded && (
          <nav aria-label="Next steps" className="mt-3 flex flex-wrap gap-2">
            {edit ? (
              <>
                <Link href="/my-reports" className="btn btn-primary btn-sm">Back to My Reports</Link>
                {lost && <Link href={`/potential-matches?lostId=${edit.reportId}`} className="btn btn-secondary btn-sm">See possible matches</Link>}
              </>
            ) : lost ? (
              <>
                <Link href={state.reportId ? `/potential-matches?lostId=${state.reportId}` : "/potential-matches"} className="btn btn-primary btn-sm"><Icon name="sparkles" size={16} />See possible matches</Link>
                <Link href="/my-reports" className="btn btn-secondary btn-sm">My Reports</Link>
              </>
            ) : (
              <>
                <Link href="/my-reports" className="btn btn-primary btn-sm">My Reports</Link>
                <Link href={`/search?type=Found&text=${encodeURIComponent(state.itemName ?? "")}`} className="btn btn-secondary btn-sm">View it in search</Link>
              </>
            )}
          </nav>
        )}
      </FormFeedback>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        {succeeded && !edit ? <p className="text-sm text-ink-3">The form is clear if you want to report another item.</p> : <span />}
        <SubmitButton pending={pending} disabled={missingOptions} pendingLabel={edit ? "Saving…" : "Submitting…"}>
          {edit ? "Save changes" : lost ? "Submit lost report" : "Submit found report"}
        </SubmitButton>
      </div>
    </form>
  );
}
