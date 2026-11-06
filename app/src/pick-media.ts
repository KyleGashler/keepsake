import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { uploadFile, type FinalizedMedia } from "./api";
import type { DraftAsset } from "./draft";

export async function pickLibraryMedia(): Promise<DraftAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    quality: 0.9,
  });
  return result.canceled ? [] : toDraftAssets(result.assets);
}

export async function takePhoto(): Promise<DraftAsset[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
  return result.canceled ? [] : toDraftAssets(result.assets);
}

/**
 * A picked video's length in whole seconds, or undefined when unknown — the
 * server then transcribes it whatever its length. expo-image-picker documents
 * `duration` in milliseconds, which is what iOS and Android report; its web
 * implementation passes the `<video>` element's `duration` through unchanged,
 * which is seconds (and Infinity for some WebM files).
 */
function pickedDurationS(asset: ImagePicker.ImagePickerAsset): number | undefined {
  if (asset.type !== "video" && !asset.mimeType?.startsWith("video/")) return undefined;
  const raw = asset.duration;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  const seconds = Platform.OS === "web" ? raw : raw / 1000;
  return Math.max(1, Math.round(seconds));
}

function toDraftAssets(assets: ImagePicker.ImagePickerAsset[]): DraftAsset[] {
  return assets.map((asset, i) => ({
    uri: asset.uri,
    name: asset.fileName ?? `capture-${Date.now()}-${i}.jpg`,
    mime: asset.mimeType ?? "image/jpeg",
    width: asset.width,
    height: asset.height,
    bytes: asset.fileSize,
    durationS: pickedDurationS(asset),
  }));
}

/**
 * Let someone choose one photo from their library and upload it — a pillar
 * cover, a child's profile photo. Resolves to the finalized upload (whose
 * `key` the cover/photo routes take) and the local `uri` to preview it by,
 * or null if they backed out.
 *
 * On the web this must run from a press handler: browsers only open a file
 * chooser in response to a user gesture. No permission is needed to open the
 * library (expo-image-picker, SDK 57).
 */
export async function pickAndUploadImage(
  onUploading?: () => void,
): Promise<{ media: FinalizedMedia; uri: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 0.9,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  onUploading?.();
  const mime = asset.mimeType ?? "image/jpeg";
  const name = asset.fileName ?? `photo-${Date.now()}.${mime.split("/")[1] ?? "jpg"}`;
  return { media: await uploadFile(asset.uri, name, mime), uri: asset.uri };
}
