import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, MAX_WIDTH, shadow } from "../theme";

/** The route that gets the raised disc instead of an ordinary tab. */
const RAISED_ROUTE = "capture";
const DISC = 62;

/**
 * Five tabs, icon over label, with Capture as a raised deep-teal disc in the
 * middle. The active tab's label goes bold with a short underline.
 *
 * Presses go through the navigator's `tabPress` event, so the stack inside a
 * tab still pops to its root when its (already focused) tab is tapped again.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
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
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
            >
              {raised ? (
                <View style={styles.disc}>
                  <Ionicons name="add" size={34} color={colors.onPrimary} />
                </View>
              ) : (
                <View style={styles.icon}>
                  {options.tabBarIcon?.({ focused, color: colors.ink, size: 27 })}
                </View>
              )}
              <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
                {label}
              </Text>
              <View style={[styles.underline, focused && styles.underlineActive]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
  },
  tab: { flex: 1, alignItems: "center", gap: 3 },
  icon: { height: 30, alignItems: "center", justifyContent: "center" },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    // Lifted half out of the bar.
    marginTop: -DISC / 2 - 4,
    marginBottom: 2,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.bg,
    ...shadow,
    ...Platform.select({ android: { elevation: 6 } }),
  },
  label: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.ink },
  labelActive: { fontFamily: fonts.sansBold },
  underline: { width: 18, height: 2.5, borderRadius: 2, backgroundColor: "transparent" },
  underlineActive: { backgroundColor: colors.ink },
});
