export type DraftAsset = {
  uri: string;
  name: string;
  mime: string;
  width?: number;
  height?: number;
  bytes?: number;
  durationS?: number;
};

// blob:/data: URIs are far too long for route params, so picked media ride from Capture to compose here.
let pending: DraftAsset[] = [];

export const draft = {
  set(assets: DraftAsset[]) {
    pending = assets;
  },
  hasMedia() {
    return pending.length > 0;
  },
  take() {
    const assets = pending;
    pending = [];
    return assets;
  },
};

