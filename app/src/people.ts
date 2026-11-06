import { useMutation } from "@tanstack/react-query";
import { Platform } from "react-native";
import { apiSend, type Person } from "./api";
import type { SheetAction } from "./components/sheet";
import { count, refusalMessage } from "./format";
import { gone, invalidate } from "./query";

export function deletePersonMessage(person: Pick<Person, "role">, collectionCount?: number) {
  let collections = "";
  if (collectionCount === undefined && person.role === "CHILD") {
    collections =
      "Their Child Profiles and Arrival Stories collections go with them; the memories filed there stay in the archive. ";
  } else if (collectionCount) {
    const verb = collectionCount === 1 ? "goes" : "go";
    collections = `Their ${count(collectionCount, "collection")} ${verb} with them; the memories filed there stay in the archive. `;
  }
  return `${collections}They're taken off every memory they appear in, and memories they added stay without an author. This can't be undone.`;
}

export function useDeletePersonAction() {
  const { mutate } = useMutation({
    mutationFn: (id: string) => apiSend(`/api/people/${id}`, "DELETE"),
    onSuccess: (_, id) => invalidate("everything", [gone(`/api/people/${id}`), gone(`/api/children/${id}`)]),
  });
  return (
    person: Pick<Person, "id" | "name">,
    onDeleted: () => void,
    onError: (message: string) => void,
  ): SheetAction => ({
    label: `Delete ${person.name}`,
    icon: "trash-outline",
    destructive: true,
    onPress: () =>
      mutate(person.id, {
        onSuccess: onDeleted,
        onError: (err) => onError(refusalMessage(err, "Couldn't delete them just now. Please try again.")),
      }),
  });
}

// iOS won't present a modal over one that's still dismissing; a browser can swap them at once.
export function afterSheetCloses(open: () => void) {
  if (Platform.OS === "web") open();
  else setTimeout(open, 350);
}
