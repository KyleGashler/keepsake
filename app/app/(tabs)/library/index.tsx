import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiSend, type LibraryPayload, type LibraryPillar, type PillarKey } from "../../../src/api";
import { useCanContribute } from "../../../src/auth/session-context";
import { Column, TabHeader, PhotoCard } from "../../../src/components/journey";
import { ActionSheet, SheetError } from "../../../src/components/sheet";
import { Button, EmptyState, ErrorState, Loading } from "../../../src/components/ui";
import { pickAndUploadImage } from "../../../src/pick-media";
import { count, friendlyError } from "../../../src/format";
import { invalidate, useApiQuery, useRefreshOnFocus } from "../../../src/query";
import { routes } from "../../../src/routes";
import { layout } from "../../../src/theme";

function open(pillar: LibraryPillar) {
  router.push(pillar.key === "CHILD_PROFILES" ? routes.children : routes.pillar(pillar.key));
}

export default function LibraryScreen() {
  const library = useApiQuery<LibraryPayload>("/api/library");
  const { data, error } = library;
  useRefreshOnFocus(library);
  const cover = useMutation({
    mutationFn: ({ pillar, key }: { pillar: PillarKey; key: string | null }) =>
      key
        ? apiSend(`/api/library/pillars/${pillar}/cover`, "PUT", { key })
        : apiSend(`/api/library/pillars/${pillar}/cover`, "DELETE"),
    onSuccess: () => invalidate(["library"]),
  });
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<PillarKey | null>(null);
  const [menuFor, setMenuFor] = useState<LibraryPillar | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const canContribute = useCanContribute();

  const pillars = data?.pillars ?? [];

  async function chooseCover(pillar: LibraryPillar) {
    setProblem(null);
    try {
      const picked = await pickAndUploadImage(() => setBusy(pillar.key));
      if (!picked) return;
      await cover.mutateAsync({ pillar: pillar.key, key: picked.media.key });
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
      await cover.mutateAsync({ pillar: pillar.key, key: null });
    } catch (err) {
      setProblem(friendlyError(err, "Couldn't reset the cover just now. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  // A default cover goes straight to the picker: browsers only open it from the press itself.
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
        <TabHeader title="Library" subtitle="A comprehensive storykeeping archive." />
        {error && !data ? (
          <ErrorState error={error} onRetry={() => void library.refetch()} retrying={library.isFetching} />
        ) : null}
        {library.isPending && !error ? <Loading /> : null}
        {data && pillars.length === 0 ? (
          <EmptyState
            icon="library-outline"
            title="Nothing on the shelves yet"
            body="The Library's pillars didn't come through. They're usually here — try again in a moment."
            action={<Button label="Try again" icon="refresh" variant="secondary" onPress={() => void library.refetch()} />}
          />
        ) : null}
        {problem ? (
          <View className="mb-3">
            <SheetError message={problem} />
          </View>
        ) : null}
        <View className="gap-4">
          {pillars.map((pillar) => (
            <PhotoCard
              key={pillar.key}
              title={pillar.name}
              subtitle={pillar.tagline}
              eyebrow={pillar.memoryCount ? count(pillar.memoryCount, "memory", "memories") : null}
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
