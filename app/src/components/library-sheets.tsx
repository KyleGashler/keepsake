import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { apiSend, type ChildSummary, type Collection, type Person, type PersonPatch } from "../api";
import { birthdayInput, birthdayLabel, childAge, friendlyError, parseBirthday } from "../format";
import { DISC_COLORS, glyphColorFor, ICON_KEYS, type IconKey } from "../icons";
import { pickAndUploadImage } from "../pick-image";
import { brand, colors, fonts, spacing } from "../theme";
import { ChildPortrait } from "./child-header";
import { Glyph, IconDisc } from "./journey";
import { Field, Sheet, SheetButton, SheetError, SheetInput } from "./sheet";

/**
 * The Library journey's sheets: add a child, edit a child, create a
 * collection. Each is mounted by its screen only while open, so every opening
 * starts from a clean form.
 */

const BIRTHDAY_HINT = "Year-month-day, like 2020-05-14.";

function birthdayError(input: string) {
  return parseBirthday(input) === undefined ? "That doesn't look like a date — try 2020-05-14." : null;
}

/** How a typed birthday reads back: "May 14, 2020 · Age 6". */
function birthdayEcho(input: string) {
  const iso = parseBirthday(input);
  if (!iso) return BIRTHDAY_HINT;
  return [birthdayLabel(iso), childAge(iso)].filter(Boolean).join("  ·  ");
}

// ---------------------------------------------------------------------------
// Add a child
// ---------------------------------------------------------------------------

