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

type PasswordResetResult =
  | "success"
  | "invalid_email"
  | "rate_limited"
  | "provider_failure"
  | "unexpected_failure";

function redirectPasswordReset(result: PasswordResetResult): never {
  redirect(`/forgot-password?result=${result}`);
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

export async function requestPasswordReset(formData: FormData) {
  const email = formValue(formData, "email");

  if (!validEmail(email)) {
    redirectPasswordReset("invalid_email");
  }

  let result: PasswordResetResult = "success";

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL + "/auth/callback?next=/reset-password",
    });

    if (error) {
      console.error("PASSWORD RESET REQUEST ERROR", {
        code: error.code,
        message: error.message,
        status: error.status,
      });

      if (
        error.code === "user_not_found" ||
        error.code === "email_not_confirmed" ||
        error.code === "user_banned" ||
        error.code === "identity_not_found"
      ) {
        result = "success";
      } else if (
        error.status === 429 ||
        error.code === "over_request_rate_limit" ||
        error.code === "over_email_send_rate_limit"
      ) {
        result = "rate_limited";
      } else if (error.code === "email_address_invalid") {
        result = "invalid_email";
      } else if (
        error.code === "email_provider_disabled" ||
        error.code === "email_address_not_authorized" ||
        /smtp|send(?:ing)? (?:the )?(?:recovery )?email|email provider/i.test(error.message)
      ) {
        result = "provider_failure";
      } else {
        result = "unexpected_failure";
      }
    }
  } catch (error) {
    console.error("PASSWORD RESET REQUEST UNEXPECTED ERROR", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    result = "unexpected_failure";
  }

  redirectPasswordReset(result);
}

export async function updatePassword(formData: FormData) {
  const password = formValue(formData, "password");
  const confirmPassword = formValue(formData, "confirmPassword");

  if (!password || !confirmPassword) {
    redirect("/reset-password?message=Password+is+required&type=error");
  }

  if (password !== confirmPassword) {
    redirect("/reset-password?message=Passwords+do+not+match&type=error");
  }

  if (password.length < 8) {
    redirect(
      "/reset-password?message=Password+must+be+at+least+8+characters&type=error",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect("/reset-password?message=Password+could+not+be+updated&type=error");
  }

  redirect("/dashboard?message=Password+updated+successfully");
}
