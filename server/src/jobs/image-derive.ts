import { needsRenditions, renditionsMade } from "../lib/pictures.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { isOriginalKey } from "../storage/StorageProvider.js";
import type { JobHandler } from "./JobQueue.js";
import { renderAndStore } from "./media-derive.js";

export function imageDeriveHandler(): JobHandler<"image.derive"> {
  return {
    async run({ familyId, storageKey: key }, ctx) {
      if (!isOriginalKey(key) || !keyBelongsTo(key, familyId)) {
        ctx.log.error({ key, familyId }, "image.derive: not an original in the family's prefix; skipped");
        return;
      }
      if (!(await needsRenditions(familyId, key))) return;

      const { rendered, written } = await renderAndStore(key);
      const holders = await renditionsMade(familyId, key, written);

      ctx.log.info(
        { key, holders, sizes: rendered.renditions.map((r) => `${r.kind}:${r.width}x${r.height}`) },
        holders ? "picture derived" : "picture derived, but no profile photo or cover holds it now; queued for deleteIfUnused",
      );
    },

    async onFinalFailure({ storageKey }, err, ctx) {
      ctx.log.error({ storageKey, err }, "image.derive gave up; the original is served in place of renditions");
    },
  };
}
