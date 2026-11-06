import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isNotFound, type PersonDetail } from "../../src/api";
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
import { deletePersonMessage, useDeletePersonAction } from "../../src/people";
import { useApiQuery, useRefreshOnFocus } from "../../src/query";
import { goBackOr, openInLibrary, routes } from "../../src/routes";

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApiQuery<PersonDetail>(`/api/people/${id}`);
  const { data, error } = query;
  useRefreshOnFocus(query);
  const deletePersonAction = useDeletePersonAction();
  const canContribute = useCanContribute();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (isNotFound(error) || !data) {
    let body = <Loading />;
    if (isNotFound(error)) {
      body = (
        <NotFoundState title="This person isn't in the archive anymore" backLabel="Go back" onBack={() => goBackOr("/")} />
      );
    } else if (error) {
      body = <ErrorState error={error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
    }
    return (
      <>
        <AppHeader back title="" />
        <Screen>{body}</Screen>
      </>
    );
  }

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
          <EmptyState
            icon="images-outline"
            title="No memories yet"
            body={`When a memory has ${person.name} in it, it gathers here.`}
          />
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
      {editing ? <EditPersonSheet person={person} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
