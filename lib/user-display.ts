type ProfileNameLike = {
  display_name?: string | null;
  email?: string | null;
  full_name?: string | null;
};

export function profileDisplayName(profile?: ProfileNameLike | null) {
  return profile?.display_name?.trim() ||
    profile?.full_name?.trim() ||
    profile?.email?.trim() ||
    "User";
}
