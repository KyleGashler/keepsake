import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { mediaUrl, useApi, type HomePayload } from "../../src/api";
import {
  AppHeader,
  Avatar,
  ErrorState,
  Loading,
  MemoryTile,
  PersonChip,
  Screen,
  SectionHeader,
} from "../../src/components/ui";
import { relativeTime } from "../../src/format";
import { colors, radius, spacing, type } from "../../src/theme";

/**
 * Home is the front porch of the family's story — a welcome, the people in it,
 * one thing worth capturing today, and a quiet record of what's happened.
 * Deliberately not a dashboard.
 */
export default function HomeScreen() {
  const { data, error, loading, refetch } = useApi<HomePayload>("/api/home");

  // New memories should be here the moment you come back from Capture.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  return (
    <>
      <AppHeader subtitle="Keepsake" />
      <Screen>
        <View style={styles.greeting}>
          <Text style={type.display}>{data.greeting.salutation}</Text>
          <Text style={[type.body, { marginTop: 6 }]}>{data.greeting.message}</Text>
        </View>

        <SectionHeader label="Your People" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.lg, paddingRight: spacing.lg }}
        >
          {data.people.map((person) => (
            <PersonChip
              key={person.id}
              person={person}
              onPress={() => router.push(`/person/${person.id}`)}
            />
          ))}
        </ScrollView>

        {data.prompt ? (
          <>
            <SectionHeader label="Today's Moment to Capture" />
            <Pressable
              onPress={() =>
                router.push({ pathname: "/capture/compose", params: { prompt: data.prompt!.text } })
              }
              style={({ pressed }) => [styles.hero, pressed && { opacity: 0.85 }]}
            >
              <Image
                source={{ uri: mediaUrl(data.prompt.imageUrl) }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={300}
              />
              <View style={styles.heroScrim} />
              <View style={styles.heroBody}>
                <Text style={styles.heroText}>{data.prompt.text}</Text>
                {data.prompt.subtitle ? <Text style={styles.heroSub}>{data.prompt.subtitle}</Text> : null}
                <View style={styles.heroCta}>
                  <Ionicons name="add" size={16} color={colors.ink} />
                  <Text style={styles.heroCtaText}>Preserve this</Text>
                </View>
              </View>
            </Pressable>
          </>
        ) : null}

        <SectionHeader label="Your Story So Far" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.lg }}
        >
          {data.storySoFar.map((memory) => (
            <MemoryTile key={memory.id} memory={memory} />
          ))}
        </ScrollView>

        <SectionHeader label="Family Updates" />
        <View style={styles.updates}>
          {data.updates.map((update) => (
            <View key={update.id} style={styles.update}>
              {update.actor ? (
                <Avatar person={update.actor} size={34} />
              ) : (
                <View style={styles.updateDot} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontSize: 14.5 }]}>{update.message}</Text>
                <Text style={type.caption}>{relativeTime(update.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>
          {data.stats.memoryCount} memories preserved · {data.stats.personCount} people in {data.family.name}
        </Text>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  greeting: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  hero: {
    height: 300,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    justifyContent: "flex-end",
  },
  heroScrim: { position: "absolute", inset: 0, backgroundColor: "rgba(28,23,19,0.34)" },
  heroBody: { padding: spacing.xl, gap: spacing.sm },
  heroText: { fontFamily: type.display.fontFamily, fontSize: 26, lineHeight: 33, color: "#FFF7EF" },
  heroSub: { fontSize: 14, lineHeight: 20, color: "rgba(255,247,239,0.85)" },
  heroCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,247,239,0.94)",
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  heroCtaText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  updates: { gap: spacing.lg },
  update: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  updateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginHorizontal: 13 },
  footer: { ...type.caption, textAlign: "center", marginTop: spacing.xxl },
});
