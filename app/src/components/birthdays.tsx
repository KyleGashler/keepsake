import type { Href } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { mediaUrl, type ChildSummary, type MediaType } from "../api";
import { count } from "../format";
import { Image, Ionicons, type IoniconName } from "../styled";
import { useColor } from "../theme";
import { BackRow, ChildPortrait } from "./child-header";
import { Glyph, Sparkle } from "./journey";

/**
 * The pieces of the Birthdays screens: a child's Birthdays grid and one
 * birthday's categories (library/birthdays, library/birthday).
 */

/** Back row with an optional ⋯, then the child's portrait beside the title, a cake, and a line under it. */
export function BirthdayHeader({
  child,
  title,
  subtitle,
  backLabel,
  backParent,
  onMore,
  moreLabel,
}: {
  child: ChildSummary | null;
  title: string;
  subtitle: string;
  backLabel: string;
  backParent: Href;
  onMore?: () => void;
  moreLabel: string;
}) {
  const terracotta = useColor("terracotta");
  return (
    <View>
      <BackRow label={backLabel} parent={backParent} onMore={onMore} moreLabel={moreLabel} />
      <View className="flex-row items-center gap-4">
        {child ? (
          <View>
            <ChildPortrait child={child} size={68} uri={child.photoThumbUrl} />
            <Sparkle size={18} className="absolute -right-3 -top-3" />
          </View>
        ) : null}
        <View className="flex-1">
          <View className="flex-row items-start gap-3">
            <Text
              className="shrink font-display text-[34px] leading-[40px] tracking-[-0.4px] text-ink"
              accessibilityRole="header"
            >
              {title}
            </Text>
            <View className="ml-auto pt-1.5">
              <Glyph icon="cake" size={26} color={terracotta} />
            </View>
          </View>
          <Text className="mt-0.5 font-sans text-[15px] leading-[21px] text-ink-soft">{subtitle}</Text>
        </View>
      </View>
    </View>
  );
}

/** One birthday in the two-column grid: a photo (or a cake on peach), its name and how many memories. */
export function BirthdayTile({
  name,
  memoryCount,
  coverUrl,
  onPress,
}: {
  name: string;
  memoryCount: number;
  coverUrl: string | null;
  onPress: () => void;
}) {
  const terracotta = useColor("terracotta");
  const uri = mediaUrl(coverUrl);
  const memories = count(memoryCount, "memory", "memories");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${memories}`}
      className="mb-5 w-[48%] active:opacity-80"
    >
      <View className="aspect-[6/5] items-center justify-center overflow-hidden rounded-[14px] bg-peach">
        {uri ? (
          <Image source={{ uri }} className="absolute inset-0" contentFit="cover" transition={200} />
        ) : (
          <Glyph icon="cake" size={36} color={terracotta} />
        )}
      </View>
      <View className="mt-2 flex-row items-center gap-1">
        <View className="flex-1">
          <Text className="font-display text-[18px] leading-[23px] text-ink" numberOfLines={1}>
            {name}
          </Text>
          <Text className="font-sans text-[13px] leading-[18px] text-ink-soft">{memories}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} colorClassName="accent-ink-soft" />
      </View>
    </Pressable>
  );
}

const MEDIA_ICONS: Record<MediaType, { icon: IoniconName; label: string }> = {
  PHOTO: { icon: "image-outline", label: "photos" },
  VIDEO: { icon: "videocam-outline", label: "video" },
  AUDIO: { icon: "mic-outline", label: "audio" },
};

/**
 * A category: a rounded thumbnail with small white marks for the media it
 * holds, the name, one line of story, and a chevron — or, while editing, the
 * controls passed as `trailing`.
 */
export function CategoryRow({
  title,
  preview,
  thumbUrl,
  mediaTypes,
  onPress,
  trailing,
}: {
  title: string;
  preview: string | null;
  thumbUrl: string | null;
  mediaTypes: MediaType[];
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const terracotta = useColor("terracotta");
  const uri = mediaUrl(thumbUrl);
  const media = mediaTypes.map((t) => MEDIA_ICONS[t].label);
  return (
    <View className="mb-3 flex-row items-center gap-3.5 rounded-[14px] border border-line bg-surface p-2.5 pr-3">
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={[title, preview, media.length ? `Has ${media.join(", ")}` : null].filter(Boolean).join(". ")}
        className="flex-1 flex-row items-center gap-3.5 active:opacity-70"
      >
        <View className="h-[72px] w-[84px] items-center justify-center overflow-hidden rounded-[10px] bg-peach">
          {uri ? (
            <Image source={{ uri }} className="absolute inset-0" contentFit="cover" transition={200} />
          ) : (
            <Glyph icon="cake" size={26} color={terracotta} />
          )}
          {mediaTypes.length ? (
            <View className="absolute bottom-1.5 left-1.5 flex-row gap-1">
              {mediaTypes.map((t) => (
                <View key={t} className="h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-black/45">
                  <Ionicons name={MEDIA_ICONS[t].icon} size={11} colorClassName="accent-white" />
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <View className="flex-1">
          <Text className="font-display text-[19px] leading-[24px] text-ink" numberOfLines={1}>
            {title}
          </Text>
          <Text className="mt-0.5 font-sans text-[14px] leading-[19px] text-ink-soft" numberOfLines={1}>
            {preview ?? "Nothing saved here yet."}
          </Text>
        </View>
        {trailing ? null : <Ionicons name="chevron-forward" size={18} colorClassName="accent-ink-soft" />}
      </Pressable>
      {trailing}
    </View>
  );
}

/** The terracotta "+" panel that closes a Birthdays list. */
export function AddPanel({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="mt-5 flex-row items-center justify-center gap-3 rounded-[14px] border border-line px-4 py-3.5 active:opacity-70"
    >
      <View className="h-[36px] w-[36px] items-center justify-center rounded-full border-[1.5px] border-terracotta">
        <Ionicons name="add" size={22} colorClassName="accent-terracotta" />
      </View>
      <View className="shrink">
        <Text className="font-display text-[19px] leading-[24px] text-ink">{title}</Text>
        <Text className="font-sans text-[13.5px] leading-[18px] text-ink-soft">{subtitle}</Text>
      </View>
    </Pressable>
  );
}
