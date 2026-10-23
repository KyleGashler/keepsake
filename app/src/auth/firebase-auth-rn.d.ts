import type { Persistence, ReactNativeAsyncStorage } from "firebase/auth";

/**
 * `getReactNativePersistence` is real at runtime on native — Metro resolves
 * the firebase auth package through its `react-native` export condition to
 * the RN build, which exports it. TypeScript doesn't see it: the package's exports map lists
 * a top-level `types` entry (the browser API) before the `react-native`
 * condition, and TypeScript takes the first match. Declare the one missing
 * export rather than reach into the package's dist paths.
 */
declare module "firebase/auth" {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
