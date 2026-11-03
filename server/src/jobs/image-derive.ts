import { needsRenditions, renditionsMade } from "../lib/pictures.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { isOriginalKey } from "../storage/StorageProvider.js";
import type { JobHandler } from "./JobQueue.js";
import { renderAndStore } from "./media-derive.js";

/**
 * `image.derive`: THUMB (400 px) and DISPLAY (1600 px) for a Picture that
 * isn't a Media row — a child's profile photo or a Library pillar cover.
 * Same rendering and same keys as `media.derive`
 * (`<familyId>/<uploadId>/thumb.jpg`, `display.jpg`, beside the Original,
 * which is only read); no EXIF date or palette, since nothing here uses
 * them. Queued by `setPicture` (lib/pictures.ts).
 *
 * The job is keyed by the storage key, not by a Holder. It renders only
 * while some Holder still lacks the Renditions (`needsRenditions`), then
 * tells the Picture module they exist (`renditionsMade`), which marks every
 * Holder of the key or, when nothing holds it any more, queues the new
 * files for deletion. Idempotent: a re-render replaces the same two files.
 */
export function imageDeriveHandler(): JobHandler<"image.derive"> {
  return {
    async run({ familyId, storageKey: key }, ctx) {
      if (!isOriginalKey(key) || !keyBelongsTo(key, familyId)) {
        ctx.log.error({ key, familyId }, "image.derive: not an original in the family's prefix; skipped");
        return;
      }
      if (!(await needsRenditions(familyId, key))) return; // replaced, deleted, or already done

      const { rendered, written } = await renderAndStore(key);
      const holders = await renditionsMade(familyId, key, written);

      ctx.log.info(
        { key, holders, sizes: rendered.renditions.map((r) => `${r.kind}:${r.width}x${r.height}`) },
        holders ? "picture derived" : "picture derived, but no profile photo or cover holds it now; queued for deleteIfUnused",
      );
    },

    async onFinalFailure({ storageKey }, err, ctx) {
      // The picture still shows (as its original).
      ctx.log.error({ storageKey, err }, "image.derive gave up; the original is served in place of renditions");
    },
  };
}
