import { Ionicons as BaseIonicons } from "@expo/vector-icons";
import { Image as BaseImage } from "expo-image";
import { VideoView as BaseVideoView } from "expo-video";
import { withUniwind } from "uniwind";

/*
 * Third-party components with Tailwind classes. React Native's own components
 * take `className` already; these need wrapping. A `style` prop becomes
 * `className`, and a colour prop takes an `accent-*` class:
 * `<Ionicons name="mic" size={11} colorClassName="accent-surface" />`.
 */
export const Ionicons = withUniwind(BaseIonicons);
export const Image = withUniwind(BaseImage);
export const VideoView = withUniwind(BaseVideoView);
