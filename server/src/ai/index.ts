import { logger } from "../lib/logger.js";
import { DeepgramTranscriber } from "./impl/DeepgramTranscriber.js";
import { StubTranscriber } from "./impl/StubTranscriber.js";
import { TranscriptionError, type Transcriber } from "./Transcriber.js";

export { TranscriptionError } from "./Transcriber.js";
export type { Transcriber, TranscriptResult } from "./Transcriber.js";

/**
 * Deepgram when `DEEPGRAM_API_KEY` is set, otherwise the stub — but only
 * outside production. The stub's sample dialogue must never be written into a
 * real family's memory, so production without a key fails each clip instead;
 * once the key is set, "Try again" on the memory page re-queues it.
 */
export function createTranscriber(): Transcriber {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (apiKey) return new DeepgramTranscriber(apiKey, process.env.DEEPGRAM_MODEL?.trim() || undefined);
  if (process.env.NODE_ENV === "production") {
    logger.warn("DEEPGRAM_API_KEY is unset; recordings will not be transcribed");
    return {
      async transcribe() {
        throw new TranscriptionError("Transcription is not configured (DEEPGRAM_API_KEY unset)", false);
      },
    };
  }
  logger.info("DEEPGRAM_API_KEY is unset; transcripts come from the stub transcriber");
  return new StubTranscriber();
}
