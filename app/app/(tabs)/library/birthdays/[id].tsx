import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, apiSend, isNotFound, type BirthdaysPayload, type ChildSummary, type Collection } from "../../../../src/api";
import { useCanContribute } from "../../../../src/auth/session-context";
import { AddPanel, BirthdayHeader, BirthdayTile } from "../../../../src/components/birthdays";
import { Column, ListRow, SearchField } from "../../../../src/components/journey";
import { EditCollectionSheet } from "../../../../src/components/library-sheets";
import { ActionSheet, Sheet, SheetButton, SheetError } from "../../../../src/components/sheet";
import { EmptyState, ErrorState, Loading, NotFoundState } from "../../../../src/components/ui";
import { count, friendlyError, ordinal, possessive, refusalMessage, yearsOld } from "../../../../src/format";
import { afterSheetCloses } from "../../../../src/people";
import { COLLECTION_VIEWS, gone, invalidate, useApiQuery, useRefreshOnFocus } from "../../../../src/query";
import { backTo, goBackOr, routes } from "../../../../src/routes";
import { Ionicons } from "../../../../src/styled";
import { layout } from "../../../../src/theme";

/**
 * A child's Birthdays: the birthdays the family has added, two to a row,
 * each with a photo and how many memories it holds; then Add a Birthday.
 */
export default function BirthdaysScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = `/api/collections/${id}/birthdays`;
  const query = useApiQuery<BirthdaysPayload>(path);
  const { data, error } = query;
  const insets = useSafeAreaInsets();
  const canContribute = useCanContribute();
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<"menu" | "edit" | "delete" | "add" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useRefreshOnFocus(query);

  const child = data?.child ?? null;
  const parent = child ? routes.child(child.id) : routes.children;
  const deleteBirthdays = useMutation({
    mutationFn: () => apiSend(`/api/collections/${id}`, "DELETE"),
    onSuccess: () => invalidate(COLLECTION_VIEWS, [gone(`/api/collections/${id}`)]),
  });

  if (isNotFound(error)) {
    return (
      <View className="flex-1 justify-center bg-paper" style={{ paddingTop: insets.top }}>
        <NotFoundState title="This collection isn't here anymore" backLabel="Go back" onBack={() => goBackOr(routes.library)} />
      </View>
    );
  }
  if (!data) {
    return (
      <View className="flex-1 justify-center bg-paper">
        {error ? <ErrorState error={error} onRetry={() => void query.refetch()} retrying={query.isFetching} /> : <Loading />}
      </View>
    );
  }

  const { collection, birthdays, unsortedCount } = data;
  const needle = search.trim().toLowerCase();
  const shown = birthdays.filter((b) => !needle || b.collection.name.toLowerCase().includes(needle));

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingTop: insets.top + layout.top, paddingBottom: insets.bottom + layout.bottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <BirthdayHeader
          child={child}
          title={collection.name}
          subtitle="A little more of you, every year."
          backLabel={child?.name ?? "Child Profiles"}
          backParent={parent}
          onMore={canContribute ? () => setSheet("menu") : undefined}
          moreLabel="Birthdays options"
        />
        {notice ? <Text className="mt-3 font-sans text-[14px] text-terracotta">{notice}</Text> : null}

        {birthdays.length > 0 ? (
          <SearchField value={search} onChangeText={setSearch} placeholder="Search birthdays..." className="mt-5 mb-4" style={{ height: 44 }} />
        ) : null}

        <View className="flex-row flex-wrap justify-between">
          {shown.map((b) => (
            <BirthdayTile
              key={b.collection.id}
              name={b.collection.name}
              memoryCount={b.memoryCount}
              coverUrl={b.coverUrl}
              onPress={() => router.push(routes.birthday(b.collection.id))}
            />
          ))}
        </View>
        {needle && shown.length === 0 ? (
          <Text className="py-4 font-sans text-[15px] text-muted">No birthdays match “{search.trim()}”.</Text>
        ) : null}
        {birthdays.length === 0 ? (
          <View className="mt-6">
            <EmptyState
              title="No birthdays yet"
              body={
                child
                  ? `Add one of ${possessive(child.name)} birthdays to start its chapter.`
                  : "Add a birthday to start its chapter."
              }
            />
          </View>
        ) : null}

        {unsortedCount > 0 && !needle ? (
          <ListRow
            title="Other birthday memories"
            description={`${count(unsortedCount, "memory", "memories")} not near a birthday added here`}
            divider={false}
            onPress={() => router.push(routes.looseBirthdays(collection.id))}
          />
        ) : null}

        {canContribute ? (
          <AddPanel title="Add a Birthday" subtitle="Create a new birthday to keep the tradition going." onPress={() => setSheet("add")} />
        ) : null}
      </Column>

      <ActionSheet
        visible={sheet === "menu"}
        onClose={() => setSheet((s) => (s === "menu" ? null : s))}
        title={collection.name}
        actions={[
          { label: "Edit collection", icon: "create-outline", onPress: () => setSheet("edit") },
          { label: "Delete collection", icon: "trash-outline", destructive: true, onPress: () => setSheet("delete") },
        ]}
      />
      <ActionSheet
        visible={sheet === "delete"}
        onClose={() => setSheet((s) => (s === "delete" ? null : s))}
        title={`Delete “${collection.name}”?`}
        subtitle="Every birthday and category in it goes too. The memories stay in the archive, and in any other collection they're filed in."
        actions={[
          {
            label: "Delete collection",
            icon: "trash-outline",
            destructive: true,
            onPress: () =>
              deleteBirthdays.mutate(undefined, {
                onSuccess: () => backTo(parent),
                onError: (err) => setNotice(refusalMessage(err, "Couldn't delete it just now. Please try again.")),
              }),
          },
        ]}
      />
      {sheet === "edit" ? <EditCollectionSheet collection={collection} onClose={() => setSheet(null)} /> : null}
      {sheet === "add" ? (
        <AddBirthdaySheet
          birthdaysId={collection.id}
          child={child}
          taken={new Set(birthdays.map((b) => b.collection.birthday))}
          onClose={() => setSheet(null)}
          onAdded={(birthday) => afterSheetCloses(() => router.push(routes.birthday(birthday.id)))}
        />
      ) : null}
    </ScrollView>
  );
}

