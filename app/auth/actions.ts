"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";

type LoginProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  account_status: AccountStatus | null;
};

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}`);
}

export async function login(formData: FormData) {
  const email = formValue(formData, "email");
  const password = formValue(formData, "password");

  if (!email || !password) {
    redirectWithMessage("/login", "Email and password are required.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    redirectWithMessage("/login", "Invalid email or password.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("AUTH USER ERROR", userError?.message);
    redirectWithMessage("/login", "Signed in, but the session could not be verified.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,account_status")
    .eq("id", user.id)
    .single<LoginProfile>();

  if (profileError) {
    console.error("AUTH PROFILE ERROR", profileError.message);
    redirectWithMessage(
      "/login",
      "Signed in, but your profile could not be loaded. Please contact an administrator.",
    );
  }

  console.log(
    "AUTH PROFILE STATUS",
    profile?.email,
    profile?.role,
    profile?.account_status,
  );

  if (profile?.account_status === "disabled") {
    await supabase.auth.signOut();
    redirectWithMessage("/login", "Your account has been disabled.");
  }

  if (profile?.account_status === "active") {
    redirect("/dashboard");
  }

  redirect("/pending-approval");
}

export async function signup(formData: FormData) {
  const fullName = formValue(formData, "full_name");
  const email = formValue(formData, "email");
  const password = formValue(formData, "password");

  if (!fullName || !email || !password) {
    redirectWithMessage("/signup", "Full name, email, and password are required.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    redirectWithMessage("/signup", error.message);
  }

  if (data.session) {
    redirect("/pending-approval?signed_up=1");
  }

  redirectWithMessage(
    "/signup",
    "Account created. Please confirm your email, then wait for approval.",
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
