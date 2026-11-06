import { useLocalSearchParams } from "expo-router";
import { ArchiveScreen, type ArchiveView } from "../../../../src/components/collection-archive";
import { ordinal } from "../../../../src/format";
import { routes } from "../../../../src/routes";

/**
 * Memories filed straight in a child's Birthdays, not in a category: those
 * nearest the birthday this was opened from ("Other moments"), or, from the
 * grid, those nearest no birthday added yet.
 */
export default function BirthdayMomentsScreen() {
  const { id, birthday, from } = useLocalSearchParams<{ id: string; birthday?: string; from?: string }>();
  const near = birthday && from ? { n: Number(birthday), from } : null;
  const view: ArchiveView = near
    ? {
        title: "Other moments",
        description: `Saved to Birthdays around the ${ordinal(near.n)} birthday, without a category.`,
        backLabel: `${ordinal(near.n)} Birthday`,
        backParent: routes.birthday(near.from),
      }
    : {
        title: "Other birthday memories",
        description: "Saved to Birthdays, but not near a birthday added here yet.",
        backLabel: "Birthdays",
        backParent: routes.birthdays(id),
      };
  return (
    <ArchiveScreen path={`/api/collections/${id}/loose`} extra={{ birthday: near ? String(near.n) : "unsorted" }} view={view} />
  );
}
