import { Redirect } from "expo-router";

// The invitation is drawn by the root layout's Gate, outside the navigator, so it works signed out;
// this route is only reached once they're done there and in an archive.
export default function JoinRoute() {
  return <Redirect href="/" />;
}
