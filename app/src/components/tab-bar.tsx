import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCanContribute } from "../auth/session-context";
import { Ionicons } from "../styled";
import { useColor } from "../theme";

/** The route that gets the raised disc instead of an ordinary tab. */
const RAISED_ROUTE = "capture";

/**
 * Five tabs, icon over label, with Capture as a raised deep-teal disc in the
 * middle. The active tab's label goes bold with a short underline.
 *
 * Presses go through the navigator's `tabPress` event, so the stack inside a
 * tab still pops to its root when its (already focused) tab is tapped again.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  // Someone who can only view the family has nothing to capture into it, so
  // the disc isn't there (the Capture screen says why if reached by a link).
  const canContribute = useCanContribute();
  const ink = useColor("ink");
  return (
    <View
      className="bg-paper border-line pt-2"
      style={{ borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: Math.max(insets.bottom, 10) }}
    >
      <View className="flex-row items-end w-full max-w-page self-center">
        {state.routes.map((route, index) => {
          if (route.name === RAISED_ROUTE && !canContribute) return null;
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label = options.title ?? route.name;
          const raised = route.name === RAISED_ROUTE;

          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              testID={options.tabBarButtonTestID}
              className="flex-1 items-center gap-[3px] active:opacity-70"
            >
              {raised ? (
                // A 62pt disc, lifted half out of the bar (-mt: half its height and 4 more).
                <View className="w-[62px] h-[62px] rounded-full -mt-[35px] mb-0.5 bg-primary items-center justify-center border-[3px] border-paper shadow-card">
                  <Ionicons name="add" size={34} colorClassName="accent-on-primary" />
                </View>
              ) : (
                <View className="h-[30px] items-center justify-center">
                  {options.tabBarIcon?.({ focused, color: ink, size: 27 })}
                </View>
              )}
              <Text
                className={`text-[12.5px] text-ink ${focused ? "font-sans-bold" : "font-sans"}`}
                numberOfLines={1}
              >
                {label}
              </Text>
              <View className={`w-[18px] h-[2.5px] rounded-[2px] ${focused ? "bg-ink" : "bg-transparent"}`} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
