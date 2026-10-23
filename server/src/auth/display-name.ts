/**
 * "ali.reyes@example.com" → "Ali Reyes" — a name to show until the person
 * chooses one. Used when the provider has no display name of its own.
 */
export function displayNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? email;
  const words = localPart
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1));
  return words.length ? words.join(" ") : localPart;
}
