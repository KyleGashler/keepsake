import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaUrl, type MediaItem } from "../../api";
import { fonts, radius, spacing } from "../../theme";
import { VideoClip } from "../video";
import { Thumb } from "./gallery";

/**
 * Every photo and video on a memory, full screen on black: swipe (or use the
 * strip, or ← → on a keyboard) to move between them, "2 / 6" up top. Only
 * the video in view gets a player, so nothing plays off-screen.
 */
export function MediaViewer({
  items,
  index,
  onClose,
}: {
  items: MediaItem[];
  /** Which item to open on; null keeps the viewer closed. */
  index: number | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {index !== null ? <ViewerBody items={items} start={index} onClose={onClose} /> : null}
    </Modal>
  );
}

function ViewerBody({ items, start, onClose }: { items: MediaItem[]; start: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [current, setCurrent] = useState(start);

  function go(next: number, animated = true) {
    const clamped = Math.min(items.length - 1, Math.max(0, next));
    setCurrent(clamped);
    pager.current?.scrollTo({ x: clamped * width, animated });
  }

  function onSettle(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== current) setCurrent(Math.min(items.length - 1, Math.max(0, page)));
  }

  // A keyboard on the web: arrows move, Escape closes.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(current + 1);
    else if (e.key === "ArrowLeft") go(current - 1);
    else if (e.key === "Escape") onClose();
  });
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: start * width, y: 0 }}
        // Web ignores contentOffset; put the first page in place once laid out.
        onLayout={() => pager.current?.scrollTo({ x: current * width, animated: false })}
        onMomentumScrollEnd={onSettle}
        // react-native-web has no momentum events; follow the scroll itself.
        scrollEventThrottle={32}
        onScroll={Platform.OS === "web" ? onSettle : undefined}
        style={StyleSheet.absoluteFill}
      >
        {items.map((item, i) => (
          <View key={item.id} style={[styles.page, { width }]}>
            {item.type === "VIDEO" && i === current ? (
              <VideoClip uri={mediaUrl(item.url)} style={styles.media} />
            ) : null}
            {item.type === "PHOTO" ? (
              <Image
                source={{ uri: mediaUrl(item.url) }}
                style={styles.media}
                contentFit="contain"
                transition={150}
                recyclingKey={item.id}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.top, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close viewer"
          style={styles.roundButton}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        <View style={styles.counter}>
          <Text style={styles.counterText}>
            {current + 1} / {items.length}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {items.length > 1 ? (
        <View style={[styles.strip, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            onPress={() => go(current - 1)}
            disabled={current === 0}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous"
            style={[styles.stripArrow, current === 0 && { opacity: 0.3 }]}
          >
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
            {items.map((item, i) => (
              <Pressable
                key={item.id}
                onPress={() => go(i)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${i + 1} of ${items.length}`}
                accessibilityState={{ selected: i === current }}
                style={[styles.thumb, i === current && styles.thumbCurrent]}
              >
                <Thumb item={item} />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => go(current + 1)}
            disabled={current === items.length - 1}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next"
            style={[styles.stripArrow, current === items.length - 1 && { opacity: 0.3 }]}
          >
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  page: { height: "100%", justifyContent: "center" },
  media: { width: "100%", height: "72%" },
  top: {
    pointerEvents: "box-none",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  counter: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  counterText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: "#fff", letterSpacing: 1 },
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  stripArrow: { width: 32, height: 52, alignItems: "center", justifyContent: "center" },
  thumbs: { gap: spacing.sm, paddingHorizontal: 2 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    opacity: 0.6,
  },
  thumbCurrent: { borderColor: "#fff", opacity: 1 },
});
