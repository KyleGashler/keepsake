import type { MembershipRole } from "./api";

/** A role in a few words — the same words the API's `permission` field uses. */
export const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "Owner",
  CONTRIBUTOR: "Can add memories",
  VIEWER: "Can view",
};

/** What a role lets someone do, for the invite form and the join screen. */
export const ROLE_DESCRIPTION: Record<MembershipRole, string> = {
  OWNER: "Can add and edit memories, invite people and manage who's in the family.",
  CONTRIBUTOR: "Can look through everything, and add and edit memories.",
  VIEWER: "Can look through everything, but not add or change anything.",
};

/** In the order the invite form offers them: the usual choice first. */
export const INVITE_ROLES: MembershipRole[] = ["CONTRIBUTOR", "VIEWER", "OWNER"];

/** Where an invite link opens: `/join/<token>` (app/join/[token].tsx, drawn by the root layout). */
export const JOIN_PATH_PREFIX = "/join/";