const MAX_BIRTHDAY = 120;

/** Starts on the child's latest birthday when that isn't here yet, else the first one missing. */
function AddBirthdaySheet({
  birthdaysId,
  child,
  taken,
  onClose,
  onAdded,
}: {
  birthdaysId: string;
  child: ChildSummary | null;
  taken: Set<number | null>;
  onClose: () => void;
  onAdded: (birthday: Collection) => void;
}) {
  const [n, setN] = useState(() => {
    const latest = yearsOld(child?.birthDate);
    if (latest >= 1 && !taken.has(latest)) return latest;
    let first = 1;
    while (taken.has(first)) first += 1;
    return first;
  });
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (birthday: number) =>
      apiSend<{ birthday: Collection }>(`/api/collections/${birthdaysId}/birthdays`, "POST", { birthday }),
    // Nested rows aren't in any count; only the lists and search show them.
    onSuccess: () => invalidate(["collections", "search"]),
  });
  const already = taken.has(n);

  async function save() {
    setError(null);
    try {
      const res = await add.mutateAsync(n);
      onClose();
      onAdded(res.birthday);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `The ${ordinal(n)} birthday is already here.`
          : friendlyError(err, "Couldn't add it just now. Please try again."),
      );
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Add a Birthday"
      subtitle="It starts with a few suggested categories you can rename, reorder or remove."
      footer={<SheetButton label={`Add the ${ordinal(n)} birthday`} onPress={save} busy={add.isPending} disabled={already} />}
    >
      <View className="flex-row items-center justify-center gap-6 py-4">
        <Stepper icon="remove" label="Earlier birthday" disabled={n <= 1} onPress={() => setN((v) => v - 1)} />
        <Text
          className="min-w-[180px] text-center font-display text-[30px] leading-[36px] text-ink"
          accessibilityLiveRegion="polite"
        >
          {ordinal(n)} Birthday
        </Text>
        <Stepper icon="add" label="Later birthday" disabled={n >= MAX_BIRTHDAY} onPress={() => setN((v) => v + 1)} />
      </View>
      {already ? <Text className="text-center type-caption">This one is already here.</Text> : null}
      <SheetError message={error} />
    </Sheet>
  );
}

function Stepper({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "add" | "remove";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-ink active:opacity-70 ${disabled ? "opacity-30" : ""}`}
    >
      <Ionicons name={icon} size={22} colorClassName="accent-ink" />
    </Pressable>
  );
}
