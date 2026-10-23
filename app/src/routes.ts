import { router, type Href } from "expo-router";
import type { PillarKey } from "./api";

/**
 * Every Library screen lives in a stack nested in the Library tab
 * (app/(tabs)/library/), so the tab bar stays visible and the tab keeps its
 * own history. Memory detail is on the root stack, over the tabs.
 */
export const routes = {
  library: "/library",
  children: "/library/children",
  child: (childId: string) => `/library/children/${childId}`,
  collection: (collectionId: string) => `/library/collections/${collectionId}`,
  /** Arrival Stories and Family Life; Child Profiles is `children`. */
  pillar: (pillar: PillarKey) => `/library/pillar/${pillar}`,
  memory: (memoryId: string) => `/memory/${memoryId}`,
  person: (personId: string) => `/person/${personId}`,
} as const;

/**
 * Open a Library screen from outside the Library tab (search, a memory, a
 * person). `navigate` returns to the tabs rather than stacking a second copy of
 * them over the current screen. The Library stack becomes [landing, target]:
 * `withAnchor` puts the landing underneath so back has somewhere to go
 * (without it the stack is just the target, and back leaves the tab). The
 * place you were in Library before is not kept across this jump. On the web
 * the URL gains `?initial=false`, which is expo-router's and harmless.
 * Inside the Library stack, use `router.push` instead.
 */
export function openInLibrary(href: string) {
  router.navigate(href, { withAnchor: true });
}

/**
 * Back to a screen's named parent ("‹ Child Profiles", "‹ Banks"), however the
 * screen was reached. In-app, the parent is underneath and this pops to it,
 * as back would. On a cold deep link the Library stack is only [landing,
 * screen] (its anchor), so plain back would skip the parent; `dismissTo`
 * doesn't find it and replaces the screen with it instead — and that
 * parent's own back row does the same, so a cold link backs out one level at
 * a time, the way the labels promise.
 */
export function backTo(parent: Href) {
  router.dismissTo(parent);
}

/**
 * Back to wherever this screen was opened from, or `fallback` when there's
 * nothing underneath. For screens with no single parent — a missing
 * collection could have been reached from a child, a pillar or search.
 */
export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/**
 * Switching family or signing out: back to Home first, so nothing left on
 * screen belongs to the family (or the person) being left.
 */
export function leaveFor(change: () => void) {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/");
  change();
}
