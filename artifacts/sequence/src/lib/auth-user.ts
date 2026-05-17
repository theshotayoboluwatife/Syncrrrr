import type { User } from "@supabase/supabase-js";

function metadataString(user: User | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = user?.user_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function getAuthDisplayName(user: User | null | undefined) {
  return (
    metadataString(user, ["user_name", "preferred_username", "full_name", "name"]) ||
    user?.email?.split("@")[0] ||
    "Your account"
  );
}

export function getAuthAvatarUrl(user: User | null | undefined) {
  return metadataString(user, ["avatar_url", "picture", "photo_url"]);
}

export function getAuthInitial(user: User | null | undefined) {
  return (getAuthDisplayName(user)[0] || "U").toUpperCase();
}
