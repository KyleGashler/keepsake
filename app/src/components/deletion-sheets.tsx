import { useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ApiError, apiSend, useApi, type DeletionPreview } from "../api";
import { AuthError } from "../auth";
import { useSession } from "../auth/session-context";
import { friendlyError } from "../format";
import { SUPPORT_EMAIL } from "../support";
import { Ionicons, type IoniconName } from "../styled";
import { Field, Sheet, SheetButton, SheetError, SheetInput } from "./sheet";

/**
 * Deleting a family, and deleting an account (A16). Both are for good: rows
 * and files go at once, for every member, with no trash and no restore. So
 * each sheet says plainly what goes, says how to save what matters first,
 * and asks for something typed before the red button works.
 */

/** Where saving a memory lives (A17). Said the same way in both sheets. */
const SAVE_FIRST =
  "Open a memory, tap ⋯ → Download, for each one you want to keep. Let the others in the family know, so they can save theirs too.";

const NOT_AN_OWNER = `Only a family's owner can delete their account. Write to us at ${SUPPORT_EMAIL} and we'll help.`;

export function DeleteFamilySheet({
  familyName,
  stats,
  memberCount,
  onClose,
  onDeleted,
}: {
  familyName: string;
  stats: { memoryCount: number; mediaCount: number; personCount: number; collectionCount: number };
  memberCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = sameName(typed, familyName);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/family", "DELETE");
      onDeleted();
    } catch (err) {
      setError(friendlyError(err, "Couldn't delete the family just now. Nothing was deleted."));
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Delete this family?"
      subtitle={`${familyName}, for everyone in it.`}
      footer={
        <>
          <SheetButton
            label="Delete it for everyone"
            icon="trash-outline"
            variant="danger"
            disabled={!confirmed}
            busy={busy}
            onPress={() => void remove()}
          />
          <SheetButton label="Keep it" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Warning title="Everything in it is deleted for good.">
        Every memory, photo, video, recording, story, person and collection in {familyName} goes
        {memberCount > 1 ? `, for all ${memberCount} members — not just you` : ""}. There's no trash and no restore, and
        we can't get any of it back for you afterwards.
      </Warning>

      <View className="gap-2">
        <Gone text={plural(stats.memoryCount, "memory", "memories")} />
        <Gone text={plural(stats.mediaCount, "photo, video and recording", "photos, videos and recordings")} />
        <Gone text={plural(stats.personCount, "person", "people")} />
        <Gone text={plural(stats.collectionCount, "collection")} />
        <Gone text={memberCount === 1 ? "Your own access" : `Access for all ${memberCount} members`} />
      </View>

      <SaveFirst />

      <Field label={`Type “${familyName}” to confirm`}>
        <SheetInput
          value={typed}
          onChangeText={setTyped}
          placeholder={familyName}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="The family's name, to confirm"
        />
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}

export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const preview = useApi<DeletionPreview>("/api/me/deletion");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPassword = session.mode === "firebase";
  const confirmed = needsPassword ? answer.length > 0 : answer.trim() === "DELETE";

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      // Signs out when it's done; the session takes it from there.
      await session.deleteAccount(needsPassword ? answer : undefined);
    } catch (err) {
      setError(accountDeleteError(err));
      setBusy(false);
    }
  };

  const data = preview.data;
  if (!data) {
    return (
      <Sheet visible onClose={onClose} title="Delete your account">
        {preview.error ? (
          <>
            <SheetError message="Couldn't check what would be deleted. Nothing has been." />
            <SheetButton label="Try again" variant="secondary" onPress={() => void preview.refetch()} />
          </>
        ) : (
          <ActivityIndicator colorClassName="accent-ink" />
        )}
      </Sheet>
    );
  }

  if (!data.allowed) {
    return (
      <Sheet
        visible
        onClose={onClose}
        title="Delete your account"
        footer={<SheetButton label="Close" variant="secondary" onPress={onClose} />}
      >
        <Text className="type-body">{NOT_AN_OWNER}</Text>
      </Sheet>
    );
  }

  const families = data.deletes.length;
  // Someone else loses a family too.
  const shared = data.deletes.some((f) => f.members > 1);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Delete your account?"
      subtitle="This can't be undone."
      footer={
        <>
          <SheetButton
            label={families === 1 ? "Delete my account and family" : `Delete my account and ${families} families`}
            icon="trash-outline"
            variant="danger"
            disabled={!confirmed}
            busy={busy}
            onPress={() => void remove()}
          />
          <SheetButton label="Keep my account" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Warning title={families === 1 ? "The family you own is deleted with it." : "Every family you own is deleted with it."}>
        {shared ? `For everyone in ${families === 1 ? "it" : "them"}, not just you: every` : "Every"} memory, photo,
        video, recording, story, person and collection goes for good. There's no trash and no restore, and we can't get
        any of it back for you afterwards.
      </Warning>

      <Field label="Deleted for everyone">
        <View className="overflow-hidden rounded-md border border-line bg-surface">
          {data.deletes.map((f, i) => (
            <FamilyLine
              key={f.familyId}
              first={i === 0}
              icon="trash-outline"
              danger
              name={f.name}
              detail={`${plural(f.memories, "memory", "memories")} · ${plural(f.members, "member")}`}
            />
          ))}
        </View>
      </Field>

      {data.leaves.length ? (
        <Field label="You'll leave">
          <View className="overflow-hidden rounded-md border border-line bg-surface">
            {data.leaves.map((f, i) => (
              <FamilyLine
                key={f.familyId}
                first={i === 0}
                icon="exit-outline"
                name={f.name}
                detail="It stays as it is. What you added stays with the family."
              />
            ))}
          </View>
        </Field>
      ) : null}

      <SaveFirst />

      {needsPassword ? (
        <Field label="Your password" hint="To make sure it's you.">
          <SheetInput
            value={answer}
            onChangeText={setAnswer}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            accessibilityLabel="Your password"
          />
        </Field>
      ) : (
        <Field label="Type DELETE to confirm">
          <SheetInput
            value={answer}
            onChangeText={setAnswer}
            placeholder="DELETE"
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Type DELETE to confirm"
          />
        </Field>
      )}
      <SheetError message={error} />
    </Sheet>
  );
}

