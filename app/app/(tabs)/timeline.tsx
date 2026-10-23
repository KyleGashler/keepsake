import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Column, PageHeader, Sparkle } from "../../src/components/journey";
import { FamilyPill } from "../../src/components/family-switcher";
import { colors, fonts, radius, spacing } from "../../src/theme";

/** A placeholder until the Timeline has its own milestone. */
export default function TimelineScreen() {
  return (
    <ScrollView style={styles.screen} showsVerticalScrollIndicator={false}>
      <Column>
        <PageHeader
          eyebrow="Little by little"
          accessory={<FamilyPill />}
          title="Timeline"
          sparkle
          subtitle="Every memory, in the order it happened."
          onSettings={() => router.push("/family")}
          onSearch={() => router.push("/search")}
        />
        <View style={styles.card}>
          <Sparkle size={30} variant="filled" />
          <Text style={styles.title}>Coming soon</Text>
          <Text style={styles.body}>
            We're still threading this one together. Soon every story, photo and voice in your
            archive will line up here, from the very first day to this one.
          </Text>
        </View>
      </Column>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
  },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.ink, marginTop: spacing.xs },
  body: { fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 23, color: colors.inkSoft, textAlign: "center" },
});
