import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Sparkle } from "../../src/components/journey";
import { TabBar } from "../../src/components/tab-bar";
import { useColor } from "../../src/theme";

/**
 * Five primary destinations, Capture in the middle as a raised disc (its icon
 * is drawn by the tab bar). Library holds its own stack (library/_layout.tsx),
 * so the bar stays put while you browse and re-tapping Library pops to its root.
 */
export default function TabsLayout() {
  const paper = useColor("paper");
  return (
    <Tabs
      tabBar={({ state, descriptors, navigation, insets }) => (
        <TabBar state={state} descriptors={descriptors} navigation={navigation} insets={insets} />
      )}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: paper } }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="capture" options={{ title: "Capture" }} />
      <Tabs.Screen
        name="timeline"
        options={{
          title: "Timeline",
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size + 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mosaic"
        options={{
          title: "Mosaic",
          tabBarIcon: ({ color, size }) => <Sparkle size={size} color={color} strokeWidth={1.5} />,
        }}
      />
    </Tabs>
  );
}
