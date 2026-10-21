import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  mediaUrl,
  type ChildSummary,
  type Collection,
  type MediaType,
  type MemoryCard,
} from "../api";
import { ageOn, longDate, monthDay } from "../format";
import { colors, fonts, radius, shadow, spacing } from "../theme";

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

const MEDIA_GLYPHS: Record<MediaType, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
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
      style={({ pressed }) => [styles.row, !isLast && styles.rowDivider, pressed && styles.pressed]}
    >
      {memory.isTextOnly ? (
        <View style={[styles.rule, { backgroundColor: collection.color }]} />
      ) : (
        <Image
          source={{ uri: mediaUrl(memory.heroUrl) }}
          style={styles.thumb}
          contentFit="cover"
          transition={200}
        />
      )}
      <View style={styles.rowText}>
        <Text style={styles.dateEyebrow} numberOfLines={1}>
          {eyebrow}
        </Text>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {memory.title}
        </Text>
        {memory.excerpt ? (
          <Text style={styles.excerpt} numberOfLines={memory.isTextOnly ? 3 : 2}>
            {memory.excerpt}
          </Text>
        ) : null}
        <MediaGlyphs types={memory.mediaTypes} count={memory.mediaCount} />
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} style={styles.chevron} />
    </Pressable>
  );
}

function MediaGlyphs({ types, count }: { types: MediaType[]; count: number }) {
  if (types.length === 0) return null;
  return (
    <View
      style={styles.glyphs}
      accessible
      accessibilityLabel={types.map((t) => MEDIA_GLYPHS[t].label).join(", ")}
    >
      {types.map((t) => (
        <Ionicons key={t} name={MEDIA_GLYPHS[t].icon} size={15} color={colors.muted} />
      ))}
      {count > 1 ? <Text style={styles.glyphCount}>{count}</Text> : null}
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
      style={({ pressed }) => [styles.quoteCard, pressed && styles.cardPressed]}
    >
      <Text style={styles.quoteMark} aria-hidden>
        “
      </Text>
      {heading ? <Text style={styles.quoteHeading}>{heading}</Text> : null}
      <Text style={styles.quoteText}>{quote}</Text>
      {context ? (
        <Text style={styles.quoteContext} numberOfLines={3}>
          {context}
        </Text>
      ) : null}
      <View style={styles.attribution}>
        <View style={styles.attributionRule} />
        <Text style={styles.attributionText} numberOfLines={1}>
          {[speaker, longDate(memory.occurredAt)].filter(Boolean).join("  ·  ")}
        </Text>
        {hasAudio ? <Ionicons name="mic-outline" size={15} color={colors.muted} /> : null}
      </View>
    </Pressable>
  );
}

const THUMB = 84;

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  rule: { width: 3, alignSelf: "stretch", borderRadius: 2, marginVertical: 2, opacity: 0.85 },
  rowText: { flex: 1, minWidth: 0 },
  dateEyebrow: {
    fontFamily: fonts.sansBold,
    fontSize: 11.5,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 3,
  },
  rowTitle: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: colors.ink },
  excerpt: {
    fontFamily: fonts.sans,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkSoft,
    marginTop: 4,
  },
  glyphs: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm },
  glyphCount: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.muted, marginLeft: -3 },
  chevron: { alignSelf: "center" },

  quoteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg + 2,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
    ...shadow,
  },
  quoteMark: {
    fontFamily: fonts.display,
    fontSize: 64,
    lineHeight: 64,
    height: 40,
    color: colors.accent,
    marginLeft: -3,
  },
  quoteHeading: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  quoteText: { fontFamily: fonts.display, fontSize: 25, lineHeight: 32, color: colors.ink },
  quoteContext: {
    fontFamily: fonts.sans,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkSoft,
    marginTop: spacing.sm,
  },
  attribution: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  attributionRule: { width: 18, height: 1.5, borderRadius: 1, backgroundColor: colors.accent },
  attributionText: {
    flexShrink: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: 13.5,
    color: colors.muted,
  },
});
