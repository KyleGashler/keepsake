import AsyncStorage from "@react-native-async-storage/async-storage";
import { getReactNativePersistence } from "firebase/auth";

// Without it the JS SDK keeps the session in memory and signs everyone out on every launch.
// Only the react-native build exports this; firebase-persistence.web.ts covers the web.
export const persistence = getReactNativePersistence(AsyncStorage);
