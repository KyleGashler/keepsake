import { Readable } from "node:stream";
import { z } from "zod";
import { errorMessage } from "../../lib/errors.js";
import { storage } from "../../storage/index.js";
import { TranscriptionError, type Transcriber, type TranscriptResult } from "../Transcriber.js";

const ENDPOINT = "https://api.deepgram.com/v1/listen";

/** Long enough for Deepgram to fetch and process a 100 MB original. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** How long the presigned URL Deepgram fetches from stays valid. */
const READ_URL_TTL_SECONDS = 15 * 60;

// The parts of a pre-recorded `/v1/listen` response this reads, innermost first.
const sentence = z.object({ text: z.string().optional() });
const paragraph = z.object({ speaker: z.number().optional(), sentences: z.array(sentence).optional() });
const alternative = z.object({
  transcript: z.string().optional(),
  paragraphs: z.object({ transcript: z.string().optional(), paragraphs: z.array(paragraph).optional() }).optional(),
});
const channel = z.object({ alternatives: z.array(alternative).optional() });
const listenResponse = z.object({
  metadata: z.object({ duration: z.number().optional() }).optional(),
  results: z.object({ channels: z.array(channel).optional() }).optional(),
});

type ListenResponse = z.infer<typeof listenResponse>;

/**
 * Deepgram pre-recorded transcription over plain `fetch` — no SDK.
 *
 * Deepgram takes either a URL it fetches itself or the raw bytes. A bucket's
 * presigned URL is the better path (the API process never touches the bytes),
 * so that's used whenever storage hands back an absolute https URL. The local
 * provider's URLs are relative paths on this API, which Deepgram can't reach,
 * so there the object is streamed as the request body instead.
 *
 * Request: `model` (nova-3 by default), `smart_format` (punctuation,
 * numerals, paragraphs), `diarize` (speaker per paragraph), `paragraphs`.
 */
export class DeepgramTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly model = "nova-3",
  ) {}

  async transcribe({ key, mimeType }: { key: string; mimeType: string }): Promise<TranscriptResult> {
    const params = new URLSearchParams({
      model: this.model,
      smart_format: "true",
      diarize: "true",
      paragraphs: "true",
    });

    const readUrl = await storage().getReadUrl(key, READ_URL_TTL_SECONDS);
    const viaUrl = /^https:\/\//i.test(readUrl);
    const init: RequestInit & { duplex?: "half" } = {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": viaUrl ? "application/json" : bodyContentType(mimeType),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (viaUrl) {
      init.body = JSON.stringify({ url: readUrl });
    } else {
      init.body = Readable.toWeb(await storage().stream(key));
      // Node's fetch refuses a streamed body without this.
      init.duplex = "half";
    }

    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}?${params.toString()}`, init);
    } catch (err) {
      throw new TranscriptionError(`Deepgram request failed: ${errorMessage(err)}`, true, { cause: err });
    }

    if (!res.ok) {
      const detail = await errorDetail(res);
      // 4xx means this request will never work (bad key, unreadable audio,
      // unreachable URL) — except 429, which is Deepgram asking us to wait.
      const retryable = res.status === 429 || res.status >= 500;
      throw new TranscriptionError(`Deepgram ${res.status}: ${detail}`, retryable);
    }

    const body = listenResponse.safeParse(await res.json());
    if (!body.success) throw new TranscriptionError(`Deepgram response unreadable: ${body.error.message}`, false);
    return formatResult(body.data);
  }
}

/**
 * The type declared on a streamed body. Deepgram identifies the container
 * from the bytes and transcribes a video's audio track, so the header is a
 * hint. Audio keeps its real type. Video goes as `deepgram/audio+video`, the
 * type Deepgram's own SDKs send for every file upload, rather than
 * `video/quicktime` or `video/webm`, which its format docs never list.
 * (The presigned-URL path sends JSON and is unaffected.)
 */
export function bodyContentType(mimeType: string): string {
  return mimeType.startsWith("video/") ? "deepgram/audio+video" : mimeType;
}

export function formatResult(body: ListenResponse): TranscriptResult {
  const alt = body.results?.channels?.[0]?.alternatives?.[0];
  const durationS = body.metadata?.duration;
  const paragraphs = (alt?.paragraphs?.paragraphs ?? [])
    .map((p) => ({
      speaker: p.speaker,
      text: (p.sentences ?? [])
        .map((s) => s.text?.trim() ?? "")
        .filter(Boolean)
        .join(" "),
    }))
    .filter((p) => p.text);

  // Deepgram numbers speakers from 0 in the order its model clusters them;
  // relabel by first appearance so "Speaker 1" is whoever talks first.
  const labels = new Map<number, number>();
  for (const p of paragraphs) {
    if (typeof p.speaker === "number" && !labels.has(p.speaker)) labels.set(p.speaker, labels.size + 1);
  }

  if (labels.size > 1) {
    const turns: { label: number; text: string }[] = [];
    for (const p of paragraphs) {
      const label = p.speaker === undefined ? 0 : (labels.get(p.speaker) ?? 0);
      const last = turns[turns.length - 1];
      if (last && last.label === label) last.text += ` ${p.text}`;
      else turns.push({ label, text: p.text });
    }
    const text = turns.map((t) => (t.label ? `Speaker ${t.label}: ${t.text}` : t.text)).join("\n\n");
    return { text, durationS, speakers: labels.size };
  }

  // One voice: plain paragraphs, no labels. (paragraphs.transcript is not
  // used because with diarize on it carries Deepgram's own 0-based labels.)
  const text = paragraphs.length
    ? paragraphs.map((p) => p.text).join("\n\n")
    : (alt?.transcript ?? "").trim();
  return { text, durationS, speakers: labels.size || undefined };
}

async function errorDetail(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const parsed: { err_msg?: string; message?: string; err_code?: string } = JSON.parse(raw);
    return parsed.err_msg ?? parsed.message ?? parsed.err_code ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300) || res.statusText;
  }
}
