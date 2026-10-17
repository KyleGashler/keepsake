import type { Transcriber, TranscriptResult } from "../Transcriber.js";

const SAMPLE = [
  "Speaker 1: Do you remember the morning we drove up to the lake? You were asleep before we even left the driveway.",
  "Speaker 2: I remember the pancakes. Grandpa made them in the shape of the letters of my name, and he got the R backwards.",
  "Speaker 1: He did. And then you insisted on eating them in order.",
].join("\n\n");

/**
 * What runs when no provider is configured: a fixed two-speaker sample after
 * a short pause, so the PENDING → READY path is visible in the app without a
 * key or a network.
 */
export class StubTranscriber implements Transcriber {
  constructor(private readonly delayMs = 1500) {}

  async transcribe(): Promise<TranscriptResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { text: SAMPLE, speakers: 2 };
  }
}
