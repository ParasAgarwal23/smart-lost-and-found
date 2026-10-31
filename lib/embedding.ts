import "server-only";

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

// The one embedding pipeline: all-MiniLM-L6-v2, mean pooling, normalised, 384
// values. Reports (generateEmbedding) and search text (semantic search) both
// use it, so their vectors are directly comparable.
export async function embedText(text: string): Promise<number[]> {
  // Share model initialization across calls, including concurrent requests.
  extractorPromise ??= pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    device: "cpu",
    dtype: "fp32",
  }).catch((error: unknown) => {
    extractorPromise = undefined;
    throw error;
  });

  const extractor = await extractorPromise;
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });
  const embedding = Array.from(output.data);
  if (embedding.length !== 384 || !embedding.every(Number.isFinite)) {
    throw new Error("Expected an embedding with 384 finite values.");
  }
  return embedding;
}

export async function generateEmbedding(
  itemName: string,
  description: string,
): Promise<number[]> {
  return embedText(`${itemName.trim()}\n${description.trim()}`);
}
