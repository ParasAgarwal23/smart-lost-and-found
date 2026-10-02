import "server-only";

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

export async function generateEmbedding(
  itemName: string,
  description: string,
): Promise<number[]> {
  // Share model initialization across calls, including concurrent requests.
  extractorPromise ??= pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    device: "cpu",
    dtype: "fp32",
  }).catch((error: unknown) => {
    extractorPromise = undefined;
    throw error;
  });

  const extractor = await extractorPromise;
  const output = await extractor(`${itemName.trim()}\n${description.trim()}`, {
    pooling: "mean",
    normalize: true,
  });
  const embedding = Array.from(output.data);
  if (embedding.length !== 384 || !embedding.every(Number.isFinite)) {
    throw new Error("Expected an embedding with 384 finite values.");
  }
  return embedding;
}
