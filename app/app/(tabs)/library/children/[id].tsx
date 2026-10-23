import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isNotFound, useApi, type ChildPayload } from "../../../../src/api";
import { useCanContribute } from "../../../../src/auth/session-context";
import { BackRow, ChildHeader } from "../../../../src/components/child-header";
import { Column, IconDisc, ListRow, SearchField } from "../../../../src/components/journey";
import { CreateCollectionSheet, EditChildSheet } from "../../../../src/components/library-sheets";
import { ErrorState, Loading, NotFoundState } from "../../../../src/components/ui";
import { possessive } from "../../../../src/format";
import { backTo, routes } from "../../../../src/routes";
import { colors, fonts, spacing } from "../../../../src/theme";

/**
 * One child's Collections (design/mockups/03): their photo, name, age and
 * counts; their collections, searchable by name and description; and a way
 * to make a new one. The gear edits the child — photo, name, birthday.
 */
export default function ChildCollectionsScreen() {
  const { id: childId } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<ChildPayload>(`/api/children/${childId}`);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const insets = useSafeAreaInsets();
  const canContribute = useCanContribute();

  // Counts move when memories are added or filed deeper in the stack.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const needle = query.trim().toLowerCase();
  const all = data?.collections ?? [];
  const collections = all.filter(
    (c) =>
      !needle ||
      c.name.toLowerCase().includes(needle) ||
      (c.description ?? "").toLowerCase().includes(needle),
  );
  // A child removed while you were deeper in the stack 404s on the refresh
  // back here; don't leave their stale collections up.
  const gone = isNotFound(error);
  const child = gone ? undefined : data?.child;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <BackRow
          label="Child Profiles"
          parent={routes.children}
          onSettings={child && canContribute ? () => setEditing(true) : undefined}
          settingsLabel={child && canContribute ? `Edit ${child.name}` : undefined}
        />
        {gone ? (
          <NotFoundState
            title="This profile isn't here anymore"
            backLabel="Child Profiles"
            onBack={() => backTo(routes.children)}
          />
        ) : null}
        {!gone && error && !data ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}
        {child ? (
          <>
            <ChildHeader child={child} />

            <Text style={styles.sectionTitle} accessibilityRole="header">
              Collections
            </Text>
            <Text style={styles.sectionSubtitle}>
              Different parts of {possessive(child.name)} story, beautifully saved.
            </Text>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search collections..."
              style={styles.search}
            />

            <View>
              {collections.map((collection, i) => (
                <ListRow
                  key={collection.id}
                  title={collection.name}
                  description={collection.description}
                  leading={<IconDisc icon={collection.icon} color={collection.color} size={52} />}
                  divider={i < collections.length - 1}
                  onPress={() => router.push(routes.collection(collection.id))}
                />
              ))}
              {needle && collections.length === 0 ? (
                <Text style={styles.noMatch}>
                  No collections match “{query.trim()}”.
                </Text>
              ) : null}
            </View>

            {canContribute ? (
              <Pressable
                onPress={() => setCreating(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.create, pressed && styles.pressed]}
              >
                <View style={styles.createSlot}>
                  <View style={styles.createCircle}>
                    <Ionicons name="add" size={24} color={colors.ink} />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createTitle}>Create a Collection</Text>
                  <Text style={styles.createBody}>Add a new collection tailored to your child.</Text>
                </View>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </Column>

      {creating && child ? (
        <CreateCollectionSheet
          child={child}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setQuery("");
            void refetch();
          }}
        />
      ) : null}
      {editing && child ? (
        <EditChildSheet child={child} onClose={() => setEditing(false)} onSaved={() => void refetch()} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.4,
    color: colors.ink,
    marginTop: spacing.lg,
  },
  sectionSubtitle: { fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 22, color: colors.inkSoft },
  search: { marginTop: spacing.md, marginBottom: spacing.xs, height: 44 },
  noMatch: { fontFamily: fonts.sans, fontSize: 15, color: colors.muted, paddingVertical: spacing.lg },

  create: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingRight: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  // Same width as a disc, so the title lines up with the list's.
  createSlot: { width: 52, alignItems: "flex-end" },
  createCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  createTitle: { fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: colors.ink },
  createBody: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 19, color: colors.inkSoft, marginTop: 1 },
});
