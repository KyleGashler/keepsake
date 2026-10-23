import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, type ChildrenPayload } from "../../../../src/api";
import { useCanContribute } from "../../../../src/auth/session-context";
import { ChildCardBackdrop } from "../../../../src/components/child-header";
import { Column, PageHeader, PhotoCard, Sparkle } from "../../../../src/components/journey";
import { AddChildSheet } from "../../../../src/components/library-sheets";
import { ErrorState, Loading } from "../../../../src/components/ui";
import { childAge } from "../../../../src/format";
import { routes } from "../../../../src/routes";
import { colors, fonts, layout, radius, spacing } from "../../../../src/theme";

/**
 * Child Profiles (design/mockups/02): one photo card per child, oldest first,
 * then a way to add another. A child without a photo shows their monogram in
 * their own colour. With no children yet, the page is an invitation.
 */
export default function ChildProfilesScreen() {
  const { data, error, loading, refetch } = useApi<ChildrenPayload>("/api/children");
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
  const canContribute = useCanContribute();

  // Fresh photos and names after an edit deeper in the stack.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const children = data?.children ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          backLabel="Library"
          title="Child Profiles"
          sparkle
          sparkleAtEnd
          subtitle="Every child's story, captured little by little."
        />
        {error && !data ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}

        {data && children.length === 0 ? (
          <View style={styles.empty}>
            <Sparkle size={34} variant="filled" />
            <Text style={styles.emptyTitle}>Every story starts with a name</Text>
            <Text style={styles.emptyBody}>
              Add a child and their collections are made for them — milestones, everyday moments, the things
              they say — ready for the first memory.
            </Text>
            {canContribute ? (
              <Pressable
                onPress={() => setAdding(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
              >
                <Ionicons name="add" size={20} color={colors.onPrimary} />
                <Text style={styles.emptyButtonLabel}>Add a child</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {children.length > 0 ? (
          <View style={styles.cards}>
            {children.map((child) => (
              <PhotoCard
                key={child.id}
                title={child.name}
                subtitle={childAge(child.birthDate)}
                imageUrl={child.photoUrl}
                backdrop={<ChildCardBackdrop child={child} />}
                onPress={() => router.push(routes.child(child.id))}
              />
            ))}
            {canContribute ? (
              <Pressable
                onPress={() => setAdding(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
              >
                <View style={styles.addCircle}>
                  <Ionicons name="add" size={24} color={colors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addTitle}>Add a child</Text>
                  <Text style={styles.addBody}>Start another story, little by little.</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Column>

      {adding ? <AddChildSheet onClose={() => setAdding(false)} onAdded={() => void refetch()} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },
  // Cards run wider than the type above them, as in the mockup.
  cards: { gap: spacing.lg, marginHorizontal: -spacing.sm - 2 },

  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  addCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  addTitle: { fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: colors.ink },
  addBody: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 19, color: colors.inkSoft },

  empty: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    gap: spacing.md,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.ink, textAlign: "center" },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.inkSoft,
    textAlign: "center",
    maxWidth: 340,
  },
  emptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 50,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  emptyButtonLabel: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.onPrimary },
});
