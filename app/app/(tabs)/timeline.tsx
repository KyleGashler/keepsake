import { router } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { Column, PageHeader, Sparkle } from "../../src/components/journey";
import { FamilyPill } from "../../src/components/family-switcher";

/** A placeholder until the Timeline has its own milestone. */
export default function TimelineScreen() {
  return (
    <ScrollView className="flex-1 bg-paper" showsVerticalScrollIndicator={false}>
      <Column>
        <PageHeader
          eyebrow="Little by little"
          accessory={<FamilyPill />}
          title="Timeline"
          sparkle
          subtitle="Every memory, in the order it happened."
          onSettings={() => router.push("/family")}
          onSearch={() => router.push("/search")}
        />
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
