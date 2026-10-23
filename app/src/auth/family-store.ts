import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * Which family the app is looking at. Lives outside React so the API client
 * can put it on every request as `x-family-id`; screens read it through
 * `useFamilyId()` and refetch when it changes. Remembered across launches so
 * someone in two families isn't asked every time.
 */
const STORAGE_KEY = "keepsake.familyId";

let current: string | null = null;
const listeners = new Set<() => void>();

export function getFamilyId() {
  return current;
}

/**
 * `remember: false` changes only this session — signing out forgets the
 * family in memory but keeps the choice for the next sign-in, where it is
 * checked against that account's memberships before it's used.
 */
export function setFamilyId(familyId: string | null, { remember = true } = {}) {
  if (familyId === current) return;
  current = familyId;
  for (const listener of listeners) listener();
  if (!remember) return;
  void (async () => {
    try {
      await (familyId ? AsyncStorage.setItem(STORAGE_KEY, familyId) : AsyncStorage.removeItem(STORAGE_KEY));
    } catch {
      // Not remembered; the picker asks again next launch.
    }
  })();
}

/** The family chosen last time, if any — the caller checks it's still one of theirs. */
export async function rememberedFamilyId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFamilyId() {
  return useSyncExternalStore(subscribe, getFamilyId, getFamilyId);
}
