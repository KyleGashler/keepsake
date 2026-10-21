import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, type ChildrenPayload } from "../../../../src/api";
import { Column, PageHeader, PhotoCard } from "../../../../src/components/journey";
import { EmptyState, ErrorState, Loading } from "../../../../src/components/ui";
import { childAge } from "../../../../src/format";
import { routes } from "../../../../src/routes";
import { colors, spacing } from "../../../../src/theme";

/**
 * Child Profiles: one photo card per child. A stub that proves the route and
 * the data — L3 adds the empty-state invitation and "add a child".
 */
export default function ChildProfilesScreen() {
  const { data, error, loading, refetch } = useApi<ChildrenPayload>("/api/children");
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          backLabel="Library"
          title="Child Profiles"
          sparkle
          subtitle="Every child's story, captured little by little."
        />
        {error ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}
        {data && data.children.length === 0 ? (
          <EmptyState title="No children yet" body="When a child joins the family, their story starts here." />
        ) : null}
        <View style={styles.cards}>
          {data?.children.map((child) => (
            <PhotoCard
              key={child.id}
              title={child.name}
              subtitle={childAge(child.birthDate)}
              imageUrl={child.photoUrl}
              height={210}
              onPress={() => router.push(routes.child(child.id))}
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