/** Name and birthday; the server creates the child's default collections. */
export function AddChildSheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (child: ChildSummary) => void;
}) {
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateError = touched ? birthdayError(birthday) : null;

  async function save() {
    setTouched(true);
    const birthDate = parseBirthday(birthday);
    if (!name.trim()) return setError("What's their name?");
    if (birthDate === undefined) return setError(null);
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ person: Person; child: ChildSummary | null }>("/api/people", "POST", {
        name: name.trim(),
        role: "CHILD",
        ...(birthDate ? { birthDate } : {}),
      });
      if (res.child) onAdded(res.child);
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
      title="Add a child"
      subtitle="Their collections are made for them, ready to fill."
      footer={<SheetButton label="Add to the family" onPress={save} busy={saving} disabled={!name.trim()} />}
    >
      <Field label="Name">
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder="Their name"
          autoFocus
          autoCapitalize="words"
          returnKeyType="next"
          maxLength={80}
          accessibilityLabel="Name"
        />
      </Field>
      <Field label="Birthday" hint={birthdayEcho(birthday)} error={dateError}>
        <SheetInput
          value={birthday}
          onChangeText={setBirthday}
          onBlur={() => setTouched(true)}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={10}
          onSubmitEditing={save}
          accessibilityLabel="Birthday"
        />
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Edit a child
// ---------------------------------------------------------------------------

/**
 * The gear on a child's Collections: their photo, name and birthday. Nothing
 * is saved until Save — a chosen photo is uploaded straight away (so Save is
 * quick) but only becomes theirs with the rest. Removing a photo only drops
 * the pointer; the uploaded original is kept.
 */
export function EditChildSheet({
  child,
  onClose,
  onSaved,
}: {
  child: ChildSummary;
  onClose: () => void;
  onSaved: (child: ChildSummary) => void;
}) {
  const [name, setName] = useState(child.name);
  const [birthday, setBirthday] = useState(birthdayInput(child.birthDate));
  /** undefined: unchanged; null: remove; a key: the new photo. */
  const [photoKey, setPhotoKey] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(child.photoUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateError = birthdayError(birthday);
  const birthDate = parseBirthday(birthday);
  const original = birthdayInput(child.birthDate);

  async function choosePhoto() {
    setError(null);
    try {
      const picked = await pickAndUploadImage(() => setUploading(true));
      if (picked) {
        setPhotoKey(picked.media.key);
        setPreview(picked.uri);
      }
    } catch (err) {
      setError(friendlyError(err, "That photo didn't upload. Please try another."));
    } finally {
      setUploading(false);
    }
  }

  function removePhoto() {
    setPhotoKey(null);
    setPreview(null);
  }

  async function save() {
    if (!name.trim()) return setError("Every child needs a name.");
    if (birthDate === undefined) return;
    const patch: PersonPatch = {};
    if (name.trim() !== child.name) patch.name = name.trim();
    if (birthday.trim() !== original) patch.birthDate = birthDate;
    if (photoKey !== undefined) patch.photoKey = photoKey;
    if (Object.keys(patch).length === 0) return onClose();

    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ child: ChildSummary | null }>(`/api/people/${child.id}`, "PATCH", patch);
      if (res.child) onSaved(res.child);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Couldn't save just now. Please try again."));
      setSaving(false);
    }
  }

  const portraitChild = { ...child, name: name.trim() || child.name };
  let photoButtonLabel = preview ? "Change photo" : "Choose a photo";
  if (uploading) photoButtonLabel = "Uploading…";

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Edit ${child.name}`}
      footer={
        <SheetButton
          label="Save"
          onPress={save}
          busy={saving}
          disabled={uploading || !name.trim() || !!dateError}
        />
      }
    >
      <View style={styles.photoRow}>
        <ChildPortrait child={portraitChild} size={96} uri={preview} />
        <View style={styles.photoButtons}>
          <SheetButton
            label={photoButtonLabel}
            icon="image-outline"
            variant="secondary"
            onPress={choosePhoto}
            busy={uploading}
          />
          {preview && !uploading ? (
            <Pressable
              onPress={removePhoto}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => [styles.removePhoto, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.terracotta} />
              <Text style={styles.removePhotoLabel}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Field label="Name">
        <SheetInput
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={80}
          accessibilityLabel="Name"
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

// ---------------------------------------------------------------------------
// Create a collection
// ---------------------------------------------------------------------------

/** The seven default discs' colours, then the rest of the brand palette. */
const COLLECTION_SWATCHES = [...DISC_COLORS, brand.tealGrey] as const;

/** A child's own collection: a name, a line about it, and a disc to know it by. */
export function CreateCollectionSheet({
  child,
  onClose,
  onCreated,
}: {
  child: Pick<ChildSummary, "id" | "name">;
  onClose: () => void;
  onCreated: (collection: Collection) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<IconKey>("star");
  const [color, setColor] = useState<string>(COLLECTION_SWATCHES[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError("Give the collection a name.");
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ collection: Collection }>("/api/collections", "POST", {
        pillar: "CHILD_PROFILES",
        personId: child.id,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        icon,
        color,
      });
      onCreated(res.collection);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Couldn't create it just now. Please try again."));
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Create a Collection"
      subtitle={`A new place for part of ${child.name}'s story.`}
      footer={<SheetButton label="Create collection" onPress={save} busy={saving} disabled={!name.trim()} />}
    >
      <View style={styles.preview}>
        <IconDisc icon={icon} color={color} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={styles.previewName} numberOfLines={1}>
            {name.trim() || "New collection"}
          </Text>
          {description.trim() ? (
            <Text style={styles.previewDescription} numberOfLines={2}>
              {description.trim()}
            </Text>
          ) : null}
        </View>
      </View>

      <Field label="Name">
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Adventures with Grandpa"
          autoFocus
          autoCapitalize="words"
          maxLength={80}
          accessibilityLabel="Collection name"
        />
      </Field>
      <Field label="Description (optional)">
        <SheetInput
          value={description}
          onChangeText={setDescription}
          placeholder="What belongs here?"
          multiline
          maxLength={400}
          accessibilityLabel="Description"
        />
      </Field>

      <Field label="Icon">
        <View style={styles.grid} accessibilityRole="radiogroup">
          {ICON_KEYS.map((key) => {
            const selected = key === icon;
            return (
              <Pressable
                key={key}
                onPress={() => setIcon(key)}
                accessibilityRole="radio"
                accessibilityLabel={key}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.iconChoice,
                  selected && { backgroundColor: color, borderColor: color },
                  pressed && styles.pressed,
                ]}
              >
                <Glyph icon={key} size={22} color={selected ? glyphColorFor(color) : colors.ink} />
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Colour">
        <View style={styles.grid} accessibilityRole="radiogroup">
          {COLLECTION_SWATCHES.map((swatch) => {
            const selected = swatch === color;
            return (
              <Pressable
                key={swatch}
                onPress={() => setColor(swatch)}
                accessibilityRole="radio"
                accessibilityLabel={`Colour ${swatch}`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.swatchRing, selected && styles.swatchRingSelected, pressed && styles.pressed]}
              >
                <View style={[styles.swatch, { backgroundColor: swatch }]}>
                  {selected ? <Ionicons name="checkmark" size={18} color={glyphColorFor(swatch)} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  photoButtons: { flex: 1, gap: spacing.sm, alignItems: "flex-start" },
  removePhoto: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 4 },
  removePhotoLabel: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.terracotta },

  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  previewName: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, color: colors.ink },
  previewDescription: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 19, color: colors.inkSoft },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  iconChoice: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  swatchRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 4,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchRingSelected: { borderColor: colors.ink },
  swatch: { flex: 1, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
