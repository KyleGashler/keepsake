import { logger } from "../lib/logger.js";
import { DeepgramTranscriber } from "./impl/DeepgramTranscriber.js";
import { StubTranscriber } from "./impl/StubTranscriber.js";
import type { Transcriber } from "./Transcriber.js";

export { TranscriptionError } from "./Transcriber.js";
export type { Transcriber, TranscriptResult } from "./Transcriber.js";

/**
 * Deepgram when `DEEPGRAM_API_KEY` is set, otherwise the stub. The stub is
 * never an error, even in production: an archive without a key still works,
 * its clips just carry sample text — and the boot log says so.
 */
export function createTranscriber(): Transcriber {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (apiKey) return new DeepgramTranscriber(apiKey, process.env.DEEPGRAM_MODEL?.trim() || undefined);
  const log = process.env.NODE_ENV === "production" ? logger.warn.bind(logger) : logger.info.bind(logger);
  log("DEEPGRAM_API_KEY is unset; transcripts come from the stub transcriber");
  return new StubTranscriber();
}
