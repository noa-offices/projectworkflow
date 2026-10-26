"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Bell } from "lucide-react";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { ReadCacheSignOut } from "@/components/local-read-cache/sign-out";
import { changeInventoryPassword, updateInventoryProfile } from "@/lib/inventory/profile-actions";
import { INVENTORY_NOTIFICATIONS_PATH, MIN_PASSWORD_LENGTH, validatePasswordChange, validateProfileInput, type PasswordFieldErrors, type ProfileFieldErrors } from "@/lib/inventory/profile";
import { Banner, buttonClass, cardClass, fieldClass, PageHeader } from "./inventory-ui";

type Status = { tone: "success" | "error"; text: string } | null;
type ProfileViewProps = { userId: string; displayName: string; email: string; roleLabel: string; fullName: string; phone: string; avatarUrl: string | null; showFullProfileLink: boolean };

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="block min-w-0"><span className="text-sm font-semibold text-zinc-800">{label}</span>{children}{error ? <span role="alert" className="mt-1 block text-sm text-red-700 [overflow-wrap:anywhere]">{error}</span> : null}</label>;
}
function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-sm font-semibold text-zinc-800">{label}</p><p data-readonly className="mt-1 min-h-11 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2.5 text-base text-zinc-700 [overflow-wrap:anywhere]">{value}</p></div>;
}

export function ProfileView({ userId, displayName, email, roleLabel, fullName, phone, avatarUrl, showFullProfileLink }: ProfileViewProps) {
  const [name, setName] = useState(fullName), [tel, setTel] = useState(phone);
  const [profileErrors, setProfileErrors] = useState<ProfileFieldErrors>({}), [profileStatus, setProfileStatus] = useState<Status>(null);
  const [profilePending, startProfile] = useTransition();
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<PasswordFieldErrors>({}), [passwordStatus, setPasswordStatus] = useState<Status>(null);
  const [passwordPending, startPassword] = useTransition();

  function saveProfile(event: FormEvent) {
    event.preventDefault(); setProfileStatus(null);
    const checked = validateProfileInput({ fullName: name, phone: tel });
    if (!checked.ok) { setProfileErrors(checked.errors); return; }
    setProfileErrors({});
    startProfile(async () => {
      try {
        const result = await updateInventoryProfile({ fullName: name, phone: tel });
        if (result.ok) setProfileStatus({ tone: "success", text: "Your details are saved." });
        else { setProfileErrors(result.fields ?? {}); setProfileStatus({ tone: "error", text: result.error }); }
      } catch { setProfileStatus({ tone: "error", text: "Your details could not be saved. Check your internet and try again." }); }
    });
  }
  function savePassword(event: FormEvent) {
    event.preventDefault(); setPasswordStatus(null);
    const checked = validatePasswordChange({ password, confirmPassword: confirm });
    if (!checked.ok) { setPasswordErrors(checked.errors); return; }
    setPasswordErrors({});
    startPassword(async () => {
      try {
        const result = await changeInventoryPassword({ password, confirmPassword: confirm });
        if (result.ok) { setPassword(""); setConfirm(""); setPasswordStatus({ tone: "success", text: "Your password is changed." }); }
        else { setPasswordErrors(result.fields ?? {}); setPasswordStatus({ tone: "error", text: result.error }); }
      } catch { setPasswordStatus({ tone: "error", text: "Your password could not be changed. Check your internet and try again." }); }
    });
  }

  return <div className="grid min-w-0 gap-4">
    <PageHeader title="My profile" text={`Signed in as ${displayName}.`} />
    <section className={cardClass} aria-labelledby="profile-photo"><h2 id="profile-photo" className="mb-3 text-lg font-semibold text-zinc-950">Photo</h2><AvatarUpload inventory currentAvatarUrl={avatarUrl} userId={userId} displayName={displayName} /></section>
    <form onSubmit={saveProfile} noValidate className={`${cardClass} grid gap-4`} aria-labelledby="profile-details">
      <h2 id="profile-details" className="text-lg font-semibold text-zinc-950">Your details</h2>
      <Field label="Full name" error={profileErrors.fullName}><input name="full_name" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={100} aria-invalid={Boolean(profileErrors.fullName)} className={fieldClass} /></Field>
      <Field label="Phone number" error={profileErrors.phone}><input name="phone" type="tel" inputMode="tel" value={tel} onChange={event => setTel(event.target.value)} autoComplete="tel" placeholder="+971 ..." maxLength={30} aria-invalid={Boolean(profileErrors.phone)} className={fieldClass} /></Field>
      <ReadOnly label="Email" value={email || "Not available"} />
      <ReadOnly label="Role" value={roleLabel} />
      <p className="text-sm text-zinc-600">Your email and role can only be changed by an administrator.</p>
      {profileStatus ? <Banner tone={profileStatus.tone}>{profileStatus.text}</Banner> : null}
      <button type="submit" disabled={profilePending} className={`${buttonClass.primary} w-full sm:w-auto`}>{profilePending ? "Saving…" : "Save details"}</button>
    </form>
    <form onSubmit={savePassword} noValidate className={`${cardClass} grid gap-4`} aria-labelledby="profile-password">
      <h2 id="profile-password" className="text-lg font-semibold text-zinc-950">Change password</h2>
      <Field label="New password" error={passwordErrors.password}><input name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} aria-invalid={Boolean(passwordErrors.password)} className={fieldClass} /></Field>
      <Field label="Confirm new password" error={passwordErrors.confirmPassword}><input name="confirmPassword" type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" aria-invalid={Boolean(passwordErrors.confirmPassword)} className={fieldClass} /></Field>
      <p className="text-sm text-zinc-600">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
      {passwordStatus ? <Banner tone={passwordStatus.tone}>{passwordStatus.text}</Banner> : null}
      <button type="submit" disabled={passwordPending} className={`${buttonClass.primary} w-full sm:w-auto`}>{passwordPending ? "Changing…" : "Change password"}</button>
    </form>
    <section className={`${cardClass} grid gap-3`} aria-labelledby="profile-more">
      <h2 id="profile-more" className="text-lg font-semibold text-zinc-950">More</h2>
      <Link href={INVENTORY_NOTIFICATIONS_PATH} className={`${buttonClass.secondary} w-full sm:w-auto sm:self-start`}><Bell className="h-4 w-4" aria-hidden="true" />Notifications</Link>
      {showFullProfileLink ? <Link href="/settings/profile" className={`${buttonClass.secondary} w-full sm:w-auto sm:self-start`}>Open my full ProjectWorkflow profile</Link> : null}
    </section>
    <section className={cardClass} aria-labelledby="profile-signout"><h2 id="profile-signout" className="sr-only">Sign out</h2><ReadCacheSignOut large /></section>
  </div>;
}
