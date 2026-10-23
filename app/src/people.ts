import { Platform } from "react-native";
import { apiSend, type Person } from "./api";
import type { SheetAction } from "./components/sheet";
import { count, refusalMessage } from "./format";

/**
 * Deleting someone from the archive, as every screen that offers it asks:
 * the same words and the same request. The sheets that add and edit people
 * are in components/person-sheets.tsx.
 */

/**
 * What deleting someone takes with them, for the confirmation's subtitle.
 * Mirrors `DELETE /api/people/:id`: their collections go (the memories filed
 * there stay), and so does their place in "who was there"; memories they
 * added stay, without an author. Without a count, a child's are named.
 */
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

/** The one destructive choice in a delete confirmation's ActionSheet. */
export function deletePersonAction(
  person: Pick<Person, "id" | "name">,
  onDeleted: () => void,
  onError: (message: string) => void,
): SheetAction {
  return {
    label: `Delete ${person.name}`,
    icon: "trash-outline",
    destructive: true,
    onPress: () => void deletePerson(person.id, onDeleted, onError),
  };
}

async function deletePerson(id: string, onDeleted: () => void, onError: (message: string) => void) {
  try {
    await apiSend(`/api/people/${id}`, "DELETE");
  } catch (err) {
    onError(refusalMessage(err, "Couldn't delete them just now. Please try again."));
    return;
  }
  onDeleted();
}

/**
 * Open a sheet after another one closes. A browser can swap them at once;
 * iOS won't present a modal over one that is still dismissing.
 */
export function afterSheetCloses(open: () => void) {
  if (Platform.OS === "web") open();
  else setTimeout(open, 350);
}
