/**
 * Speech-to-text over one stored original.
 *
 * Takes a storage key rather than bytes or a URL: an implementation decides
 * for itself whether to hand its provider a read URL or stream the object,
 * because that depends on where storage lives (a bucket is reachable from the
 * internet, a local volume isn't).
 */
export interface Transcriber {
  transcribe(input: { key: string; mimeType: string }): Promise<TranscriptResult>;
}

export interface TranscriptResult {
  /**
   * Readable text. With more than one speaker detected, one paragraph per
   * turn, each prefixed `Speaker N: ` (1-based) and separated by a blank line.
   * Empty when nothing was said.
   */
  text: string;
  /** Length of the audio, in seconds, when the provider reports it. */
  durationS?: number;
  /** Distinct speakers detected, when the provider diarizes. */
  speakers?: number;
}

/**
 * A failure with an opinion on retrying. `retryable: false` means the same
 * request will fail the same way (bad credentials, unsupported audio), so the
 * job should stop rather than burn its attempts.
 */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TranscriptionError";
  }
}
