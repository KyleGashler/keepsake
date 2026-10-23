import { Redirect } from "expo-router";

/**
 * /join/<token> — where invite links land. The invitation itself is drawn by
 * the root layout's Gate (src/components/join-screen.tsx), outside the
 * navigator, so it works signed out and before a first family. This route is
 * only reached once the person is done there and in an archive — the one
 * they just joined, or the one they were already in — so start them at home.
 */
export default function JoinRoute() {
  return <Redirect href="/" />;
}
