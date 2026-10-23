import AsyncStorage from "@react-native-async-storage/async-storage";
import { getReactNativePersistence } from "firebase/auth";

/**
 * Native (iOS/Android, Expo Go included): keep the Firebase session in
 * AsyncStorage so a cold start stays signed in. Without it the JS SDK falls
 * back to memory and signs everyone out on every launch.
 *
 * `getReactNativePersistence` only exists in @firebase/auth's react-native
 * build. Metro picks that build through the package's `react-native` export
 * condition, and TypeScript sees its types through the same condition
 * (expo/tsconfig.base sets `customConditions: ["react-native"]`). The web
 * build has no such export — firebase-persistence.web.ts takes its place.
 */
export const persistence = getReactNativePersistence(AsyncStorage);
