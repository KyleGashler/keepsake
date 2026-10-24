import type { Ionicons as BaseIonicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  mediaUrl,
  type ChildSummary,
  type Collection,
  type MediaType,
  type MemoryCard,
} from "../api";
import { ageOn, longDate, monthDay } from "../format";
import { Image, Ionicons } from "../styled";

/**
 * How one memory reads inside a collection's archive. src/archive.ts maps a
 * collection's kind to one of these.
 */
export type EntryProps = {
  memory: MemoryCard;
  collection: Collection;
  /** The child the collection belongs to, if any. */
  child: ChildSummary | null;
  onPress: () => void;
  /** The last entry under its year heading — list renderers drop their hairline. */
  isLast: boolean;
};

// ---------------------------------------------------------------------------
// Default: a photo-or-words row
// ---------------------------------------------------------------------------

const MEDIA_GLYPHS: Record<MediaType, { icon: keyof typeof BaseIonicons.glyphMap; label: string }> = {
  PHOTO: { icon: "image-outline", label: "Photos" },
  VIDEO: { icon: "videocam-outline", label: "Video" },
  AUDIO: { icon: "mic-outline", label: "Audio" },
};

/**
 * A memory with media leads with its photo; a text-only one (a story, a note)
 * is set as words, with a rule in the collection's colour where a photo would
 * be — never a stand-in image.
 */
export function MemoryEntry({ memory, collection, onPress, isLast }: EntryProps) {
  const eyebrow = [monthDay(memory.occurredAt), memory.location].filter(Boolean).join("  ·  ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${memory.title}, ${longDate(memory.occurredAt)}`}
      className="flex-row items-start gap-4 border-b-line py-4 active:opacity-70"
      style={isLast ? undefined : { borderBottomWidth: StyleSheet.hairlineWidth }}
    >
      {memory.isTextOnly ? (
        <View className="my-0.5 w-[3px] self-stretch rounded-[2px] opacity-85" style={{ backgroundColor: collection.color }} />
      ) : (
        <Image
          source={{ uri: mediaUrl(memory.heroUrl) }}
          className="h-21 w-21 rounded-md bg-surface-alt"
          contentFit="cover"
          transition={200}
        />
      )}
      <View className="min-w-0 flex-1">
        <Text className="mb-[3px] font-sans-bold text-[11.5px] tracking-[1.3px] text-muted uppercase" numberOfLines={1}>
          {eyebrow}
        </Text>
        <Text className="font-display text-[21px] leading-[26px] text-ink" numberOfLines={2}>
          {memory.title}
        </Text>
        {memory.excerpt ? (
          <Text className="mt-1 font-sans text-[14.5px] leading-[21px] text-ink-soft" numberOfLines={memory.isTextOnly ? 3 : 2}>
            {memory.excerpt}
          </Text>
        ) : null}
        <MediaGlyphs types={memory.mediaTypes} count={memory.mediaCount} />
      </View>
      <Ionicons name="chevron-forward" size={18} colorClassName="accent-ink-soft" className="self-center" />
    </Pressable>
  );
}

function MediaGlyphs({ types, count }: { types: MediaType[]; count: number }) {
  if (types.length === 0) return null;
  return (
    <View
      className="mt-2 flex-row items-center gap-2"
      accessible
      accessibilityLabel={types.map((t) => MEDIA_GLYPHS[t].label).join(", ")}
    >
      {types.map((t) => (
        <Ionicons key={t} name={MEDIA_GLYPHS[t].icon} size={15} colorClassName="accent-muted" />
      ))}
      {count > 1 ? <Text className="-ml-[3px] font-sans-semibold text-[12.5px] text-muted">{count}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Quotes: a pull-quote card
// ---------------------------------------------------------------------------

const QUOTE_MARKS = /^[\s"“”‘’']+|[\s"“”‘’']+$/g;

/**
 * Which words are the quote. Quotes are usually captured with the words as
 * the title (in quote marks) and the circumstances as the story; a title
 * that isn't quoted but has a story is a heading over the quoted story.
 */
function quoteParts(memory: MemoryCard) {
  const titleIsQuote = /^\s*["“‘']/.test(memory.title) || !memory.excerpt;
  if (titleIsQuote) {
    return { quote: memory.title.replace(QUOTE_MARKS, ""), heading: null, context: memory.excerpt };
  }
  const excerpt = memory.excerpt ?? "";
  // The card excerpt is the story's first 140 characters.
  const quote = excerpt.replace(QUOTE_MARKS, "") + (excerpt.length >= 140 ? "…" : "");
  return { quote, heading: memory.title, context: null };
}

/** Someone's words, large, with who said them, how old they were, and when. */
export function QuoteEntry({ memory, child, onPress }: EntryProps) {
  const { quote, heading, context } = quoteParts(memory);
  const speaker = child ? [child.name, ageOn(child.birthDate, memory.occurredAt)].filter(Boolean).join(", ") : null;
  const hasAudio = memory.mediaTypes.includes("AUDIO") || memory.mediaTypes.includes("VIDEO");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`“${quote}”${speaker ? `, ${speaker}` : ""}, ${longDate(memory.occurredAt)}`}
      className="mb-3 rounded-lg bg-surface px-6 pt-3 pb-[18px] shadow-card active:scale-[0.995] active:opacity-90"
    >
      <Text className="-ml-[3px] h-10 font-display text-[64px] leading-[64px] text-accent" aria-hidden>
        “
      </Text>
      {heading ? <Text className="mb-1 font-sans-bold text-[12px] tracking-[1.3px] text-muted uppercase">{heading}</Text> : null}
      <Text className="font-display text-[25px] leading-[32px] text-ink">{quote}</Text>
      {context ? (
        <Text className="mt-2 font-sans text-[14.5px] leading-[21px] text-ink-soft" numberOfLines={3}>
          {context}
        </Text>
      ) : null}
      <View className="mt-3 flex-row items-center gap-2">
        <View className="h-[1.5px] w-[18px] rounded-[1px] bg-accent" />
        <Text className="shrink font-sans-semibold text-[13.5px] text-muted" numberOfLines={1}>
          {[speaker, longDate(memory.occurredAt)].filter(Boolean).join("  ·  ")}
        </Text>
        {hasAudio ? <Ionicons name="mic-outline" size={15} colorClassName="accent-muted" /> : null}
      </View>
    </Pressable>
  );
}
