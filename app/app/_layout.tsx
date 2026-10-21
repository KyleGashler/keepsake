import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display/400Regular";
import { NunitoSans_400Regular } from "@expo-google-fonts/nunito-sans/400Regular";
import { NunitoSans_600SemiBold } from "@expo-google-fonts/nunito-sans/600SemiBold";
import { NunitoSans_700Bold } from "@expo-google-fonts/nunito-sans/700Bold";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "../src/theme";

// oxlint-disable-next-line react/only-export-components -- expo-router reads unstable_settings from the layout module
export const unstable_settings = {
  // A cold link straight to a memory still has the tabs underneath to go back to.
  anchor: "(tabs)",
};

// Hold the native splash until the fonts are in, so type never reflows.
void SplashScreen.preventAutoHideAsync();

/** If fonts haven't settled by now, show the app in fallback type rather than wait. */
const FONT_TIMEOUT_MS = 4000;

export default function RootLayout() {
  // Names must match `fonts` in src/theme.ts.
  const [fontsLoaded, fontError] = useFonts({
    DMSerifDisplay_400Regular,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);
  // A font error isn't fatal: the web falls back through the CSS stack in theme.ts.
  const ready = fontsLoaded || !!fontError || timedOut;

  useEffect(() => {
    if (ready) {
      SplashScreen.hide();
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* Search and Family Hub are global, so they present over everything. */}
          <Stack.Screen name="search" options={{ presentation: "modal" }} />
          <Stack.Screen name="family" options={{ presentation: "modal" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
