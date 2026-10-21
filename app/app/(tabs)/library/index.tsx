import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, type LibraryPayload, type LibraryPillar } from "../../../src/api";
import { Column, PageHeader, PhotoCard } from "../../../src/components/journey";
import { ErrorState, Loading } from "../../../src/components/ui";
import { routes } from "../../../src/routes";
import { colors, spacing } from "../../../src/theme";

/** Child Profiles has its own screens; the other two pillars list their collections. */
function open(pillar: LibraryPillar) {
  router.push(pillar.key === "CHILD_PROFILES" ? routes.children : routes.pillar(pillar.key));
}

/**
 * Library landing: the three Story Pillars as photo cards. Child Profiles
 * opens the children; the other two open their own collections.
 */
export default function LibraryScreen() {
  const { data, error, loading, refetch } = useApi<LibraryPayload>("/api/library");
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          eyebrow="Little by little"
          title="Library"
          sparkle
          subtitle="A comprehensive storykeeping archive."
          onSettings={() => router.push("/family")}
        />
        {error ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}
        <View style={styles.cards}>
          {data?.pillars.map((pillar) => (
            // Choosing a cover (the pencil, via `onEdit`) arrives with L3.
            <PhotoCard
              key={pillar.key}
              title={pillar.name}
              subtitle={pillar.tagline}
              imageUrl={pillar.coverUrl}
              onPress={() => open(pillar)}
            />
          ))}
        </View>
      </Column>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  cards: { gap: spacing.lg },
});
