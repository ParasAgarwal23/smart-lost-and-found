"use client";

import Link from "next/link";
import { Field } from "@/components/form";
import { formatDate } from "@/components/ui";

export type PickableClaim = { Claim_ID: number; Item_Name: string | null; Claim_Date: string | null };

// Chooses which of the user's claims a form applies to. When the previous page
// already named the claim, it is shown as a fixed summary (submitted through a
// hidden input) instead of asking the user to pick it again.
export default function ClaimPicker({ claims, initialClaimId, value, onChange, label, switchHref, describedBy, error }: {
  claims: PickableClaim[];
  initialClaimId?: number;
  value: string;
  onChange: (value: string) => void;
  label: string;
  switchHref: string;
  describedBy?: string;
  error?: string;
}) {
  const fixed = claims.find((claim) => claim.Claim_ID === initialClaimId);
  if (fixed) {
    return (
      <div className="field" role="group" aria-labelledby="claimId-label">
        <p id="claimId-label" className="label">{label}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-sunken/60 px-3.5 py-3">
          <p className="min-w-0">
            <span className="font-semibold">{fixed.Item_Name ?? "Unnamed item"}</span>
            <span className="text-sm text-ink-3"> · claimed {formatDate(fixed.Claim_Date)}</span>
          </p>
          {claims.length > 1 && <Link href={switchHref} className="link text-sm">Choose a different claim</Link>}
        </div>
        <input type="hidden" id="claimId" name="claimId" value={fixed.Claim_ID} />
        {error && <p id="claimId-error" className="field-error">{error}</p>}
      </div>
    );
  }
  return (
    <Field id="claimId" label={label} error={error}>
      <select id="claimId" name="claimId" required value={value} onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy} aria-invalid={!!error} className="input">
        <option value="" disabled>Select a claim</option>
        {claims.map((claim) => (
          <option key={claim.Claim_ID} value={claim.Claim_ID}>
            {claim.Item_Name ?? "Unnamed item"} — claimed {formatDate(claim.Claim_Date)}
          </option>
        ))}
      </select>
    </Field>
  );
}
