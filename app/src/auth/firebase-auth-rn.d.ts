import type { Persistence, ReactNativeAsyncStorage } from "firebase/auth";

// Real at runtime via the `react-native` export condition, but the package lists its browser
// `types` entry first and TypeScript takes the first match.
declare module "firebase/auth" {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
