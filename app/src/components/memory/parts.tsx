import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";
import { mediaUrl, type MemoryCard, type Person } from "../../api";
import { shortDate } from "../../format";
import { brand, colors, fonts, radius, spacing } from "../../theme";
import { routes } from "../../routes";
import { paragraphs, pseudoWaveform } from "./helpers";

// ---------------------------------------------------------------------------
// Story / Original Words
// ---------------------------------------------------------------------------

export type WordsView = "story" | "transcript";

/** The two-way pill at the top of the content card; the chosen side fills deep teal. */
export function WordsToggle({ value, onChange }: { value: WordsView; onChange: (next: WordsView) => void }) {
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      {(["story", "transcript"] as const).map((key) => {
        const selected = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.toggleItem, selected && styles.toggleItemOn]}
          >
            <Text style={[styles.toggleLabel, selected && styles.toggleLabelOn]}>
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
  let leadStyle: TextStyle = styles.lead;
  if (textOnly) leadStyle = lead.text.length <= SERIF_LEAD_MAX ? styles.serifLead : styles.roomyLead;
  return (
    <View style={{ gap: textOnly ? spacing.lg : spacing.md + 2 }}>
      <Text style={leadStyle}>{lead.text}</Text>
      {rest.map((p) => (
        <Text key={p.key} style={textOnly ? styles.roomyBody : styles.body}>
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
    <View style={styles.stack} accessibilityLabel={`With ${people.map((p) => p.name).join(", ")}`}>
      {shown.map((person, i) => (
        <Pressable
          key={person.id}
          onPress={() => router.push(routes.person(person.id))}
          accessibilityRole="button"
          accessibilityLabel={person.name}
          style={[styles.face, { marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i }]}
        >
          <Image
            source={{ uri: mediaUrl(person.avatarUrl) }}
            style={StyleSheet.absoluteFill}
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
          style={[styles.face, styles.more]}
        >
          <Text style={styles.moreText}>+{extra}</Text>
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
    <View style={[styles.section, divider && styles.sectionDivider]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
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
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.detail}>
      <Ionicons name={icon} size={19} color={colors.inkSoft} />
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValue}>{children}</View>
    </View>
  );
}

export function DetailValue({ children, onPress }: { children: string; onPress?: () => void }) {
  if (!onPress) return <Text style={styles.detailValueText}>{children}</Text>;
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="link" style={({ pressed }) => pressed && { opacity: 0.6 }}>
      <Text style={[styles.detailValueText, styles.detailLink]}>{children}</Text>
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
      contentContainerStyle={styles.relatedRow}
      style={styles.relatedScroll}
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
      style={({ pressed }) => [styles.related, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.relatedArt}>
        <CardArt memory={memory} />
      </View>
      <View style={styles.relatedText}>
        <Text style={styles.relatedTitle} numberOfLines={1}>
          {memory.title}
        </Text>
        <Text style={styles.relatedDate}>{shortDate(memory.occurredAt)}</Text>
      </View>
    </Pressable>
  );
}

/**
 * A small card's picture. A photo when there is one; a memory of words gets
 * its opening words; a video with no photo (no poster frames yet) and a
 * recording get a quiet glyph, never the generated stand-in.
 */
export function CardArt({ memory, compact = false }: { memory: MemoryCard; compact?: boolean }) {
  const types = memory.mediaTypes;
  if (memory.isTextOnly) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.wordsArt]}>
        {!compact && memory.excerpt ? (
          <Text style={styles.wordsText} numberOfLines={3}>
            “{memory.excerpt}”
          </Text>
        ) : (
          <Ionicons name="chatbubble-ellipses-outline" size={compact ? 18 : 22} color={colors.accentDeep} />
        )}
      </View>
    );
  }
  if (!types.includes("PHOTO") && types.includes("VIDEO")) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.glyphArt, { backgroundColor: colors.ink }]}>
        <Ionicons name="play-circle-outline" size={compact ? 20 : 26} color="rgba(255,255,255,0.8)" />
      </View>
    );
  }
  if (!types.includes("PHOTO")) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.glyphArt, { backgroundColor: colors.accentSoft }]}>
        {compact ? (
          <Ionicons name="mic-outline" size={18} color={colors.accentDeep} />
        ) : (
          <MiniWave seed={memory.id} />
        )}
      </View>
    );
  }
  return (
    <Image
      source={{ uri: mediaUrl(memory.heroUrl) }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={200}
      recyclingKey={memory.id}
    />
  );
}

function MiniWave({ seed }: { seed: string }) {
  return (
    <View style={styles.miniWave}>
      {pseudoWaveform(seed, 18).map((bar) => (
        <View key={bar.key} style={[styles.miniBar, { height: 4 + bar.height * 26 }]} />
      ))}
    </View>
  );
}

const RELATED_W = 148;

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    padding: 3,
    backgroundColor: colors.surface,
  },
  toggleItem: { minWidth: 132, paddingVertical: 9, paddingHorizontal: spacing.lg, borderRadius: radius.pill },
  toggleItemOn: { backgroundColor: colors.primary },
  toggleLabel: { fontFamily: fonts.sansSemiBold, fontSize: 14.5, color: colors.ink, textAlign: "center" },
  toggleLabelOn: { color: colors.onPrimary },

  lead: { fontFamily: fonts.sans, fontSize: 17, lineHeight: 25, color: colors.inkSoft },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 26, color: colors.ink },
  serifLead: { fontFamily: fonts.display, fontSize: 21, lineHeight: 30, color: colors.ink },
  roomyLead: { fontFamily: fonts.sans, fontSize: 19, lineHeight: 31, color: colors.ink },
  roomyBody: { fontFamily: fonts.sans, fontSize: 17.5, lineHeight: 30, color: colors.ink },

  stack: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", rowGap: 6 },
  face: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.surfaceAlt,
  },
  more: { marginLeft: 4, alignItems: "center", justifyContent: "center", borderColor: colors.surfaceAlt },
  moreText: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.inkSoft },

  section: { paddingTop: spacing.lg, marginTop: spacing.lg, gap: spacing.md },
  sectionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  sectionTitle: { fontFamily: fonts.sansBold, fontSize: 15.5, color: colors.ink },

  detail: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: 4 },
  detailLabel: { fontFamily: fonts.sans, fontSize: 15, color: colors.ink, lineHeight: 21 },
  detailValue: { flex: 1, alignItems: "flex-end", gap: 6 },
  detailValueText: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, color: colors.inkSoft, textAlign: "right" },
  detailLink: { color: colors.ink, textDecorationLine: "underline", textDecorationColor: colors.line },

  relatedScroll: { marginHorizontal: -spacing.xl },
  relatedRow: { gap: spacing.md, paddingHorizontal: spacing.xl },
  related: {
    width: RELATED_W,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  relatedArt: { height: 84, backgroundColor: colors.surfaceAlt },
  relatedText: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: 1 },
  relatedTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13.5, color: colors.ink },
  relatedDate: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted },

  wordsArt: { backgroundColor: brand.peach, alignItems: "center", justifyContent: "center", padding: spacing.md },
  wordsText: { fontFamily: fonts.display, fontSize: 13.5, lineHeight: 18, color: colors.ink, textAlign: "center" },
  glyphArt: { alignItems: "center", justifyContent: "center" },
  miniWave: { flexDirection: "row", alignItems: "center", gap: 2.5 },
  miniBar: { width: 2.5, borderRadius: 1.5, backgroundColor: colors.accent },
});
