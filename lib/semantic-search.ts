import "server-only";

import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { embedText } from "@/lib/embedding";
import type { SearchReport } from "@/lib/search";

export const SEMANTIC_RESULT_LIMIT = 12;

const optionalId = z.union([
  z.literal(""),
  z.string().regex(/^-?\d+$/).transform(Number)
    .pipe(z.number().int().min(-2147483648).max(2147483647)),
]).default("").transform((value) => value === "" ? null : value);

const semanticSchema = z.object({
  // Bounded so an anonymous request cannot ask the model for large inputs.
  text: z.string().trim().min(3).max(200),
  category: optionalId,
  location: optionalId,
  type: z.enum(["", "Both", "Lost", "Found"]).default("Both").transform((value) => value || "Both"),
});

export type SemanticReport = SearchReport & { Similarity: number };

// Approximate nearest-neighbour search over both report tables.
// Each branch is "ORDER BY Embedding <=> query LIMIT k" over a single table, the
// shape PostgreSQL can answer from that table's HNSW index (vector_cosine_ops,
// db/vector_search.sql). Category and location names are joined only after the
// branches, so the join cannot prevent the index scan. $1 is the query vector,
// $2/$3 optional category/location, $4 the limit, $5 Both/Lost/Found.
// Exported so tests/vector-index.mjs runs EXPLAIN on exactly this statement.
export const SEMANTIC_SEARCH_SQL = `WITH nearest AS (
  (SELECT 'Found'::text AS "Report_Type", f."Found_ID" AS "Report_ID", f."Item_Name", f."Description",
          f."Category_ID", f."Location_ID", f."Date_Found" AS report_date,
          f."Embedding" OPERATOR(public.<=>) $1::public.vector(384) AS distance
   FROM public."FOUND_REPORT" f
   WHERE $5::text <> 'Lost' AND f."Embedding" IS NOT NULL
     AND ($2::integer IS NULL OR f."Category_ID" = $2) AND ($3::integer IS NULL OR f."Location_ID" = $3)
   ORDER BY f."Embedding" OPERATOR(public.<=>) $1::public.vector(384)
   LIMIT $4)
  UNION ALL
  (SELECT 'Lost'::text, l."Lost_ID", l."Item_Name", l."Description",
          l."Category_ID", l."Location_ID", l."Date_Lost",
          l."Embedding" OPERATOR(public.<=>) $1::public.vector(384)
   FROM public."LOST_REPORT" l
   WHERE $5::text <> 'Found' AND l."Embedding" IS NOT NULL
     AND ($2::integer IS NULL OR l."Category_ID" = $2) AND ($3::integer IS NULL OR l."Location_ID" = $3)
   ORDER BY l."Embedding" OPERATOR(public.<=>) $1::public.vector(384)
   LIMIT $4)
)
SELECT n."Report_ID", n."Report_Type", n."Item_Name", n."Description", c."Category_Name",
       loc."Location_Name", loc."Building", n.report_date::text AS "Report_Date",
       (1 - n.distance)::double precision AS "Similarity"
FROM nearest n
JOIN public."CATEGORY" c ON c."Category_ID" = n."Category_ID"
JOIN public."LOCATION" loc ON loc."Location_ID" = n."Location_ID"
ORDER BY n.distance, n."Report_Type", n."Report_ID"
LIMIT $4`;

// "Similar meaning" search: embeds the visitor's words with the same model as
// the reports, then ranks lost and found reports by cosine similarity. A hint
// for finding differently worded reports, never proof that items match.
export async function semanticSearch(input: unknown): Promise<{
  reports: SemanticReport[];
  error: string | null;
}> {
  const parsed = semanticSchema.safeParse(input);
  if (!parsed.success) {
    const textIssue = parsed.error.issues.some((issue) => issue.path[0] === "text");
    return { reports: [], error: textIssue ? "Describe the item in 3 to 200 characters to search by meaning." : "Choose valid search filters." };
  }
  const filters = parsed.data;

  let vector: string;
  try {
    vector = JSON.stringify(await embedText(filters.text));
  } catch {
    return { reports: [], error: "Unable to search by meaning right now. Try exact words instead." };
  }

  try {
    const result = await withTransaction(async (client) => {
      // With a category/location filter, keep scanning the HNSW graph until
      // enough rows pass the filter (pgvector 0.8 iterative index scans); the
      // final ORDER BY restores exact order among the candidates.
      await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
      return client.query<SemanticReport>(SEMANTIC_SEARCH_SQL,
        [vector, filters.category, filters.location, SEMANTIC_RESULT_LIMIT, filters.type]);
    });
    return { reports: result.rows, error: null };
  } catch {
    return { reports: [], error: "Unable to search by meaning right now. Try exact words instead." };
  }
}
