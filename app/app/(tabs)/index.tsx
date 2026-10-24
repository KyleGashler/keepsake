import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaUrl, useApi, type HomePayload } from "../../src/api";
import { useCanContribute, useSession } from "../../src/auth/session-context";
import { Twinkle } from "../../src/components/brand";
import { Column, PageHeader, Sparkle } from "../../src/components/journey";
import { FamilyPill } from "../../src/components/family-switcher";
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
import { Image, Ionicons, type IoniconName } from "../../src/styled";
import { layout, useColor } from "../../src/theme";

/**
 * Home is the front porch of the family's story — a welcome, the people in it,
 * one thing worth capturing today, and a quiet record of what's happened.
 * Deliberately not a dashboard.
 */
export default function HomeScreen() {
  const { data, error, loading, refetch } = useApi<HomePayload>("/api/home");
  const insets = useSafeAreaInsets();

  // New memories should be here the moment you come back from Capture.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          eyebrow="Little by little"
          accessory={<FamilyPill />}
          title="Home"
          sparkle
          subtitle={data ? `${data.greeting.salutation}. ${data.greeting.message}` : undefined}
          onSettings={() => router.push("/family")}
          onSearch={() => router.push("/search")}
        />
        {error && !data ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}
        {data ? <HomeBody data={data} onChanged={() => void refetch()} /> : null}
      </Column>
    </ScrollView>
  );
}

/** Starting points for the first memory, each one opens Capture with it as the prompt. */
const STARTER_IDEAS = [
  "A photo of today, just as it is",
  "How the two of you met",
  "Something someone said this week",
];

/** The invite sheet lives on the Family screen; ?invite=1 opens it on arrival. */
function openInvite() {
  router.push({ pathname: "/family", params: { invite: "1" } });
}

/** Below this many people, Your People offers empty places to fill. */
const SMALL_FAMILY = 4;

function HomeBody({ data, onChanged }: { data: HomePayload; onChanged: () => void }) {
  const canContribute = useCanContribute();
  const isOwner = useSession().family?.role === "OWNER";
  const [adding, setAdding] = useState<"person" | "child" | null>(null);
  // Today's prompt is an invitation to capture, which a VIEWER can't take up.
  const prompt = canContribute ? data.prompt : null;
  const addPerson = () => setAdding("person");
  const cream = useColor("cream");
  // A small family gets an empty place in the rail to add to; a bigger one, the header button.
  const addInRail = canContribute && data.people.length < SMALL_FAMILY;

  return (
    <>
      {canContribute ? (
        <GettingStarted
          progress={data.gettingStarted}
          isOwner={isOwner}
          onAddPerson={addPerson}
          onAddChild={() => setAdding("child")}
          onInvite={openInvite}
        />
      ) : null}

      <SectionHeader
        label="Your People"
        first={!canContribute}
        action={
          canContribute && !addInRail ? (
            <SmallButton label="Add" icon="add" accessibilityLabel="Add someone" onPress={addPerson} />
          ) : null
        }
      />
      {/* Rails scroll edge to edge, past the column's gutter, and rest aligned with it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-gutter"
        contentContainerClassName="px-gutter gap-4"
      >
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
      </ScrollView>

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
            {/* Whimsical shape 1/6 — twinkle, on the one moment worth capturing today. */}
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-gutter"
          contentContainerClassName="px-gutter gap-3"
        >
          {data.storySoFar.map((memory) => (
            <MemoryTile key={memory.id} memory={memory} />
          ))}
        </ScrollView>
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
        <AddPersonSheet onClose={() => setAdding(null)} onAdded={onChanged} />
      ) : null}
      {adding === "child" ? (
        <AddChildSheet onClose={() => setAdding(null)} onAdded={onChanged} />
      ) : null}
    </>
  );
}

/**
 * The first few things that make the archive worth opening, ticked off as
 * the family does them and gone once they're all done. Inviting is the
 * owner's alone, so it's only on their list.
 */
function GettingStarted({
  progress,
  isOwner,
  onAddPerson,
  onAddChild,
  onInvite,
}: {
  progress: HomePayload["gettingStarted"];
  isOwner: boolean;
  onAddPerson: () => void;
  onAddChild: () => void;
  onInvite: () => void;
}) {
  const steps = [
    { done: progress.firstMemory, label: "Preserve your first memory", onPress: () => router.push("/capture") },
    { done: progress.addedSomeone, label: "Add someone to Your People", onPress: onAddPerson },
    { done: progress.addedChild, label: "Add a child", onPress: onAddChild },
    ...(isOwner ? [{ done: progress.invitedSomeone, label: "Invite family to join", onPress: onInvite }] : []),
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <>
      <SectionHeader
        label="Getting Started"
        first
        action={<Text className="type-caption">{`${doneCount} of ${steps.length}`}</Text>}
      />
      <View className="rounded-lg bg-surface border border-line px-4">
        {steps.map((step, i) => (
          <Pressable
            key={step.label}
            onPress={step.onPress}
            disabled={step.done}
            accessibilityRole="button"
            accessibilityState={{ disabled: step.done, checked: step.done }}
            className={`flex-row items-center gap-3 py-3 active:opacity-70 ${i > 0 ? "border-t border-line" : ""}`}
          >
            <Ionicons
              name={step.done ? "checkmark-circle" : "ellipse-outline"}
              size={22}
              colorClassName={step.done ? "accent-primary" : "accent-muted"}
            />
            <Text
              className={`flex-1 text-[15px] ${
                step.done ? "font-sans text-muted line-through" : "font-sans-bold text-ink"
              }`}
            >
              {step.label}
            </Text>
            {step.done ? null : <Ionicons name="chevron-forward" size={16} colorClassName="accent-muted" />}
          </Pressable>
        ))}
      </View>
    </>
  );
}

/** An empty place at the end of Your People, the size of a person. */
function PlaceholderChip({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  // Sized like a PersonChip, so the rail's rhythm carries on into the gaps.
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

/** What Your Story So Far says before there's a story. */
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