function accountDeleteError(err: unknown) {
  if (err instanceof AuthError) return err.message;
  if (err instanceof ApiError && err.code === "not_an_owner") return NOT_AN_OWNER;
  return friendlyError(err, "Couldn't delete your account just now. Nothing was deleted.");
}

/** Typed to confirm: the name as shown, give or take spaces and capitals. */
function sameName(typed: string, name: string) {
  return typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The bold first line and the body of the Warning and SaveFirst notes. */
const NOTE_TITLE = "font-sans-bold text-[15.5px] leading-[21px] text-ink";
const NOTE_TEXT = "font-sans text-[14.5px] leading-[21px] text-ink";

function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="flex-row items-start gap-3 rounded-md bg-danger-soft p-4" accessibilityRole="alert">
      <Ionicons name="warning-outline" size={20} colorClassName="accent-danger" />
      <View className="flex-1 gap-1">
        <Text className={NOTE_TITLE}>{title}</Text>
        <Text className={NOTE_TEXT}>{children}</Text>
      </View>
    </View>
  );
}

function SaveFirst() {
  return (
    <View className="flex-row items-start gap-3 rounded-md bg-accent-soft p-4">
      <Ionicons name="download-outline" size={20} colorClassName="accent-accent-deep" />
      <View className="flex-1 gap-1">
        <Text className={NOTE_TITLE}>Save what you want to keep first</Text>
        <Text className={NOTE_TEXT}>{SAVE_FIRST}</Text>
      </View>
    </View>
  );
}

function Gone({ text }: { text: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name="close-circle-outline" size={17} colorClassName="accent-danger" />
      <Text className="font-sans text-[15px] text-ink">{text}</Text>
    </View>
  );
}

function FamilyLine({
  name,
  detail,
  icon,
  danger = false,
  first,
}: {
  name: string;
  detail: string;
  icon: IoniconName;
  danger?: boolean;
  first: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 ${first ? "" : "border-line"}`}
      style={first ? undefined : { borderTopWidth: StyleSheet.hairlineWidth }}
    >
      <Ionicons name={icon} size={18} colorClassName={danger ? "accent-danger" : "accent-ink-soft"} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-[15.5px] leading-[21px] text-ink">{name}</Text>
        <Text className="type-caption">{detail}</Text>
      </View>
    </View>
  );
}
