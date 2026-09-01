import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mediaUrl, useApi, type LibraryPayload } from "../../src/api";
import { StoryArc } from "../../src/components/brand";
import { AppHeader, ErrorState, Loading, Screen } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";

/**
 * Library is organised around the three Story Pillars. Same navigation pattern
 * in all three; only the chapter of family life changes.
 */
export default function LibraryScreen() {
  const { data, error, loading, refetch } = useApi<LibraryPayload>("/api/library");

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  return (
    <>
      <AppHeader subtitle="Library" title="Every memory has a place" />
      <Screen>
        {/* Whimsical shape 2/6 — story arc, over the three pillars a story travels. */}
        <View style={styles.intro}>
          <StoryArc size={64} />
          <Text style={[type.body, { flex: 1 }]}>Three ways into your family's archive.</Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          {data.pillars.map((pillar) => (
            <Pressable
              key={pillar.key}
              onPress={() => router.push(`/pillar/${pillar.key}`)}
              style={({ pressed }) => [styles.pillar, pressed && { opacity: 0.85 }]}
            >
              <Image
                source={{ uri: mediaUrl(pillar.coverUrl) }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={250}
              />
              <View style={styles.scrim} />
              <View style={styles.body}>
                <Text style={styles.name}>{pillar.name}</Text>
                <Text style={styles.tagline}>{pillar.tagline}</Text>
                <Text style={styles.count}>{pillar.collectionCount} collections</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  pillar: {
    height: 200,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    justifyContent: "flex-end",
  },
  scrim: { position: "absolute", inset: 0, backgroundColor: "rgba(47,54,46,0.38)" },
  body: { padding: spacing.xl, gap: 4 },
  name: { fontFamily: type.display.fontFamily, fontSize: 25, color: "#FFF7EF" },
  tagline: { fontSize: 14, lineHeight: 20, color: "rgba(255,247,239,0.88)" },
  count: { fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: "rgba(255,247,239,0.75)", marginTop: 6 },
});
