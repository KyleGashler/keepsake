import { ScrollView, Text, View } from "react-native";
import { Column, TabHeader, Sparkle } from "../../src/components/journey";

export default function TimelineScreen() {
  return (
    <ScrollView className="flex-1 bg-paper" showsVerticalScrollIndicator={false}>
      <Column>
        <TabHeader title="Timeline" subtitle="Every memory, in the order it happened." />
        <View className="items-center gap-2 p-6 rounded-lg bg-surface-alt">
          <Sparkle size={30} variant="filled" />
          <Text className="type-title mt-1">Coming soon</Text>
          <Text className="type-body text-center">
            We're still threading this one together. Soon every story, photo and voice in your
            archive will line up here, from the very first day to this one.
          </Text>
        </View>
      </Column>
    </ScrollView>
  );
}
