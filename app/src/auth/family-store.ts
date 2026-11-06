import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "littlebylittle.familyId";

let current: string | null = null;
const listeners = new Set<() => void>();

export function getFamilyId() {
  return current;
}

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

// Unchecked: the caller must confirm it's still one of the user's families.
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
