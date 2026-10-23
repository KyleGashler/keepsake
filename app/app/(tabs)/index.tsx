import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { colors, fonts, layout, radius, spacing, type } from "../../src/theme";

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
      style={styles.screen}
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
          canContribute ? (
            <SmallButton label="Add" icon="add" accessibilityLabel="Add someone" onPress={addPerson} />
          ) : null
        }
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={[styles.railContent, { gap: spacing.lg }]}
      >
        {data.people.map((person) => (
          <PersonChip
            key={person.id}
            person={person}
            onPress={() => router.push(`/person/${person.id}`)}
          />
        ))}
        {canContribute && data.people.length < SMALL_FAMILY ? (
          <PlaceholderChip icon="add" label="Add someone" onPress={addPerson} />
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
            style={({ pressed }) => [styles.hero, pressed && { opacity: 0.85 }]}
          >
            <Image
              source={{ uri: mediaUrl(prompt.imageUrl) }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
            />
            <View style={styles.heroScrim} />
            {/* Whimsical shape 1/6 — twinkle, on the one moment worth capturing today. */}
            <Twinkle size={22} color="#FFF7EF" opacity={0.9} style={styles.heroTwinkle} />
            <View style={styles.heroBody}>
              <Text style={styles.heroText}>{prompt.text}</Text>
              {prompt.subtitle ? <Text style={styles.heroSub}>{prompt.subtitle}</Text> : null}
              <View style={styles.heroCta}>
                <Ionicons name="add" size={16} color={colors.ink} />
                <Text style={styles.heroCtaText}>Preserve this</Text>
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
          style={styles.rail}
          contentContainerStyle={[styles.railContent, { gap: spacing.md }]}
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
          <View style={styles.updates}>
            {data.updates.map((update) => (
              <View key={update.id} style={styles.update}>
                {update.actor ? (
                  <Avatar person={update.actor} size={34} />
                ) : (
                  <View style={styles.updateDot} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontSize: 14.5 }]}>{update.message}</Text>
                  <Text style={type.caption}>{relativeTime(update.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {data.stats.memoryCount ? (
        <Text style={styles.footer}>
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
        action={<Text style={type.caption}>{`${doneCount} of ${steps.length}`}</Text>}
      />
      <View style={styles.checklist}>
        {steps.map((step, i) => (
          <Pressable
            key={step.label}
            onPress={step.onPress}
            disabled={step.done}
            accessibilityRole="button"
            accessibilityState={{ disabled: step.done, checked: step.done }}
            style={({ pressed }) => [styles.step, i > 0 && styles.stepDivider, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={step.done ? "checkmark-circle" : "ellipse-outline"}
              size={22}
              color={step.done ? colors.primary : colors.muted}
            />
            <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>{step.label}</Text>
            {step.done ? null : <Ionicons name="chevron-forward" size={16} color={colors.muted} />}
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
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.placeholder, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.placeholderCircle}>
        <Ionicons name={icon} size={22} color={colors.muted} />
      </View>
      <Text style={styles.placeholderLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** What Your Story So Far says before there's a story. */
function FirstMemory({ canContribute }: { canContribute: boolean }) {
  if (!canContribute) {
    return (
      <Text style={type.caption}>Nothing here yet. When your family preserves a memory, it will appear here.</Text>
    );
  }
  return (
    <View style={styles.first}>
      <Sparkle size={30} variant="filled" />
      <Text style={styles.firstTitle}>Your story starts with one memory</Text>
      <Text style={styles.firstBody}>A photo, a voice note, a few lines. It doesn't need to be perfect, only true.</Text>
      <Button label="Preserve your first memory" icon="add" onPress={() => router.push("/capture")} />
      <Text style={[type.label, { marginTop: spacing.sm }]}>Or start with</Text>
      <View style={styles.ideas}>
        {STARTER_IDEAS.map((idea) => (
          <Pressable
            key={idea}
            onPress={() => router.push({ pathname: "/capture/compose", params: { prompt: idea } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.idea, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.ideaLabel}>{idea}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Rails scroll edge to edge, past the column's gutter, and rest aligned with it.
  rail: { marginHorizontal: -layout.gutter },
  railContent: { paddingHorizontal: layout.gutter },
  hero: {
    height: 300,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    justifyContent: "flex-end",
  },
  heroScrim: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(47,54,46,0.36)",
  },
  heroTwinkle: { position: "absolute", top: spacing.lg, right: spacing.lg },
  heroBody: { padding: spacing.xl, gap: spacing.sm },
  heroText: {
    fontFamily: type.display.fontFamily,
    fontSize: 26,
    lineHeight: 33,
    color: "#FFF7EF",
  },
  heroSub: { fontSize: 14, lineHeight: 20, color: "rgba(255,247,239,0.85)" },
  heroCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,247,239,0.94)",
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  heroCtaText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  updates: { gap: spacing.lg },
  update: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  updateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginHorizontal: 13,
  },
  footer: { ...type.caption, textAlign: "center", marginTop: layout.section },
  checklist: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
  },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  stepDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  stepLabel: { flex: 1, fontFamily: fonts.sansBold, fontSize: 15, color: colors.ink },
  stepLabelDone: { color: colors.muted, textDecorationLine: "line-through", fontFamily: fonts.sans },
  // Sized like a PersonChip, so the rail's rhythm carries on into the gaps.
  placeholder: { width: 74, alignItems: "center", gap: 6 },
  placeholderCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
  first: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    gap: spacing.md,
  },
  firstTitle: { ...type.title, textAlign: "center" },
  firstBody: { ...type.body, textAlign: "center", maxWidth: 340 },
  ideas: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  idea: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  ideaLabel: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink },
});
