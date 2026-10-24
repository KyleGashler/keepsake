import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaStatus, mediaUrl, type MediaItem } from "../../api";
import { Image, Ionicons } from "../../styled";
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
    <View className="flex-1 bg-black">
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
        className="absolute inset-0"
      >
        {items.map((item, i) => (
          <View key={item.id} className="h-full justify-center" style={{ width }}>
            {item.type === "VIDEO" && i === current ? <ViewerVideo item={item} /> : null}
            {item.type === "PHOTO" ? (
              <Image
                source={{ uri: mediaUrl(item.url) }}
                className="h-[72%] w-full"
                contentFit="contain"
                transition={150}
                recyclingKey={item.id}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View
        className="absolute top-0 right-0 left-0 flex-row items-center justify-between px-4"
        style={{ pointerEvents: "box-none", paddingTop: insets.top + 12 }}
      >
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close viewer"
          className="h-10 w-10 items-center justify-center rounded-full bg-white/14"
        >
          <Ionicons name="close" size={22} colorClassName="accent-white" />
        </Pressable>
        <View className="rounded-full bg-white/14 px-3 py-[5px]">
          <Text className="font-sans-semibold text-[14px] tracking-[1px] text-white">
            {current + 1} / {items.length}
          </Text>
        </View>
        <View className="w-10" />
      </View>

      {items.length > 1 ? (
        <View
          className="absolute right-0 bottom-0 left-0 flex-row items-center gap-2 bg-black/55 px-3 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <Pressable
            onPress={() => go(current - 1)}
            disabled={current === 0}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous"
            className={`h-[52px] w-8 items-center justify-center ${current === 0 ? "opacity-30" : ""}`}
          >
            <Ionicons name="chevron-back" size={20} colorClassName="accent-white" />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-0.5">
            {items.map((item, i) => (
              <Pressable
                key={item.id}
                onPress={() => go(i)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${i + 1} of ${items.length}`}
                accessibilityState={{ selected: i === current }}
                className={`h-[52px] w-[52px] overflow-hidden rounded-[6px] border-2 ${
                  i === current ? "border-white opacity-100" : "border-transparent opacity-60"
                }`}
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
            className={`h-[52px] w-8 items-center justify-center ${current === items.length - 1 ? "opacity-30" : ""}`}
          >
            <Ionicons name="chevron-forward" size={20} colorClassName="accent-white" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The video in view: playing once Mux has it ready, a word about it until then. */
function ViewerVideo({ item }: { item: MediaItem }) {
  const status = mediaStatus(item);
  const [failed, setFailed] = useState(false);
  if (status === "READY" && item.url && !failed) {
    return (
      <VideoClip
        uri={mediaUrl(item.url)}
        posterUrl={item.posterUrl}
        onError={() => setFailed(true)}
        // VideoClip takes a style, not a className.
        style={{ width: "100%", height: "72%" }}
      />
    );
  }
  return (
    <View className="h-[72%] w-full items-center justify-center gap-3">
      {status === "PROCESSING" ? (
        <ActivityIndicator colorClassName="accent-white/80" />
      ) : (
        <Ionicons name="videocam-off-outline" size={28} colorClassName="accent-white/70" />
      )}
      <Text className="font-sans-semibold text-[15px] text-white/80">
        {status === "PROCESSING" ? "Preparing video…" : "This video can't play right now."}
      </Text>
    </View>
  );
}
