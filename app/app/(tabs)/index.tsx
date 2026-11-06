import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaUrl, type HomePayload } from "../../src/api";
import { useFamilyId } from "../../src/auth/family-store";
import { useCanContribute, useSession } from "../../src/auth/session-context";
import { Twinkle } from "../../src/components/brand";
import { BleedRow, Column, TabHeader, Sparkle } from "../../src/components/journey";
import { AddChildSheet } from "../../src/components/library-sheets";
import { AddPersonSheet } from "../../src/components/person-sheets";
import {
  Avatar,
  Button,
  ErrorState,
  Loading,
  MemoryTile,
  PersonChip,
  SectionHeader,
  SmallButton,
} from "../../src/components/ui";
import { count, relativeTime } from "../../src/format";
import { useApiQuery, useRefreshOnFocus } from "../../src/query";
import { Image, Ionicons, type IoniconName } from "../../src/styled";
import { layout, useColor } from "../../src/theme";

export default function HomeScreen() {
  const home = useApiQuery<HomePayload>("/api/home");
  const { data, error } = home;
  const insets = useSafeAreaInsets();
  useRefreshOnFocus(home);

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <TabHeader title="Home" subtitle={data ? `${data.greeting.salutation}. ${data.greeting.message}` : undefined} />
        {error && !data ? <ErrorState error={error} onRetry={() => void home.refetch()} retrying={home.isFetching} /> : null}
        {home.isPending && !error ? <Loading /> : null}
        {data ? <HomeBody data={data} /> : null}
      </Column>
    </ScrollView>
  );
}

const STARTER_IDEAS = [
  "A photo of today, just as it is",
  "How the two of you met",
  "Something someone said this week",
];

function openInvite() {
  router.push({ pathname: "/family", params: { invite: "1" } });
}

const SMALL_FAMILY = 4;

