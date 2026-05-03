import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";

interface SignupBody {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Self-signup for customers. Uses the service-role auth.admin.createUser with
// email_confirm:true so the new account can sign in immediately without an
// extra verification email round-trip. The on-signup trigger inserts the
// matching profiles + customers rows; we patch full_name + phone after.
export async function POST(req: NextRequest) {
  let body: SignupBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.fullName ?? "").trim();
  const phone = body.phone?.trim() || null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "البريد الإلكتروني غير صالح" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "الاسم الكامل مطلوب" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Reject if the email already exists. listUsers paginates; for the small
  // demo dataset 1 page suffices. Production would use a more targeted check.
  const { data: existing } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existing?.users.some((u) => (u.email ?? "").toLowerCase() === email)) {
    return NextResponse.json({ error: "هذا البريد الإلكتروني مسجل مسبقاً" }, { status: 409 });
  }

  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });
  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message ?? "تعذر إنشاء الحساب" }, { status: 500 });
  }
  const userId = created.user.id;

  // Patch profile shape (the on-signup trigger leaves full_name/phone null).
  const { error: profErr } = await sb
    .from("profiles")
    .update({ full_name: fullName, phone, role: "customer", is_active: true })
    .eq("id", userId);
  if (profErr) {
    await sb.auth.admin.deleteUser(userId).catch(() => null);
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId });
}
