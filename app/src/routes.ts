import { router, type Href } from "expo-router";
import type { Collection, PillarKey } from "./api";
import { draft, type DraftAsset } from "./draft";

export const routes = {
  library: "/library",
  children: "/library/children",
  child: (childId: string) => `/library/children/${childId}`,
  collection: (collectionId: string) => `/library/collections/${collectionId}`,
  birthdays: (collectionId: string) => `/library/birthdays/${collectionId}`,
  birthday: (collectionId: string) => `/library/birthday/${collectionId}`,
  looseBirthdays: (birthdaysId: string, from?: { id: string; birthday: number }) =>
    `/library/birthday-moments/${birthdaysId}${from ? `?birthday=${from.birthday}&from=${from.id}` : ""}`,
  pillar: (pillar: PillarKey) => `/library/pillar/${pillar}`,
  memory: (memoryId: string) => `/memory/${memoryId}`,
  recordInto: (memoryId: string) => `/capture/record?memoryId=${encodeURIComponent(memoryId)}`,
  person: (personId: string) => `/person/${personId}`,
} as const;

export function collectionHref(c: Pick<Collection, "id" | "kind" | "birthday">) {
  if (c.kind === "birthdays") return routes.birthdays(c.id);
  if (c.birthday !== null) return routes.birthday(c.id);
  return routes.collection(c.id);
}

// `withAnchor` puts the Library landing under the target so back stays in the tab.
export function openInLibrary(href: string) {
  router.navigate(href, { withAnchor: true });
}

// On a cold deep link the parent isn't in the stack; `dismissTo` then replaces this screen with it.
export function backTo(parent: Href) {
  router.dismissTo(parent);
}

export type ComposeParams = { prompt?: string; collectionId?: string };

export function composeParams({ prompt, collectionId }: ComposeParams) {
  return { ...(prompt ? { prompt } : {}), ...(collectionId ? { collectionId } : {}) };
}

export function handToCompose(assets: DraftAsset[], params: ComposeParams) {
  draft.set(assets);
  router.dismissTo({ pathname: "/capture/compose", params: composeParams(params) });
}

export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

// Home first, so nothing left on screen belongs to the family or person being left.
export function leaveFor(change: () => void) {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/");
  change();
}
