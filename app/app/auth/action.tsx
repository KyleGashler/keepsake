import { Redirect } from "expo-router";

/**
 * /auth/action — where emailed sign-in links land. The page itself is drawn
 * by the root layout's Gate (src/components/auth-action-screen.tsx), outside
 * the navigator, so it works signed out too. This route is only reached
 * after the person has finished there and is in the archive: the link has
 * done its job, so start them at home.
 */
export default function AuthActionRoute() {
  return <Redirect href="/" />;
}
