import type { Prisma } from "@prisma/client";
import { TranscriptionError, type Transcriber } from "../ai/index.js";
import { contentTypeForKey } from "../lib/mime.js";
import { prisma } from "../lib/prisma.js";
import { PermanentJobError, type JobHandler, type JobQueue } from "./JobQueue.js";

export const TRANSCRIBABLE_TYPES = ["AUDIO", "VIDEO"] as const;

/**
 * `ai.transcribe`: speech-to-text for one clip.
 *
 * Writes the clip's own `Media.transcript`, then offers the result to the
 * memory. `Memory.transcript` belongs to the family — they can type or edit
 * it at any time — so the job only writes it when it is empty or still holds
 * exactly what the job itself would have written from the other clips. Any
 * human edit makes it differ, and from then on the job leaves it alone.
 */
export function transcribeHandler(transcriber: Transcriber): JobHandler<"ai.transcribe"> {
  return {
    async run({ mediaId }, ctx) {
      const media = await prisma.media.findFirst({
        where: { id: mediaId, deletedAt: null, type: { in: [...TRANSCRIBABLE_TYPES] } },
      });
      if (!media) {
        ctx.log.info({ mediaId }, "clip gone or not transcribable; nothing to do");
        return;
      }
      // Already settled (a duplicate job, or a retry raced a success).
      if (media.transcriptStatus !== "PENDING") return;
      if (!media.storageKey) throw new PermanentJobError("Clip has no stored original to transcribe");

      const mimeType = media.mimeType ?? contentTypeForKey(media.storageKey);
      let result;
      try {
        result = await transcriber.transcribe({ key: media.storageKey, mimeType });
      } catch (err) {
        if (err instanceof TranscriptionError && !err.retryable) {
          throw new PermanentJobError(err.message, { cause: err });
        }
        throw err;
      }

      const text = result.text.trim();
      const durationS =
        media.durationS ?? (result.durationS && result.durationS > 0 ? Math.max(1, Math.round(result.durationS)) : null);

      await prisma.$transaction(async (tx) => {
        const updated = await tx.media.updateMany({
          where: { id: media.id, transcriptStatus: "PENDING" },
          data: { transcript: text, transcriptStatus: "READY", durationS },
        });
        if (updated.count === 0) return;
        await offerToMemory(tx, media.memoryId, media.id, media.transcript);
      });
      ctx.log.info({ mediaId, chars: text.length, speakers: result.speakers }, "clip transcribed");
    },

    async onFinalFailure({ mediaId }) {
      await prisma.media.updateMany({
        where: { id: mediaId, transcriptStatus: "PENDING" },
        data: { transcriptStatus: "FAILED" },
      });
    },
  };
}

/**
 * Rebuild the machine copy of the memory's transcript from its clips, in sort
 * order, if — and only if — no person has written it.
 */
async function offerToMemory(
  tx: Prisma.TransactionClient,
  memoryId: string,
  justFinished: string,
  previousText: string | null,
) {
  // Row lock: two clips of one memory finishing together must not each see
  // the other's half and both write.
  const [memory] = await tx.$queryRaw<{ transcript: string | null }[]>`
    SELECT transcript FROM "Memory" WHERE id = ${memoryId} FOR UPDATE`;
  if (!memory) return;

  const clips = await tx.media.findMany({
    where: {
      memoryId,
      deletedAt: null,
      type: { in: [...TRANSCRIBABLE_TYPES] },
      transcriptStatus: "READY",
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, transcript: true },
  });
  const join = (rows: typeof clips) =>
    rows
      .map((c) => c.transcript?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");

  const current = memory.transcript?.trim() ?? "";
  // What the job would have left there before this run: the same clips, with
  // this one's previous text (none on a first run; the old text on a re-run).
  const machineWrittenBefore = join(
    clips.map((c) => (c.id === justFinished ? { ...c, transcript: previousText } : c)),
  );
  if (current !== "" && current !== machineWrittenBefore) return; // a person's words

  const next = join(clips);
  if (next && next !== current) {
    await tx.memory.update({ where: { id: memoryId }, data: { transcript: next } });
  }
}

/** Queue transcription for clips that have just been set PENDING. */
export async function enqueueTranscriptions(queue: JobQueue, mediaIds: string[], db?: Prisma.TransactionClient) {
  for (const mediaId of mediaIds) await queue.enqueue("ai.transcribe", { mediaId }, { db });
}
