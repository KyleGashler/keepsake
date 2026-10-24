/// <reference types="expo/types" />
// oxlint-disable-next-line import/no-unassigned-import -- the Tailwind theme; Uniwind compiles it on import
import "../src/global.css";
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display/400Regular";
import { NunitoSans_400Regular } from "@expo-google-fonts/nunito-sans/400Regular";
import { NunitoSans_600SemiBold } from "@expo-google-fonts/nunito-sans/600SemiBold";
import { NunitoSans_700Bold } from "@expo-google-fonts/nunito-sans/700Bold";
import { useFonts } from "expo-font";
import { SplashScreen, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/auth/session";
import { useSession } from "../src/auth/session-context";
import {
  AccountErrorScreen,
  ChooseFamilyScreen,
  CreateFamilyScreen,
  EmailInUseScreen,
  Splash,
  VerifyEmailScreen,
} from "../src/components/account-screens";
import { AUTH_ACTION_PATH } from "../src/auth";
import { AuthActionScreen } from "../src/components/auth-action-screen";
import { SignedOutFlow } from "../src/components/auth-screens";
import { JoinScreen } from "../src/components/join-screen";
import { JOIN_PATH_PREFIX } from "../src/roles";
import { useColor } from "../src/theme";

// oxlint-disable-next-line react/only-export-components -- expo-router reads unstable_settings from the layout module
export const unstable_settings = {
  // A cold link straight to a memory still has the tabs underneath to go back to.
  anchor: "(tabs)",
};

// Hold the native splash until the fonts are in and the saved session has
// been read, so neither type nor the sign-in screen flashes.
void SplashScreen.preventAutoHideAsync();

/** If fonts haven't settled by now, show the app in fallback type rather than wait. */
const FONT_TIMEOUT_MS = 4000;

export default function RootLayout() {
  // Names must match the `--font-*` families in src/global.css.
  const [fontsLoaded, fontError] = useFonts({
    DMSerifDisplay_400Regular,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);
  const paper = useColor("paper");
  // A font error isn't fatal: text falls back to the platform's default face.
  const fontsReady = fontsLoaded || !!fontError || timedOut;

  useEffect(() => {
    if (fontsReady) return;
    const timer = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fontsReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: paper }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SessionProvider>{fontsReady ? <Gate /> : null}</SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * One screen per session phase; the app itself only once there's a family to
 * look at. The auth and account screens render *instead of* the navigator
 * rather than as routes, so whatever URL someone opened (a memory, later an
 * invite) is still the URL when they come through.
 */
function Gate() {
  const { phase } = useSession();
  const pathname = usePathname();
  const paper = useColor("paper");
  const [actionLinkDone, setActionLinkDone] = useState(false);
  const [joinDoneFor, setJoinDoneFor] = useState<string | null>(null);
  // The one exception to "one screen per phase": the page that emailed links
  // (verify, reset password) open. Whoever follows one may be signed out,
  // mid-restore, stuck on verify-email, or in the archive — and the link has
  // to work in all of them — so this path alone skips the phase switch until
  // the person is done with it. It renders outside the navigator, like the
  // screens below; once dismissed, the usual phase screen takes over at the
  // same URL, and app/auth/action.tsx sends anyone who reaches the archive
  // that way to its start.
  const onActionLink = pathname === AUTH_ACTION_PATH && !actionLinkDone;
  // The same exception for invite links, so an invitee can be signed out or
  // have no family yet and still land on the invitation rather than on sign-in
  // or Create Family. The account-problem phases (verify-email takeover,
  // email in use, can't reach the API) still come first: nothing on the join
  // screen can get past them, and the URL is still here once they're solved.
  const joinToken = pathname.startsWith(JOIN_PATH_PREFIX) ? pathname.slice(JOIN_PATH_PREFIX.length) : null;
  const onJoinLink =
    joinToken !== null && joinToken !== "" && joinDoneFor !== pathname && !(phase === "verifyEmail" || phase === "emailInUse" || phase === "accountError");

  useEffect(() => {
    if (phase !== "restoring" || onActionLink) SplashScreen.hide();
  }, [phase, onActionLink]);

  if (onActionLink) return <AuthActionScreen onDone={() => setActionLinkDone(true)} />;
  if (onJoinLink) return <JoinScreen token={joinToken} onDone={() => setJoinDoneFor(pathname)} />;

  switch (phase) {
    case "restoring":
    case "loadingAccount":
      return <Splash />;
    case "signedOut":
      return <SignedOutFlow />;
    case "verifyEmail":
      return <VerifyEmailScreen />;
    case "emailInUse":
      return <EmailInUseScreen />;
    case "accountError":
      return <AccountErrorScreen />;
    case "createFamily":
      return <CreateFamilyScreen />;
    case "chooseFamily":
      return <ChooseFamilyScreen />;
    default:
      // "ready"
      return (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: paper },
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* Search and Family Hub are global, so they present over everything. */}
          <Stack.Screen name="search" options={{ presentation: "modal" }} />
          <Stack.Screen name="family" options={{ presentation: "modal" }} />
        </Stack>
      );
  }
}
