export type DraftAsset = {
  uri: string;
  name: string;
  mime: string;
  width?: number;
  height?: number;
  /** As the picker reports it — lets compose refuse an oversized file before uploading. */
  bytes?: number;
  /** Whole seconds, from the recorder — audio only. */
  durationS?: number;
};

/**
 * Hand-off between Capture and the compose screen. Picked media can be blob:
 * or data: URIs that are far too long for route params, so they ride here.
 */
let pending: DraftAsset[] = [];

export const draft = {
  set(assets: DraftAsset[]) {
    pending = assets;
  },
  take() {
    const assets = pending;
    pending = [];
    return assets;
  },
};
