/// <reference types="expo/types" />
// oxlint-disable-next-line import/no-unassigned-import -- the Tailwind theme; Uniwind compiles it on import
import "../src/global.css";
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display/400Regular";
import { NunitoSans_400Regular } from "@expo-google-fonts/nunito-sans/400Regular";
import { NunitoSans_600SemiBold } from "@expo-google-fonts/nunito-sans/600SemiBold";
import { NunitoSans_700Bold } from "@expo-google-fonts/nunito-sans/700Bold";
import { QueryClientProvider } from "@tanstack/react-query";
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
import { queryClient } from "../src/query";
import { JOIN_PATH_PREFIX } from "../src/roles";
import { useColor } from "../src/theme";

// oxlint-disable-next-line react/only-export-components -- expo-router reads unstable_settings from the layout module
export const unstable_settings = {
  // A cold link straight to a memory still has the tabs underneath to go back to.
  anchor: "(tabs)",
};

// Hold the native splash until fonts and the saved session are in, so neither flashes.
void SplashScreen.preventAutoHideAsync();

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
        {/* Above the session, which reads and forgets through it. */}
        <QueryClientProvider client={queryClient}>
          <SessionProvider>{fontsReady ? <Gate /> : null}</SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Auth and account screens render instead of the navigator, not as routes, so the URL
// someone opened is still the URL when they come through.
function Gate() {
  const { phase } = useSession();
  const pathname = usePathname();
  const paper = useColor("paper");
  const [actionLinkDone, setActionLinkDone] = useState(false);
  const [joinDoneFor, setJoinDoneFor] = useState<string | null>(null);
  // Emailed links (verify, reset password) must work in every phase, so this path skips
  // the phase switch until dismissed.
  const onActionLink = pathname === AUTH_ACTION_PATH && !actionLinkDone;
  // Invite links skip sign-in and Create Family too, but not the account-problem phases,
  // which nothing on the join screen can get past.
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
      return (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: paper },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" options={{ presentation: "modal" }} />
          <Stack.Screen name="family" options={{ presentation: "modal" }} />
        </Stack>
      );
  }
}
