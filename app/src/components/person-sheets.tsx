import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { apiSend, type Person, type PersonCreate, type PersonPatch } from "../api";
import { birthdayInput, birthdayLabel, childAge, friendlyError, parseBirthday } from "../format";
import { colors, fonts, radius, spacing } from "../theme";
import { Field, Sheet, SheetButton, SheetError, SheetInput } from "./sheet";

/**
 * Adding and editing people in the archive — adults as well as children (a
 * child's photo is edited on their Collections screen). Each sheet is
 * mounted by its screen only while open. Deleting someone: src/people.ts.
 */

const BIRTHDAY_HINT = "Optional. Year-month-day, like 1958-03-02.";

function birthdayEcho(input: string) {
  const iso = parseBirthday(input);
  if (!iso) return BIRTHDAY_HINT;
  return [birthdayLabel(iso), childAge(iso)].filter(Boolean).join("  ·  ");
}

/** The roles an adult can be added with. Children are added from the Library. */
const ADULT_ROLES: { role: Person["role"]; label: string }[] = [
  { role: "PARENT", label: "Parent" },
  { role: "GRANDPARENT", label: "Grandparent" },
  { role: "RELATIVE", label: "Relative" },
  { role: "COLLABORATOR", label: "Friend or helper" },
];

/**
 * Someone who belongs in the family's story but doesn't need an account (yet):
 * a great-grandparent, an aunt abroad. Inviting them later links this person.
 */
export function AddPersonSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (person: Person) => void }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [role, setRole] = useState<Person["role"]>("RELATIVE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError("What's their name?");
    setSaving(true);
    setError(null);
    const body: PersonCreate = { name: name.trim(), role };
    if (relation.trim()) body.relation = relation.trim();
    try {
      const res = await apiSend<{ person: Person }>("/api/people", "POST", body);
      onAdded(res.person);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Couldn't add them just now. Please try again."));
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Add someone"
      subtitle="Someone in the family's story. They don't need an account."
      footer={<SheetButton label="Add to the archive" onPress={save} busy={saving} disabled={!name.trim()} />}
    >
      <Field label="Name">
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder="Their name"
          autoFocus
          autoCapitalize="words"
          maxLength={80}
          accessibilityLabel="Name"
        />
      </Field>
      <Field label="What the family calls them (optional)">
        <SheetInput
          value={relation}
          onChangeText={setRelation}
          placeholder="Grandma, Uncle Joe…"
          autoCapitalize="words"
          maxLength={40}
          accessibilityLabel="What the family calls them"
        />
      </Field>
      <Field label="Who are they?">
        <View style={styles.chips} accessibilityRole="radiogroup">
          {ADULT_ROLES.map((r) => (
            <Pressable
              key={r.role}
              onPress={() => setRole(r.role)}
              accessibilityRole="radio"
              accessibilityState={{ selected: role === r.role }}
              style={[styles.chip, role === r.role && styles.chipSelected]}
            >
              <Text style={[styles.chipLabel, role === r.role && { color: colors.onPrimary }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}

/** Name, what the family calls them, and birthday. */
export function EditPersonSheet({
  person,
  onClose,
  onSaved,
}: {
  person: Person;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [relation, setRelation] = useState(person.relation ?? "");
  const [birthday, setBirthday] = useState(birthdayInput(person.birthDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const birthDate = parseBirthday(birthday);
  const dateError = birthDate === undefined ? "That doesn't look like a date — try 1958-03-02." : null;

  async function save() {
    if (!name.trim()) return setError("Everyone needs a name.");
    if (birthDate === undefined) return;
    const patch: PersonPatch = {};
    if (name.trim() !== person.name) patch.name = name.trim();
    if (relation.trim() !== (person.relation ?? "")) patch.relation = relation.trim() || null;
    if (birthday.trim() !== birthdayInput(person.birthDate)) patch.birthDate = birthDate;
    if (Object.keys(patch).length === 0) return onClose();
    setSaving(true);
    setError(null);
    try {
      await apiSend(`/api/people/${person.id}`, "PATCH", patch);
      onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Couldn't save just now. Please try again."));
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Edit ${person.name}`}
      footer={<SheetButton label="Save" onPress={save} busy={saving} disabled={!name.trim() || !!dateError} />}
    >
      <Field label="Name">
        <SheetInput value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} accessibilityLabel="Name" />
      </Field>
      <Field label="What the family calls them">
        <SheetInput
          value={relation}
          onChangeText={setRelation}
          placeholder="Grandma, Uncle Joe…"
          autoCapitalize="words"
          maxLength={40}
          accessibilityLabel="What the family calls them"
        />
      </Field>
      <Field label="Birthday" hint={birthdayEcho(birthday)} error={dateError}>
        <SheetInput
          value={birthday}
          onChangeText={setBirthday}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={10}
          accessibilityLabel="Birthday"
        />
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.ink },
});
