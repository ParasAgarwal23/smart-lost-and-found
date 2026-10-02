import "server-only";

import { query } from "@/lib/db";

export type UserLostReport = {
  Lost_ID: number;
  Item_Name: string | null;
};

export type PotentialMatch = {
  Found_ID: number;
  Item_Name: string | null;
  Description: string | null;
  Cosine_Similarity: number;
};

// userId must come from the authenticated session in server code.
export async function getUserLostReports(userId: number): Promise<UserLostReport[]> {
  const result = await query<UserLostReport>(
    `SELECT "Lost_ID", "Item_Name" FROM public."LOST_REPORT"
     WHERE "User_ID" = $1 ORDER BY "Date_Lost" DESC NULLS LAST, "Lost_ID" DESC`,
    [userId],
  );
  return result.rows;
}

export async function getPotentialMatches(userId: number, lostId: unknown): Promise<{
  matches: PotentialMatch[];
  error: string | null;
}> {
  if (typeof lostId !== "string" || !/^-?\d+$/.test(lostId)) {
    return { matches: [], error: "Choose a valid lost report." };
  }
  const id = Number(lostId);
  if (!Number.isInteger(id) || id < -2147483648 || id > 2147483647) {
    return { matches: [], error: "Choose a valid lost report." };
  }

  try {
    const report = await query<{ Has_Embedding: boolean }>(
      `SELECT ("Embedding" IS NOT NULL AND public.vector_norm("Embedding") > 0) AS "Has_Embedding"
       FROM public."LOST_REPORT" WHERE "Lost_ID" = $1 AND "User_ID" = $2`,
      [id, userId],
    );
    if (report.rows.length !== 1) {
      return { matches: [], error: "Lost report not found or unavailable to your account." };
    }
    if (!report.rows[0].Has_Embedding) {
      return { matches: [], error: "This lost report has no usable embedding. Potential matching is unavailable." };
    }

    const result = await query<PotentialMatch>(
      `SELECT "Found_ID", "Item_Name", "Description", "Cosine_Similarity"
       FROM public.find_potential_matches($1::integer, $2::integer)`,
      [id, 10],
    );
    return { matches: result.rows, error: null };
  } catch {
    return { matches: [], error: "Unable to load potential matches. Please try again later." };
  }
}
