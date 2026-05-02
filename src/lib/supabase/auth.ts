"use client";
import { getSupabaseBrowser } from "./client";
import { clearCustomerIdCache } from "./auth-helpers";
import { USE_DEV_OTP, DEV_OTP_CODE } from "./flags";

// Thin wrappers around supabase.auth so the UI doesn't import the SDK directly.
// All functions return a uniform `{ ok, error?, user?, session? }` shape.

export interface AuthError {
  message: string;
  /** Original Supabase error code, when available, for finer-grained UI logic. */
  code?: string;
}

export interface AuthResult {
  ok: boolean;
  error?: AuthError;
  user?: { id: string; phone?: string; email?: string };
  session?: { access_token: string };
}

// ─── Arabic error mapper ───────────────────────────────────────────────────
// Maps known Supabase auth error strings to Arabic copy. Anything unknown
// falls through to a safe generic. Always log the original to console for
// engineers; never show the raw English to users.
export function arabicAuthError(raw: string | undefined): string {
  if (!raw) return "حدث خطأ، حاول مرة أخرى";
  const m = raw.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "البريد أو كلمة المرور غير صحيحة";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد البريد بعد. تحقق من بريدك.";
  if (m.includes("user not found")) return "لا يوجد حساب بهذا البريد";
  if (m.includes("user already") || m.includes("already registered")) return "هذا البريد مسجل مسبقاً، سجّل الدخول بدلاً من ذلك.";
  if (m.includes("password should be") || m.includes("weak password")) return "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.";
  if (m.includes("invalid email") || m.includes("email address") && m.includes("invalid")) return "البريد الإلكتروني غير صحيح";
  if (m.includes("rate") && m.includes("limit")) return "محاولات كثيرة، حاول لاحقاً";
  if (m.includes("token has expired") || m.includes("expired")) return "انتهت صلاحية الرمز، اطلب رمزاً جديداً";
  if (m.includes("invalid otp") || m.includes("token")) return "الرمز غير صحيح، حاول مرة أخرى";
  return "حدث خطأ، حاول مرة أخرى";
}

// ─── Customer phone OTP ───────────────────────────────────────────────────

export async function sendCustomerOtp(phone: string): Promise<AuthResult> {
  const sb = getSupabaseBrowser();
  if (!sb) {
    if (USE_DEV_OTP) { console.log("Using DEV OTP fallback"); return { ok: true }; }
    return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  }
  const { error } = await sb.auth.signInWithOtp({ phone });
  if (error) {
    console.error("Supabase OTP error:", error);
    if (USE_DEV_OTP) { console.log("Using DEV OTP fallback"); return { ok: true }; }
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  return { ok: true };
}

export async function verifyCustomerOtp(
  phone: string,
  token: string
): Promise<AuthResult> {
  if (USE_DEV_OTP && token === DEV_OTP_CODE) {
    console.log("Using DEV OTP fallback");
    clearCustomerIdCache();
    return {
      ok: true,
      user: { id: "dev-user", phone },
      session: { access_token: "dev-token" },
    };
  }
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  const { data, error } = await sb.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) {
    console.error("Supabase OTP error:", error);
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  clearCustomerIdCache();
  return {
    ok: true,
    user: data.user ? {
      id: data.user.id,
      phone: data.user.phone ?? undefined,
      email: data.user.email ?? undefined,
    } : undefined,
    session: data.session ? { access_token: data.session.access_token } : undefined,
  };
}

// ─── Email — magic link / 6-digit OTP ──────────────────────────────────────

export async function sendEmailMagicLink(email: string): Promise<AuthResult> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
  if (error) {
    console.error("Supabase email magic-link error:", error);
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  return { ok: true };
}

/** @deprecated alias for sendEmailMagicLink, kept for back-compat. */
export const sendEmailOtp = sendEmailMagicLink;

export async function verifyEmailOtp(email: string, token: string): Promise<AuthResult> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    console.error("Supabase email-OTP error:", error);
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  clearCustomerIdCache();
  return {
    ok: true,
    user: data.user ? {
      id: data.user.id,
      phone: data.user.phone ?? undefined,
      email: data.user.email ?? undefined,
    } : undefined,
    session: data.session ? { access_token: data.session.access_token } : undefined,
  };
}

// ─── Email — password ──────────────────────────────────────────────────────

export async function signInWithEmailPassword(
  email: string,
  password: string
): Promise<AuthResult> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Supabase signIn error:", error);
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  clearCustomerIdCache();
  return {
    ok: true,
    user: data.user ? { id: data.user.id, email: data.user.email ?? undefined } : undefined,
    session: data.session ? { access_token: data.session.access_token } : undefined,
  };
}

export async function signUpWithEmailPassword(
  email: string,
  password: string
): Promise<AuthResult> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
  if (error) {
    console.error("Supabase signUp error:", error);
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  clearCustomerIdCache();
  return {
    ok: true,
    user: data.user ? { id: data.user.id, email: data.user.email ?? undefined } : undefined,
    session: data.session ? { access_token: data.session.access_token } : undefined,
  };
}

export async function resetPassword(email: string): Promise<AuthResult> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: { message: "الخدمة غير متاحة، تحقق من إعدادات Supabase" } };
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined,
  });
  if (error) {
    console.error("Supabase resetPassword error:", error);
    return { ok: false, error: { message: arabicAuthError(error.message), code: error.code } };
  }
  return { ok: true };
}

// ─── Staff (admin / lab / nurse — email + password) ────────────────────────
// Same as signInWithEmailPassword; alias kept so staff-side callers can stay
// distinct from customer auth in code intent.
export const signInWithPassword = signInWithEmailPassword;

// ─── Common ────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  const sb = getSupabaseBrowser();
  if (!sb) return;
  await sb.auth.signOut();
  clearCustomerIdCache();
}

export async function getCurrentSession() {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function getCurrentUser() {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user;
}

export function onAuthChange(cb: (event: string, hasSession: boolean) => void) {
  const sb = getSupabaseBrowser();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((evt, session) => {
    clearCustomerIdCache();
    cb(evt, !!session);
  });
  return () => data.subscription.unsubscribe();
}

// Return the Arabic mapper for callers that want to format their own errors.
export { arabicAuthError as authErrorAr };

// Re-export for callers that want a raw type union for email sub-modes.
export type EmailMode = "password_login" | "password_signup" | "magic_link";
