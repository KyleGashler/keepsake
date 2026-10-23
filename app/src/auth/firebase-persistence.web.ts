import { browserLocalPersistence } from "firebase/auth";

/**
 * Web: keep the Firebase session in localStorage, so a reload or a new tab
 * stays signed in. (Metro resolves this file instead of
 * firebase-persistence.ts when bundling for the web.)
 */
export const persistence = browserLocalPersistence;
