import type { MembershipRole } from "./api";

// The same words the API's `permission` field uses.
export const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "Owner",
  CONTRIBUTOR: "Can add memories",
  VIEWER: "Can view",
};

export const ROLE_DESCRIPTION: Record<MembershipRole, string> = {
  OWNER: "Can add and edit memories, invite people and manage who's in the family.",
  CONTRIBUTOR: "Can look through everything, and add and edit memories.",
  VIEWER: "Can look through everything, but not add or change anything.",
};

export const INVITE_ROLES: MembershipRole[] = ["CONTRIBUTOR", "VIEWER", "OWNER"];

export const JOIN_PATH_PREFIX = "/join/";
