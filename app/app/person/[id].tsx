import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isNotFound, useApi, type PersonDetail } from "../../src/api";
import { useCanContribute } from "../../src/auth/session-context";
import { DreamCloud } from "../../src/components/brand";
import { EditPersonSheet } from "../../src/components/person-sheets";
import { ActionSheet } from "../../src/components/sheet";
import {
  AppHeader,
  Avatar,
  EmptyState,
  ErrorState,
  HeaderButton,
  Loading,
  MemoryRow,
  NotFoundState,
  Screen,
  SectionHeader,
} from "../../src/components/ui";
import { ageFrom } from "../../src/format";
import { deletePersonAction, deletePersonMessage } from "../../src/people";
import { goBackOr, openInLibrary, routes } from "../../src/routes";

/**
 * Tapping a person filters the archive around their story. Someone who can
 * contribute also gets ⋯: edit their details, or delete them from the
 * archive — unless they have an account here, which only an owner can take
 * away (Family Hub), after which they can be deleted too.
 */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<PersonDetail>(`/api/people/${id}`);
  const canContribute = useCanContribute();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (isNotFound(error)) {
    return <NotFoundState title="This person isn't in the archive anymore" backLabel="Go back" onBack={() => goBackOr("/")} />;
  }
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const person = data.person;
  const age = ageFrom(person.birthDate);

  return (
    <>
      <AppHeader
        back
        subtitle={person.relation ?? "Family"}
        title={person.name}
        action={canContribute ? <HeaderButton icon="ellipsis-horizontal" label={`Options for ${person.name}`} onPress={() => setMenu(true)} /> : null}
      />
      <Screen>
        <View className="flex-row items-center gap-4">
          <Avatar person={person} size={72} />
          <View className="flex-1">
            <Text className="type-title">{person.name}</Text>
            <Text className="type-caption">
              {[person.relation, age].filter(Boolean).join(" · ")}
            </Text>
            <Text className="mt-1 type-caption">
              {data.memoryCount} {data.memoryCount === 1 ? "memory" : "memories"} so far
            </Text>
          </View>
          {/* Whimsical shape 6/6 — dream cloud, over the person the story is about. */}
          <DreamCloud size={44} opacity={0.8} />
        </View>
        {notice ? <Text className="mt-3 type-caption text-terracotta">{notice}</Text> : null}

        {data.collections.length ? (
          <>
            <SectionHeader label="Their collections" />
            <View className="flex-row flex-wrap gap-2">
              {data.collections.map((collection) => (
                <Pressable
                  key={collection.id}
                  onPress={() => openInLibrary(routes.collection(collection.id))}
                  className="rounded-full border border-line bg-surface px-4 py-[7px]"
                >
                  <Text className="text-[13px] text-ink">{collection.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <SectionHeader label="Memories" />
        {data.memories.length === 0 ? (
          <EmptyState title="No memories yet" body={`Nothing has been filed with ${person.name} in it.`} />
        ) : (
          data.memories.map((memory) => <MemoryRow key={memory.id} memory={memory} />)
        )}
      </Screen>

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={person.name}
        subtitle={
          data.isMember
            ? "Has an account in this family. To delete them from the archive, an owner removes them in Family Hub first."
            : undefined
        }
        actions={[
          { label: "Edit details", icon: "create-outline", onPress: () => setEditing(true) },
          ...(data.isMember
            ? []
            : [
                {
                  label: "Delete from the archive",
                  icon: "trash-outline" as const,
                  destructive: true,
                  // ActionSheet lets itself close before running this.
                  onPress: () => setConfirming(true),
                },
              ]),
        ]}
      />
      <ActionSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${person.name}?`}
        subtitle={deletePersonMessage(person, data.collections.length)}
        actions={[
          deletePersonAction(
            person,
            () => goBackOr("/family"),
            (message) => setNotice(message),
          ),
        ]}
      />
      {editing ? <EditPersonSheet person={person} onClose={() => setEditing(false)} onSaved={() => void refetch()} /> : null}
    </>
  );
}
