import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, type ChildrenPayload } from "../../../../src/api";
import { useCanContribute } from "../../../../src/auth/session-context";
import { ChildCardBackdrop } from "../../../../src/components/child-header";
import { Column, PageHeader, PhotoCard, Sparkle } from "../../../../src/components/journey";
import { AddChildSheet } from "../../../../src/components/library-sheets";
import { ErrorState, Loading } from "../../../../src/components/ui";
import { childAge } from "../../../../src/format";
import { routes } from "../../../../src/routes";
import { Ionicons } from "../../../../src/styled";
import { layout } from "../../../../src/theme";

/**
 * Child Profiles (design/mockups/02): one photo card per child, oldest first,
 * then a way to add another. A child without a photo shows their monogram in
 * their own colour. With no children yet, the page is an invitation.
 */
export default function ChildProfilesScreen() {
  const { data, error, loading, refetch } = useApi<ChildrenPayload>("/api/children");
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
  const canContribute = useCanContribute();

  // Fresh photos and names after an edit deeper in the stack.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const children = data?.children ?? [];

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          backLabel="Library"
          title="Child Profiles"
          sparkle
          sparkleAtEnd
          subtitle="Every child's story, captured little by little."
        />
        {error && !data ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}

        {data && children.length === 0 ? (
          <View className="items-center gap-3 rounded-lg bg-surface-alt px-4 py-9">
            <Sparkle size={34} variant="filled" />
            <Text className="text-center font-display text-[26px] leading-[32px] text-ink">Every story starts with a name</Text>
            <Text className="max-w-[340px] text-center font-sans text-[15.5px] leading-[22px] text-ink-soft">
              Add a child and their collections are made for them — milestones, everyday moments, the things
              they say — ready for the first memory.
            </Text>
            {canContribute ? (
              <Pressable
                onPress={() => setAdding(true)}
                accessibilityRole="button"
                className="mt-2 h-[50px] flex-row items-center gap-2 rounded-full bg-primary px-6 active:opacity-70"
              >
                <Ionicons name="add" size={20} colorClassName="accent-on-primary" />
                <Text className="font-sans-bold text-[16px] text-on-primary">Add a child</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {children.length > 0 ? (
          // Cards run wider than the type above them, as in the mockup.
          <View className="-mx-2.5 gap-4">
            {children.map((child) => (
              <PhotoCard
                key={child.id}
                title={child.name}
                subtitle={childAge(child.birthDate)}
                imageUrl={child.photoUrl}
                backdrop={<ChildCardBackdrop child={child} />}
                onPress={() => router.push(routes.child(child.id))}
              />
            ))}
            {canContribute ? (
              <Pressable
                onPress={() => setAdding(true)}
                accessibilityRole="button"
                className="flex-row items-center gap-4 rounded-[14px] border border-line px-4 py-3 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-ink">
                  <Ionicons name="add" size={24} colorClassName="accent-ink" />
                </View>
                <View className="flex-1">
                  <Text className="font-display text-[20px] leading-[25px] text-ink">Add a child</Text>
                  <Text className="font-sans text-[14px] leading-[19px] text-ink-soft">Start another story, little by little.</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Column>

      {adding ? <AddChildSheet onClose={() => setAdding(false)} onAdded={() => void refetch()} /> : null}
    </ScrollView>
  );
}
