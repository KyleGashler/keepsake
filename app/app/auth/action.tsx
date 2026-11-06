import { Redirect } from "expo-router";

// The root layout's Gate draws /auth/action outside the navigator; this route is reached only once that's done.
export default function AuthActionRoute() {
  return <Redirect href="/" />;
}
