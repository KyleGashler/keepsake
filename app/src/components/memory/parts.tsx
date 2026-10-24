import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { mediaUrl, type MemoryCard, type Person } from "../../api";
import { shortDate } from "../../format";
import { routes } from "../../routes";
import { Image, Ionicons, type IoniconName } from "../../styled";
import { paragraphs, pseudoWaveform } from "./helpers";

// ---------------------------------------------------------------------------
// Story / Original Words
// ---------------------------------------------------------------------------

export type WordsView = "story" | "transcript";

/** The two-way pill at the top of the content card; the chosen side fills deep teal. */
export function WordsToggle({ value, onChange }: { value: WordsView; onChange: (next: WordsView) => void }) {
  return (
    <View
      className="flex-row self-center rounded-full border border-line bg-surface p-[3px]"
      accessibilityRole="tablist"
    >
      {(["story", "transcript"] as const).map((key) => {
        const selected = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className={`min-w-[132px] rounded-full px-4 py-[9px] ${selected ? "bg-primary" : ""}`}
          >
            <Text
              className={`text-center font-sans-semibold text-[14.5px] ${selected ? "text-on-primary" : "text-ink"}`}
            >
              {key === "story" ? "Story" : "Original Words"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Past this, a lead in the display serif reads as a wall; it falls back to the sans. */
const SERIF_LEAD_MAX = 220;

/**
 * The story. The first paragraph is the lead, set larger in teal-grey under
 * the title; the rest reads below it. A memory with nothing but words is all
 * story, so it's set bigger and roomier: the lead in the display serif (when
 * it's short enough to carry it — DM Serif is a display face) and the rest
 * in generous sans.
 */
export function StoryText({ story, textOnly }: { story: string; textOnly: boolean }) {
  const [lead, ...rest] = paragraphs(story);
  if (!lead) return null;
  let leadClass = "font-sans text-[17px] leading-[25px] text-ink-soft";
  if (textOnly) {
    leadClass =
      lead.text.length <= SERIF_LEAD_MAX
        ? "font-display text-[21px] leading-[30px] text-ink"
        : "font-sans text-[19px] leading-[31px] text-ink";
  }
  return (
    <View className={textOnly ? "gap-4" : "gap-3.5"}>
      <Text className={leadClass}>{lead.text}</Text>
      {rest.map((p) => (
        <Text
          key={p.key}
          className={
            textOnly
              ? "font-sans text-[17.5px] leading-[30px] text-ink"
              : "font-sans text-[16px] leading-[26px] text-ink"
          }
        >
          {p.text}
        </Text>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const STACK = 4;

/** Who was there: overlapping faces, "+N" past four. "+N" opens the rest. */
export function AvatarStack({ people }: { people: Person[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, STACK);
  const extra = people.length - shown.length;
  return (
    <View className="flex-row flex-wrap items-center gap-y-1.5" accessibilityLabel={`With ${people.map((p) => p.name).join(", ")}`}>
      {shown.map((person, i) => (
        <Pressable
          key={person.id}
          onPress={() => router.push(routes.person(person.id))}
          accessibilityRole="button"
          accessibilityLabel={person.name}
          className="h-8 w-8 overflow-hidden rounded-full border-2 border-surface bg-surface-alt"
          style={{ marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i }}
        >
          <Image
            source={{ uri: mediaUrl(person.avatarUrl) }}
            className="absolute inset-0"
            contentFit="cover"
            transition={150}
          />
        </Pressable>
      ))}
      {extra > 0 ? (
        <Pressable
          onPress={() => setAll(true)}
          accessibilityRole="button"
          accessibilityLabel={`${extra} more people`}
          className="ml-1 h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-surface-alt bg-surface-alt"
        >
          <Text className="font-sans-semibold text-[12.5px] text-ink-soft">+{extra}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A titled block under a hairline — "Media", "Audio", "Memory Details". */
export function Section({ title, children, divider = true }: { title: string; children: ReactNode; divider?: boolean }) {
  return (
    <View
      className="mt-4 gap-3 border-line pt-4"
      style={divider ? { borderTopWidth: StyleSheet.hairlineWidth } : undefined}
    >
      <Text className="font-sans-bold text-[15.5px] text-ink" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** One line of Memory Details: glyph and label on the left, the value on the right. */
export function DetailRow({
  icon,
  label,
  children,
}: {
  icon: IoniconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <View className="flex-row items-start gap-3 py-1">
      <Ionicons name={icon} size={19} colorClassName="accent-ink-soft" />
      <Text className="font-sans text-[15px] leading-[21px] text-ink">{label}</Text>
      <View className="flex-1 items-end gap-1.5">{children}</View>
    </View>
  );
}

export function DetailValue({ children, onPress }: { children: string; onPress?: () => void }) {
  if (!onPress) {
    return <Text className="text-right font-sans text-[15px] leading-[21px] text-ink-soft">{children}</Text>;
  }
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="link" className="active:opacity-60">
      <Text className="text-right font-sans text-[15px] leading-[21px] text-ink underline decoration-line">
        {children}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Related
// ---------------------------------------------------------------------------

/** "Related Memories": a sideways row of small cards. */
export function RelatedRow({ memories }: { memories: MemoryCard[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-3 px-6"
      className="-mx-6"
    >
      {memories.map((m) => (
        <RelatedCard key={m.id} memory={m} />
      ))}
    </ScrollView>
  );
}

function RelatedCard({ memory }: { memory: MemoryCard }) {
  return (
    <Pressable
      onPress={() => router.push(routes.memory(memory.id))}
      accessibilityRole="button"
      accessibilityLabel={`${memory.title}, ${shortDate(memory.occurredAt)}`}
      className="w-[148px] overflow-hidden rounded-sm border border-line bg-surface active:opacity-80"
    >
      <View className="h-[84px] bg-surface-alt">
        <CardArt memory={memory} />
      </View>
      <View className="gap-px px-3 py-2.5">
        <Text className="font-sans-semibold text-[13.5px] text-ink" numberOfLines={1}>
          {memory.title}
        </Text>
        <Text className="font-sans text-[12.5px] text-muted">{shortDate(memory.occurredAt)}</Text>
      </View>
    </Pressable>
  );
}

/**
 * A small card's picture. A photo when there is one; a memory of words gets
 * its opening words; a video with no photo shows its poster under a play
 * glyph; a recording gets a quiet waveform, never the generated stand-in.
 */
export function CardArt({ memory, compact = false }: { memory: MemoryCard; compact?: boolean }) {
  const types = memory.mediaTypes;
  if (memory.isTextOnly) {
    return (
      <View className="absolute inset-0 items-center justify-center bg-peach p-3">
        {!compact && memory.excerpt ? (
          <Text className="text-center font-display text-[13.5px] leading-[18px] text-ink" numberOfLines={3}>
            “{memory.excerpt}”
          </Text>
        ) : (
          <Ionicons name="chatbubble-ellipses-outline" size={compact ? 18 : 22} colorClassName="accent-accent-deep" />
        )}
      </View>
    );
  }
  if (!types.includes("PHOTO") && types.includes("VIDEO")) {
    // `heroUrl` is the video's poster frame. The deep tile shows through
    // while the clip is still being prepared, and the glyph sits on top.
    return (
      <View className="absolute inset-0 items-center justify-center bg-ink">
        <Image
          source={{ uri: mediaUrl(memory.heroUrl) }}
          className="absolute inset-0"
          contentFit="cover"
          transition={200}
          recyclingKey={memory.id}
        />
        <Ionicons name="play-circle-outline" size={compact ? 20 : 26} colorClassName="accent-white/80" />
      </View>
    );
  }
  if (!types.includes("PHOTO")) {
    return (
      <View className="absolute inset-0 items-center justify-center bg-accent-soft">
        {compact ? (
          <Ionicons name="mic-outline" size={18} colorClassName="accent-accent-deep" />
        ) : (
          <MiniWave seed={memory.id} />
        )}
      </View>
    );
  }
  return (
    <Image
      source={{ uri: mediaUrl(memory.heroUrl) }}
      className="absolute inset-0"
      contentFit="cover"
      transition={200}
      recyclingKey={memory.id}
    />
  );
}

function MiniWave({ seed }: { seed: string }) {
  return (
    <View className="flex-row items-center gap-[2.5px]">
      {pseudoWaveform(seed, 18).map((bar) => (
        <View
          key={bar.key}
          className="w-[2.5px] rounded-[1.5px] bg-accent"
          style={{ height: 4 + bar.height * 26 }}
        />
      ))}
    </View>
  );
}
