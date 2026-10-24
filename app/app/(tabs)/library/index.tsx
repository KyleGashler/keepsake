import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiSend, useApi, type LibraryPayload, type LibraryPillar, type PillarKey } from "../../../src/api";
import { useCanContribute } from "../../../src/auth/session-context";
import { Column, PageHeader, PhotoCard } from "../../../src/components/journey";
import { FamilyPill } from "../../../src/components/family-switcher";
import { ActionSheet, SheetError } from "../../../src/components/sheet";
import { ErrorState, Loading } from "../../../src/components/ui";
import { pickAndUploadImage } from "../../../src/pick-image";
import { friendlyError } from "../../../src/format";
import { routes } from "../../../src/routes";
import { layout } from "../../../src/theme";

/** Child Profiles has its own screens; the other two pillars list their collections. */
function open(pillar: LibraryPillar) {
  router.push(pillar.key === "CHILD_PROFILES" ? routes.children : routes.pillar(pillar.key));
}

/**
 * Library landing (design/mockups/01): the three Story Pillars as photo cards.
 * Child Profiles opens the children; the other two open their own
 * collections. The pencil on a card chooses its cover photo — or, once the
 * family has chosen one, offers to go back to the default.
 */
export default function LibraryScreen() {
  const { data, error, loading, refetch } = useApi<LibraryPayload>("/api/library");
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<PillarKey | null>(null);
  const [menuFor, setMenuFor] = useState<LibraryPillar | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const canContribute = useCanContribute();

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const pillars = data?.pillars ?? [];

  async function chooseCover(pillar: LibraryPillar) {
    setProblem(null);
    try {
      const picked = await pickAndUploadImage(() => setBusy(pillar.key));
      if (!picked) return;
      await apiSend(`/api/library/pillars/${pillar.key}/cover`, "PUT", { key: picked.media.key });
      await refetch();
    } catch (err) {
      setProblem(friendlyError(err, `The new ${pillar.name} cover didn't save. Please try again.`));
    } finally {
      setBusy(null);
    }
  }

  async function resetCover(pillar: LibraryPillar) {
    setProblem(null);
    setBusy(pillar.key);
    try {
      await apiSend(`/api/library/pillars/${pillar.key}/cover`, "DELETE");
      await refetch();
    } catch (err) {
      setProblem(friendlyError(err, "Couldn't reset the cover just now. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  // A default cover goes straight to the picker (the press is what lets a
  // browser open it); a chosen one asks first, so "back to default" is findable.
  function editCover(pillar: LibraryPillar) {
    if (pillar.customCover) setMenuFor(pillar);
    else void chooseCover(pillar);
  }

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          eyebrow="Little by little"
          accessory={<FamilyPill />}
          title="Library"
          sparkle
          subtitle="A comprehensive storykeeping archive."
          onSettings={() => router.push("/family")}
          onSearch={() => router.push("/search")}
        />
        {error && !data ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}
        {problem ? (
          <View className="mb-3">
            <SheetError message={problem} />
          </View>
        ) : null}
        {/* Cards run wider than the type above them, as in the mockup. */}
        <View className="-mx-2.5 gap-4">
          {pillars.map((pillar) => (
            <PhotoCard
              key={pillar.key}
              title={pillar.name}
              subtitle={pillar.tagline}
              imageUrl={pillar.coverUrl}
              onPress={() => open(pillar)}
              onEdit={canContribute ? () => editCover(pillar) : undefined}
              editLabel={`Change the ${pillar.name} cover`}
              busy={busy === pillar.key}
            />
          ))}
        </View>
      </Column>

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor ? `${menuFor.name} cover` : "Cover"}
        actions={
          menuFor
            ? [
                { label: "Choose a new photo", icon: "image-outline", onPress: () => void chooseCover(menuFor) },
                { label: "Reset to default", icon: "refresh-outline", onPress: () => void resetCover(menuFor) },
              ]
            : []
        }
      />
    </ScrollView>
  );
}