function HomeBody({ data }: { data: HomePayload }) {
  const canContribute = useCanContribute();
  const isOwner = useSession().family?.role === "OWNER";
  const [adding, setAdding] = useState<"person" | "child" | null>(null);
  const prompt = canContribute ? data.prompt : null;
  const addPerson = () => setAdding("person");
  const cream = useColor("cream");
  const addInRail = canContribute && data.people.length < SMALL_FAMILY;
  const steps = useGettingStarted(data.gettingStarted, isOwner);
  const showGettingStarted = canContribute && steps.visible;

  return (
    <>
      {showGettingStarted ? (
        <GettingStarted
          progress={data.gettingStarted}
          steps={steps}
          onAddPerson={addPerson}
          onAddChild={() => setAdding("child")}
          onInvite={openInvite}
        />
      ) : null}

      <SectionHeader
        label="Your People"
        first={!showGettingStarted}
        action={
          canContribute && !addInRail ? (
            <SmallButton label="Add" icon="add" accessibilityLabel="Add someone" onPress={addPerson} />
          ) : null
        }
      />
      <BleedRow contentClassName="gap-4">
        {data.people.map((person) => (
          <PersonChip
            key={person.id}
            person={person}
            onPress={() => router.push(`/person/${person.id}`)}
          />
        ))}
        {addInRail ? (
          <PlaceholderChip icon="add" label="Add" onPress={addPerson} />
        ) : null}
        {isOwner && data.people.length < SMALL_FAMILY && !data.gettingStarted.invitedSomeone ? (
          <PlaceholderChip icon="mail-outline" label="Invite" onPress={openInvite} />
        ) : null}
      </BleedRow>

      {prompt ? (
        <>
          <SectionHeader label="Today's Moment to Capture" />
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/capture/compose",
                params: { prompt: prompt.text },
              })
            }
            className="h-[300px] rounded-lg overflow-hidden bg-surface-alt justify-end active:opacity-85"
          >
            <Image
              source={{ uri: mediaUrl(prompt.imageUrl) }}
              className="absolute inset-0"
              contentFit="cover"
              transition={300}
            />
            <View className="absolute inset-0 bg-scrim/36" />
            <Twinkle size={22} color={cream} opacity={0.9} className="absolute top-4 right-4" />
            <View className="p-6 gap-2">
              <Text className="font-display text-[26px] leading-[33px] text-cream">{prompt.text}</Text>
              {prompt.subtitle ? (
                <Text className="text-[14px] leading-[20px] text-cream/85">{prompt.subtitle}</Text>
              ) : null}
              <View className="flex-row items-center gap-1.5 self-start bg-cream/94 py-[9px] px-4 rounded-full mt-2">
                <Ionicons name="add" size={16} colorClassName="accent-ink" />
                <Text className="text-[14px] font-semibold text-ink">Preserve this</Text>
              </View>
            </View>
          </Pressable>
        </>
      ) : null}

      <SectionHeader label="Your Story So Far" />
      {data.storySoFar.length ? (
        <BleedRow contentClassName="gap-3">
          {data.storySoFar.map((memory) => (
            <MemoryTile key={memory.id} memory={memory} />
          ))}
        </BleedRow>
      ) : (
        <FirstMemory canContribute={canContribute} />
      )}

      {data.updates.length ? (
        <>
          <SectionHeader label="Family Updates" />
          <View className="gap-4">
            {data.updates.map((update) => (
              <View key={update.id} className="flex-row gap-3 items-center">
                {update.actor ? (
                  <Avatar person={update.actor} size={34} />
                ) : (
                  <View className="w-2 h-2 rounded-full bg-accent mx-[13px]" />
                )}
                <View className="flex-1">
                  <Text className="type-body text-[14.5px]">{update.message}</Text>
                  <Text className="type-caption">{relativeTime(update.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {data.stats.memoryCount ? (
        <Text className="type-caption text-center mt-section">
          {count(data.stats.memoryCount, "memory", "memories")} preserved ·{" "}
          {count(data.stats.personCount, "person", "people")} in {data.family.name}
        </Text>
      ) : null}

      {adding === "person" ? (
        <AddPersonSheet onClose={() => setAdding(null)} />
      ) : null}
      {adding === "child" ? (
        <AddChildSheet onClose={() => setAdding(null)} />
      ) : null}
    </>
  );
}

type StepKey = keyof HomePayload["gettingStarted"];

const STEP_KEYS: StepKey[] = ["firstMemory", "addedSomeone", "addedChild", "invitedSomeone"];

function useGettingStarted(progress: HomePayload["gettingStarted"], isOwner: boolean) {
  const storageKey = `littlebylittle.gettingStarted.dismissed.${useFamilyId()}`;
  const [dismissed, setDismissed] = useState<StepKey[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      let saved: unknown = [];
      try {
        saved = JSON.parse((await AsyncStorage.getItem(storageKey)) ?? "[]");
      } catch {
        // Unreadable; show every step again.
      }
      const keys = STEP_KEYS.filter((k) => Array.isArray(saved) && saved.includes(k));
      if (live) setDismissed(keys);
    })();
    return () => {
      live = false;
    };
  }, [storageKey]);

  const keys = STEP_KEYS.filter((k) => isOwner || k !== "invitedSomeone");
  const rows = dismissed ? keys.filter((k) => !dismissed.includes(k)) : [];
  const cleared = keys.length - rows.filter((k) => !progress[k]).length;

  function dismiss(key: StepKey) {
    const next = [...(dismissed ?? []), key];
    setDismissed(next);
    AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => undefined);
  }

  return { rows, cleared, total: keys.length, visible: cleared < keys.length, dismiss };
}

const STEP_LABELS: Record<StepKey, string> = {
  firstMemory: "Preserve your first memory",
  addedSomeone: "Add someone to Your People",
  addedChild: "Add a child",
  invitedSomeone: "Invite family to join",
};

function GettingStarted({
  progress,
  steps,
  onAddPerson,
  onAddChild,
  onInvite,
}: {
  progress: HomePayload["gettingStarted"];
  steps: ReturnType<typeof useGettingStarted>;
  onAddPerson: () => void;
  onAddChild: () => void;
  onInvite: () => void;
}) {
  const open: Record<StepKey, () => void> = {
    firstMemory: () => router.push("/capture"),
    addedSomeone: onAddPerson,
    addedChild: onAddChild,
    invitedSomeone: onInvite,
  };

  return (
    <>
      <SectionHeader
        label="Getting Started"
        first
        action={<Text className="type-caption">{`${steps.cleared} of ${steps.total}`}</Text>}
      />
      <View className="rounded-lg bg-surface border border-line px-4">
        {steps.rows.map((key, i) => {
          const done = progress[key];
          const label = STEP_LABELS[key];
          return (
            <View key={key} className={`flex-row items-center gap-3 ${i > 0 ? "border-t border-line" : ""}`}>
              <Pressable
                onPress={open[key]}
                disabled={done}
                accessibilityRole="button"
                accessibilityState={{ disabled: done, checked: done }}
                className="flex-1 flex-row items-center gap-3 py-3 active:opacity-70"
              >
                <Ionicons
                  name={done ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  colorClassName={done ? "accent-primary" : "accent-muted"}
                />
                <Text
                  className={`flex-1 text-[15px] ${done ? "font-sans text-muted line-through" : "font-sans-bold text-ink"}`}
                >
                  {label}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => steps.dismiss(key)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss “${label}”`}
                className="active:opacity-70"
              >
                <Ionicons name="close" size={18} colorClassName="accent-muted" />
              </Pressable>
            </View>
          );
        })}
      </View>
    </>
  );
}

function PlaceholderChip({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="w-[74px] items-center gap-1.5 active:opacity-70"
    >
      <View className="w-[58px] h-[58px] rounded-full border-[1.5px] border-dashed border-muted items-center justify-center">
        <Ionicons name={icon} size={22} colorClassName="accent-muted" />
      </View>
      <Text className="text-[13px] font-semibold text-muted" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function FirstMemory({ canContribute }: { canContribute: boolean }) {
  if (!canContribute) {
    return (
      <Text className="type-caption">Nothing here yet. When your family preserves a memory, it will appear here.</Text>
    );
  }
  return (
    <View className="items-center py-9 px-4 rounded-lg bg-surface-alt gap-3">
      <Sparkle size={30} variant="filled" />
      <Text className="type-title text-center">Your story starts with one memory</Text>
      <Text className="type-body text-center max-w-[340px]">
        A photo, a voice note, a few lines. It doesn't need to be perfect, only true.
      </Text>
      <Button label="Preserve your first memory" icon="add" onPress={() => router.push("/capture")} />
      <Text className="type-label mt-2">Or start with</Text>
      <View className="flex-row flex-wrap justify-center gap-2">
        {STARTER_IDEAS.map((idea) => (
          <Pressable
            key={idea}
            onPress={() => router.push({ pathname: "/capture/compose", params: { prompt: idea } })}
            accessibilityRole="button"
            className="py-2 px-3 rounded-full border border-line bg-surface active:opacity-70"
          >
            <Text className="font-sans text-[14px] text-ink">{idea}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
