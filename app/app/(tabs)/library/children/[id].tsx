import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isNotFound, useApi, type ChildPayload } from "../../../../src/api";
import { useCanContribute } from "../../../../src/auth/session-context";
import { BackRow, ChildHeader } from "../../../../src/components/child-header";
import { Column, IconDisc, ListRow, SearchField } from "../../../../src/components/journey";
import { CreateCollectionSheet, EditChildSheet } from "../../../../src/components/library-sheets";
import { afterSheetCloses, deletePersonAction, deletePersonMessage } from "../../../../src/people";
import { ActionSheet } from "../../../../src/components/sheet";
import { ErrorState, Loading, NotFoundState } from "../../../../src/components/ui";
import { possessive } from "../../../../src/format";
import { backTo, routes } from "../../../../src/routes";
import { Ionicons } from "../../../../src/styled";
import { layout } from "../../../../src/theme";

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingTop: insets.top + layout.top, paddingBottom: insets.bottom + layout.bottom }}
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
            {notice ? <Text className="mt-3 font-sans text-[14px] text-terracotta">{notice}</Text> : null}

            <Text
              className="mt-after-header font-display text-[36px] leading-[42px] tracking-[-0.4px] text-ink"
              accessibilityRole="header"
            >
              Collections
            </Text>
            <Text className="mt-1 font-sans text-[15.5px] leading-[22px] text-ink-soft">
              Different parts of {possessive(child.name)} story, beautifully saved.
            </Text>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search collections..."
              style={{ marginTop: 16, marginBottom: 8, height: 44 }}
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
                <Text className="py-4 font-sans text-[15px] text-muted">
                  No collections match “{query.trim()}”.
                </Text>
              ) : null}
            </View>

            {canContribute ? (
              <Pressable
                onPress={() => setCreating(true)}
                accessibilityRole="button"
                className="mt-4 flex-row items-center gap-4 rounded-[14px] border border-line py-2.5 pr-3 active:opacity-70"
              >
                {/* Same width as a disc, so the title lines up with the list's. */}
                <View className="w-[52px] items-end">
                  <View className="h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-ink">
                    <Ionicons name="add" size={24} colorClassName="accent-ink" />
                  </View>
                </View>
                <View className="flex-1">
                  <Text className="font-display text-[20px] leading-[25px] text-ink">Create a Collection</Text>
                  <Text className="mt-px font-sans text-[14px] leading-[19px] text-ink-soft">Add a new collection tailored to your child.</Text>
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
        <EditChildSheet
          child={child}
          onClose={() => setEditing(false)}
          onSaved={() => void refetch()}
          onDelete={() => {
            setEditing(false);
            afterSheetCloses(() => setConfirmingDelete(true));
          }}
        />
      ) : null}
      {child ? (
        <ActionSheet
          visible={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={`Delete ${child.name}?`}
          subtitle={deletePersonMessage(child)}
          actions={[
            deletePersonAction(
              child,
              () => backTo(routes.children),
              (message) => setNotice(message),
            ),
          ]}
        />
      ) : null}
    </ScrollView>
  );
}
