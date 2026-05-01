import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  account_status: AccountStatus | null;
  created_at?: string;
  updated_at?: string;
};

export type AuthenticatedUser = {
  user: User;
  profile: UserProfile | null;
  displayName: string;
};

export async function getProfileForUser(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,account_status")
    .eq("id", userId)
    .single<UserProfile>();

  if (error) {
    console.error("AUTH PROFILE ERROR", error.message);
  }

  return data;
}

export async function requireActiveUser(): Promise<AuthenticatedUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,account_status")
    .eq("id", user.id)
    .single<UserProfile>();

  if (profileError) {
    console.error("AUTH PROFILE ERROR", profileError.message);
  }

  if (profile?.account_status === "disabled") {
    await supabase.auth.signOut();
    redirect("/login?message=Your%20account%20has%20been%20disabled.");
  }

  if (profile?.account_status !== "active") {
    redirect("/pending-approval");
  }

  return {
    user,
    profile,
    displayName:
      profile.full_name ?? user.user_metadata.full_name ?? user.email ?? "User",
  };
}

export async function requireSystemOwner(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();

  if (authenticatedUser.profile?.role !== "system_owner") {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireSettingsManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (role !== "system_owner" && role !== "admin_manager") {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireRecordsManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (
    role !== "system_owner" &&
    role !== "admin_manager" &&
    role !== "sales_designer"
  ) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}
