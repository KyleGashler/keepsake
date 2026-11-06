import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiSend, isNotFound, type BirthdayPayload } from "../../../../src/api";
import { useCanContribute } from "../../../../src/auth/session-context";
import { AddPanel, BirthdayHeader, CategoryRow } from "../../../../src/components/birthdays";
import { ArrangeButton, Column, SearchField } from "../../../../src/components/journey";
import { ActionSheet, Field, Sheet, SheetButton, SheetError, SheetInput } from "../../../../src/components/sheet";
import { ErrorState, InlineError, Loading, NotFoundState } from "../../../../src/components/ui";
import { deleteCollectionMessage, friendlyError, ordinal, possessive, refusalMessage } from "../../../../src/format";
import { afterSheetCloses } from "../../../../src/people";
import { COLLECTION_VIEWS, gone, invalidate, useApiQuery, useRefreshOnFocus } from "../../../../src/query";
import { backTo, goBackOr, routes } from "../../../../src/routes";
import { layout } from "../../../../src/theme";
import { useSettled } from "../../../../src/use-settled";

type Category = BirthdayPayload["categories"][number];

export default function BirthdayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState("");
  const q = useSettled(text.trim(), 300);
  const query = useApiQuery<BirthdayPayload>(
    `/api/collections/${id}/categories${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    { keepPrevious: true },
  );
  const { data, error } = query;
  const insets = useSafeAreaInsets();
  const canContribute = useCanContribute();
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<"menu" | "add" | "deleteBirthday" | null>(null);
  const [chosen, setChosen] = useState<Category | null>(null);
  const [categorySheet, setCategorySheet] = useState<"menu" | "rename" | "remove" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useRefreshOnFocus(query);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => apiSend(`/api/collections/${id}/categories/order`, "PUT", { ids }),
    onSettled: () => invalidate(["collections"]),
    onError: (err) => setNotice(refusalMessage(err, "Couldn't save the new order. Please try again.")),
  });
  const remove = useMutation({
    mutationFn: (collectionId: string) => apiSend(`/api/collections/${collectionId}`, "DELETE"),
    onSuccess: (_, collectionId) => invalidate(COLLECTION_VIEWS, [gone(`/api/collections/${collectionId}`)]),
  });

  if (isNotFound(error)) {
    return (
      <View className="flex-1 justify-center bg-paper" style={{ paddingTop: insets.top }}>
        <NotFoundState title="This birthday isn't here anymore" backLabel="Go back" onBack={() => goBackOr(routes.library)} />
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

  const { birthday, birthdays, child, otherMoments } = data;
  const n = birthday.birthday;
  const byId = new Map(data.categories.map((c) => [c.collection.id, c]));
  const categories = reorder.isPending
    ? reorder.variables.flatMap((cid) => byId.get(cid) ?? [])
    : data.categories;
  const searching = q !== "";

  function move(index: number, by: -1 | 1) {
    const ids = categories.map((c) => c.collection.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate(ids);
  }

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
          title={birthday.name}
          subtitle={
            child
              ? `All the special moments from ${possessive(child.name)} ${ordinal(n)} birthday.`
              : `All the special moments from the ${ordinal(n)} birthday.`
          }
          backLabel={birthdays.name}
          backParent={routes.birthdays(birthdays.id)}
          onMore={canContribute ? () => setSheet("menu") : undefined}
          moreLabel={`${birthday.name} options`}
        />
        {notice ? <Text className="mt-3 font-sans text-[14px] text-terracotta">{notice}</Text> : null}
        {error ? <InlineError error={error} onRetry={() => void query.refetch()} /> : null}

        <SearchField
          value={text}
          onChangeText={setText}
          placeholder={`Search ${ordinal(n)} birthday memories, words, or phrases...`}
          className="mt-5 mb-4"
          style={{ height: 44 }}
        />

        {editing ? (
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="font-sans text-[14px] text-ink-soft">Reorder, rename or remove categories.</Text>
            <Pressable onPress={() => setEditing(false)} accessibilityRole="button" hitSlop={8} className="active:opacity-70">
              <Text className="font-sans-bold text-[15px] text-ink">Done</Text>
            </Pressable>
          </View>
        ) : null}

        <View className={query.isPlaceholderData ? "opacity-50" : undefined}>
          {categories.map((c, i) => (
            <CategoryRow
              key={c.collection.id}
              title={c.collection.name}
              preview={c.preview}
              thumbUrl={c.thumbUrl}
              mediaTypes={c.mediaTypes}
              onPress={editing ? undefined : () => router.push(routes.collection(c.collection.id))}
              trailing={
                editing ? (
                  <View className="flex-row gap-1.5">
                    <ArrangeButton icon="arrow-up" label={`Move ${c.collection.name} up`} disabled={i === 0 || reorder.isPending} onPress={() => move(i, -1)} />
                    <ArrangeButton
                      icon="arrow-down"
                      label={`Move ${c.collection.name} down`}
                      disabled={i === categories.length - 1 || reorder.isPending}
                      onPress={() => move(i, 1)}
                    />
                    <ArrangeButton
                      icon="ellipsis-horizontal"
                      label={`${c.collection.name} options`}
                      disabled={false}
                      onPress={() => {
                        setChosen(c);
                        setCategorySheet("menu");
                      }}
                    />
                  </View>
                ) : undefined
              }
            />
          ))}
          {otherMoments && !editing ? (
            <CategoryRow
              title="Other moments"
              preview={otherMoments.preview}
              thumbUrl={otherMoments.thumbUrl}
              mediaTypes={otherMoments.mediaTypes}
              onPress={() => router.push(routes.looseBirthdays(birthdays.id, { id: birthday.id, birthday: n }))}
            />
          ) : null}
          {categories.length === 0 && !otherMoments ? (
            <Text className="py-4 font-sans text-[15px] text-muted">
              {searching ? `Nothing here matches “${q}”.` : "No categories yet. Add one for a part of the day worth keeping."}
            </Text>
          ) : null}
        </View>

        {canContribute && !searching ? (
          <View className="mt-4">
            <AddPanel title="Add a Category" subtitle="Create a custom category for this birthday." onPress={() => setSheet("add")} />
          </View>
        ) : null}
      </Column>

      <ActionSheet
        visible={sheet === "menu"}
        onClose={() => setSheet((s) => (s === "menu" ? null : s))}
        title={birthday.name}
        actions={[
          { label: "Add a category", icon: "add", onPress: () => setSheet("add") },
          { label: "Edit categories", icon: "reorder-three-outline", onPress: () => setEditing(true) },
          { label: "Remove this birthday", icon: "trash-outline", destructive: true, onPress: () => setSheet("deleteBirthday") },
        ]}
      />
      <ActionSheet
        visible={sheet === "deleteBirthday"}
        onClose={() => setSheet((s) => (s === "deleteBirthday" ? null : s))}
        title={`Remove the ${birthday.name}?`}
        subtitle="Its categories go too. The memories stay in the archive, and in any other collection they're filed in."
        actions={[
          {
            label: "Remove birthday",
            icon: "trash-outline",
            destructive: true,
            onPress: () =>
              remove.mutate(birthday.id, {
                onSuccess: () => backTo(routes.birthdays(birthdays.id)),
                onError: (err) => setNotice(refusalMessage(err, "Couldn't remove it just now. Please try again.")),
              }),
          },
        ]}
      />
      {sheet === "add" ? (
        <CategoryNameSheet
          title="Add a Category"
          submitLabel="Add category"
          initial=""
          onClose={() => setSheet(null)}
          onSubmit={async (name) => {
            await apiSend(`/api/collections/${id}/categories`, "POST", { name });
            await invalidate(["collections", "search"]);
          }}
        />
      ) : null}

      {chosen ? (
        <ActionSheet
          visible={categorySheet === "menu"}
          onClose={() => setCategorySheet((s) => (s === "menu" ? null : s))}
          title={chosen.collection.name}
          actions={[
            { label: "Rename", icon: "create-outline", onPress: () => setCategorySheet("rename") },
            { label: "Remove", icon: "trash-outline", destructive: true, onPress: () => afterSheetCloses(() => setCategorySheet("remove")) },
          ]}
        />
      ) : null}
      {chosen ? (
        <ActionSheet
          visible={categorySheet === "remove"}
          onClose={() => setCategorySheet((s) => (s === "remove" ? null : s))}
          title={`Remove “${chosen.collection.name}”?`}
          subtitle={deleteCollectionMessage(chosen.memoryCount)}
          actions={[
            {
              label: "Remove category",
              icon: "trash-outline",
              destructive: true,
              onPress: () =>
                remove.mutate(chosen.collection.id, {
                  onError: (err) => setNotice(refusalMessage(err, "Couldn't remove it just now. Please try again.")),
                }),
            },
          ]}
        />
      ) : null}
      {chosen && categorySheet === "rename" ? (
        <CategoryNameSheet
          title="Rename Category"
          submitLabel="Save"
          initial={chosen.collection.name}
          onClose={() => setCategorySheet(null)}
          onSubmit={async (name) => {
            await apiSend(`/api/collections/${chosen.collection.id}`, "PATCH", { name });
            await invalidate(COLLECTION_VIEWS);
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function CategoryNameSheet({
  title,
  submitLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: onSubmit });
  const trimmed = name.trim();

  async function submit() {
    if (!trimmed) return;
    if (trimmed === initial) return onClose();
    setError(null);
    try {
      await save.mutateAsync(trimmed);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Couldn't save just now. Please try again."));
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={title}
      footer={<SheetButton label={submitLabel} onPress={submit} busy={save.isPending} disabled={!trimmed} />}
    >
      <Field label="Name">
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder="Pool party, Breakfast in bed…"
          autoFocus
          maxLength={80}
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel="Category name"
        />
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}
