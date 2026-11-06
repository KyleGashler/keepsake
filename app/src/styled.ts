import { Ionicons as BaseIonicons } from "@expo/vector-icons";
import { Image as BaseImage } from "expo-image";
import { VideoView as BaseVideoView } from "expo-video";
import { withUniwind } from "uniwind";

export const Ionicons = withUniwind(BaseIonicons);
// The wrapper drops `glyphMap`, so name an icon with this.
export type IoniconName = keyof typeof BaseIonicons.glyphMap;
export const Image = withUniwind(BaseImage);
export const VideoView = withUniwind(BaseVideoView);
