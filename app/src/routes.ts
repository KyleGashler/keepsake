import { router } from "expo-router";
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
