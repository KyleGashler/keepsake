import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiSend, type DownloadFile, type DownloadsPayload, type Memory } from "../../api";
import { canSaveSeveral, saveFile } from "../../download";
import { errorMessage } from "../../format";
import { colors, fonts, radius, spacing, type } from "../../theme";
import { Thumb } from "./gallery";
import { DANGER } from "./helpers";
import { SheetHeader } from "./sheet";

/** While a video is being prepared, ask again this often. */
const POLL_MS = 10_000;
/** A URL this close to lapsing is fetched afresh before saving. */
const FRESH_FOR_MS = 60_000;

const KIND: Record<DownloadFile["type"], string> = { PHOTO: "Photo", VIDEO: "Video", AUDIO: "Recording" };

/** A URL with time left to start a download on (checked when tapped, never while rendering). */
function stillFresh(file: DownloadFile) {
  const expires = file.expiresAt ? Date.parse(file.expiresAt) : 0;
  return Boolean(file.url) && expires - Date.now() > FRESH_FOR_MS;
}

/** The person's zone, so a filename's date is the day they see on the memory. */
function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * memory ⋯ → Download: every photo, video and recording on the memory, each
 * with its own save button. Photos are the originals; a video is Mux's
 * full-quality copy, which is prepared on request — it shows "Preparing"
 * for a few minutes and this sheet keeps asking until it's ready.
 */
export function DownloadList({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  const [payload, setPayload] = useState<DownloadsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await apiSend<DownloadsPayload>(`/api/memories/${memory.id}/downloads`, "POST", {
        timeZone: timeZone(),
      });
      if (live.current) {
        setPayload(next);
        setError(null);
      }
      return next;
    } catch (err) {
      if (live.current) setError(errorMessage(err, "Couldn't get the files ready. Try again."));
      return null;
    }
  }, [memory.id]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load only sets state once its request settles
    void load();
  }, [load]);

  const preparing = payload?.files.some((f) => f.status === "preparing") ?? false;
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [preparing, load]);

  /** The file with a URL good for a while yet, asking again if it's about to lapse. */
  async function fresh(file: DownloadFile): Promise<DownloadFile | null> {
    if (stillFresh(file)) return file;
    const next = await load();
    const again = next?.files.find((f) => f.mediaId === file.mediaId);
    return again?.status === "ready" && again.url ? again : null;
  }

  async function save(file: DownloadFile) {
    setSaving(file.mediaId);
    try {
      const ready = await fresh(file);
      if (ready?.url) await saveFile(ready.url, ready.filename);
    } catch (err) {
      setError(errorMessage(err, "That didn't download. Try again."));
    } finally {
      if (live.current) setSaving(null);
    }
  }

  async function saveAll() {
    setSaving("all");
    try {
      for (const file of payload?.files ?? []) {
        if (file.status !== "ready") continue;
        const ready = await fresh(file);
        if (ready?.url) await saveFile(ready.url, ready.filename);
        // Browsers drop clicks that come too close together.
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      if (live.current) setSaving(null);
    }
  }

  const files = payload?.files ?? [];
  const readyCount = files.filter((f) => f.status === "ready").length;
  const unavailable = payload?.unavailable ?? 0;

  return (
    <>
      <SheetHeader title="Download" action={{ label: "Done", onPress: onClose }} />
      <Text style={styles.hint}>
        Save a copy of each file to this device: photos exactly as they were uploaded, videos and recordings at the best
        quality we keep.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md, marginTop: spacing.sm }}>
        {!payload && !error ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} /> : null}
        {files.map((file) => (
          <FileRow
            key={file.mediaId}
            file={file}
            item={memory.media.find((m) => m.id === file.mediaId)}
            busy={saving === file.mediaId || saving === "all"}
            disabled={saving !== null}
            onSave={() => void save(file)}
          />
        ))}
        {payload && unavailable > 0 ? (
          <Text style={styles.empty}>
            {files.length === 0
              ? "These are sample images, so there's nothing here to download."
              : `${unavailable} sample ${unavailable === 1 ? "image isn't a file" : "images aren't files"} anyone uploaded, so ${unavailable === 1 ? "it's" : "they're"} not listed.`}
          </Text>
        ) : null}
        {payload && files.length === 0 && unavailable === 0 ? (
          <Text style={styles.empty}>No photos or recordings on this memory.</Text>
        ) : null}
      </ScrollView>
      {canSaveSeveral && readyCount > 1 ? (
        <Pressable
          onPress={() => void saveAll()}
          disabled={saving !== null}
          accessibilityRole="button"
          style={({ pressed }) => [styles.allButton, (pressed || saving !== null) && { opacity: 0.75 }]}
        >
          <Ionicons name="download-outline" size={18} color={colors.onPrimary} />
          <Text style={styles.allLabel}>
            {saving === "all" ? "Downloading…" : `Download All ${readyCount}`}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function FileRow({
  file,
  item,
  busy,
  disabled,
  onSave,
}: {
  file: DownloadFile;
  item: Memory["media"][number] | undefined;
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.thumb}>
        {item && item.type !== "AUDIO" ? (
          <Thumb item={item} />
        ) : (
          <View style={styles.iconThumb}>
            <Ionicons name={file.type === "AUDIO" ? "mic-outline" : "document-outline"} size={20} color={colors.inkSoft} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
          {file.filename}
        </Text>
        <Text style={[type.caption, file.status === "failed" && { color: DANGER }]}>{statusLine(file)}</Text>
      </View>
      <Trailing file={file} busy={busy} disabled={disabled} onSave={onSave} />
    </View>
  );
}

function statusLine(file: DownloadFile) {
  if (file.status === "preparing") return "Preparing — usually a few minutes";
  if (file.status === "failed") return "Couldn't prepare this file. Try again later.";
  return KIND[file.type];
}

function Trailing({
  file,
  busy,
  disabled,
  onSave,
}: {
  file: DownloadFile;
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  if (file.status === "preparing" || busy) return <ActivityIndicator color={colors.primary} />;
  if (file.status === "failed") return <Ionicons name="alert-circle-outline" size={22} color={DANGER} />;
  return (
    <Pressable
      onPress={onSave}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Download ${file.filename}`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.saveButton, disabled && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="download-outline" size={18} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21, color: colors.inkSoft },
  error: { fontFamily: fonts.sans, fontSize: 13.5, color: DANGER, marginTop: spacing.sm },
  empty: { ...type.caption, marginTop: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  iconThumb: { flex: 1, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: fonts.sans, fontSize: 15.5, color: colors.ink },
  saveButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  allButton: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 13,
  },
  allLabel: { fontFamily: fonts.sansBold, fontSize: 15.5, color: colors.onPrimary },
});
