import * as ImagePicker from "expo-image-picker";
import { uploadFile, type FinalizedMedia } from "./api";

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
