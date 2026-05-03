#!/usr/bin/env node
// Server-only one-shot reset + reseed of demo users.
//
// Usage:
//   node scripts/seed-demo-users.mjs
//
// Reads from .env.local in the project root:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY        (server-only — never exposed to client)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY    (used only to verify signInWithPassword)
//
// Schema notes for this codebase:
//   * profiles has `role` (customer|admin|lab|nurse) + `admin_role` for admins.
//     There is NO standalone `admins` table.
//   * customers / nurses / lab_users extend profiles via profile_id (UNIQUE).
//   * labs is an operational entity; lab portal accounts live on lab_users.
//   * The on_auth_user_created trigger always inserts profiles(role='customer')
//     and an empty customers row. For non-customer seeds we patch the role
//     and clean up the auto-created customers row.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Load .env.local manually (no dotenv dep) ─────────────────────────────────
function loadDotenv(file) {
  if (!existsSync(file)) return;
  const txt = readFileSync(file, "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotenv(resolve(ROOT, ".env.local"));
loadDotenv(resolve(ROOT, ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── helpers ──────────────────────────────────────────────────────────────────
async function wipe(table) {
  // Delete every row. PostgREST requires a filter; "id is not null" matches
  // every row. Falls through silently when the table doesn't exist on this
  // database so the script stays compatible with partial migration sets.
  const { error } = await admin.from(table).delete().not("id", "is", null);
  if (error) {
    if (/does not exist/i.test(error.message)) {
      console.log(`  · skip ${table} (table absent)`);
    } else {
      console.warn(`  ! ${table}: ${error.message}`);
    }
  } else {
    console.log(`  · cleared ${table}`);
  }
}

async function deleteAllAuthUsers() {
  // Paginated per Supabase admin API. Each delete cascades to profiles via
  // FK, which cascades to customers/nurses/lab_users.
  let page = 1;
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    if (!data?.users?.length) break;
    for (const u of data.users) {
      const { error: dErr } = await admin.auth.admin.deleteUser(u.id);
      if (dErr) {
        console.warn(`  ! deleteUser ${u.email ?? u.id}: ${dErr.message}`);
      } else {
        removed += 1;
      }
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  console.log(`  · removed ${removed} auth users`);
}

// ── plan ─────────────────────────────────────────────────────────────────────
const SEEDS = [
  { email: "admin@demo.com",    password: "admin123",    role: "admin",    fullName: "Demo Admin" },
  { email: "nurse@demo.com",    password: "nurse123",    role: "nurse",    fullName: "Demo Nurse" },
  { email: "customer@demo.com", password: "customer123", role: "customer", fullName: "Demo Customer" },
  { email: "lab@demo.com",      password: "lab123",      role: "lab",      fullName: "Demo Lab User" },
];

// Order matters: orders.customer_id is ON DELETE RESTRICT, so anything that
// blocks deleting customers / nurses / labs / profiles is wiped first. Any
// table the migrations didn't ship is silently skipped above.
const CLEAN_ORDER = [
  // Order graph + everything that hangs off an order
  "order_idempotency",
  "lab_result_file_events",
  "lab_result_files",
  "lab_issues",
  "order_status_history",
  "order_items",
  "order_notes",
  "ratings",
  "prescription_matches",
  "prescriptions",
  "payments",
  "orders",
  // Customer-owned children
  "addresses",
  "patients",
  // Nurse-owned children
  "nurse_prep_state",
  "nurse_shortage_request_items",
  "nurse_shortage_requests",
  "shortage_request_items",
  "shortage_requests",
  // Lab-owned children
  "settlement_items",
  "settlements",
  "lab_price_agreements",
  // User-facing event streams
  "notifications",
  "admin_activity_logs",
  // Identity-extension tables (drop before profiles)
  "lab_users",
  "nurses",
  "customers",
  // Operational entities the user explicitly listed
  "labs",
  // Profile rows are also cascaded by auth.admin.deleteUser; clearing them
  // first means deletes can't fail on stragglers.
  "profiles",
];

async function step1Clean() {
  console.log("\n[1/4] Cleaning role + user-data tables…");
  for (const t of CLEAN_ORDER) await wipe(t);
  console.log("[1/4] Removing auth users via admin API…");
  await deleteAllAuthUsers();
}

async function step2CreateLab() {
  console.log("\n[2/4] Creating demo lab (needed before lab user)…");
  const { data, error } = await admin
    .from("labs")
    .insert({
      name_ar: "مخبر التجربة",
      name_en: "Demo Lab",
      phone_main: "+963900000000",
      city: "دمشق",
      is_active: true,
      supported_cities: ["دمشق", "ريف دمشق"],
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert labs: ${error.message}`);
  console.log(`  · lab ${data.id}`);
  return data.id;
}

async function step3SeedUsers(demoLabId) {
  console.log("\n[3/4] Seeding 4 demo auth users…");
  const created = [];
  for (const seed of SEEDS) {
    const { data: cre, error } = await admin.auth.admin.createUser({
      email: seed.email,
      password: seed.password,
      email_confirm: true,
      user_metadata: { full_name: seed.fullName },
    });
    if (error || !cre?.user) throw new Error(`createUser ${seed.email}: ${error?.message}`);
    const userId = cre.user.id;

    // The on_auth_user_created trigger has already inserted:
    //   profiles(id=userId, role='customer', full_name=null)
    //   customers(profile_id=userId)
    // We patch role + full_name; for non-customer seeds we drop the
    // auto-created customers row so the FK matrix matches the user's role.
    const profilePatch = {
      full_name: seed.fullName,
      is_active: true,
      role: seed.role,
    };
    if (seed.role === "admin") profilePatch.admin_role = "super_admin";
    const { error: pErr } = await admin.from("profiles").update(profilePatch).eq("id", userId);
    if (pErr) throw new Error(`profiles.update ${seed.email}: ${pErr.message}`);

    if (seed.role !== "customer") {
      const { error: dErr } = await admin.from("customers").delete().eq("profile_id", userId);
      if (dErr && !/does not exist/i.test(dErr.message)) {
        throw new Error(`customers.delete ${seed.email}: ${dErr.message}`);
      }
    }

    if (seed.role === "nurse") {
      const { error: nErr } = await admin.from("nurses").insert({
        profile_id: userId, city: "دمشق", is_active: true,
      });
      if (nErr) throw new Error(`nurses.insert ${seed.email}: ${nErr.message}`);
    }

    if (seed.role === "lab") {
      const { error: lErr } = await admin.from("lab_users").insert({
        profile_id: userId, lab_id: demoLabId, role: "lab_admin", is_active: true,
      });
      if (lErr) throw new Error(`lab_users.insert ${seed.email}: ${lErr.message}`);
    }

    console.log(`  · ${seed.role.padEnd(8)} ${seed.email}  → ${userId}`);
    created.push({ ...seed, userId });
  }
  return created;
}

async function step4VerifyLogin(created) {
  console.log("\n[4/4] Verifying signInWithPassword for each demo user…");
  if (!ANON_KEY) {
    console.warn("  ! NEXT_PUBLIC_SUPABASE_ANON_KEY missing — skipping login check");
    return;
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const u of created) {
    const { data, error } = await anon.auth.signInWithPassword({
      email: u.email, password: u.password,
    });
    if (error || !data?.session) {
      console.error(`  ✗ ${u.email}: ${error?.message ?? "no session"}`);
      continue;
    }
    console.log(`  ✓ ${u.email} login ok`);
    await anon.auth.signOut();
  }
}

async function main() {
  const started = Date.now();
  console.log(`Connecting to ${SUPABASE_URL}`);
  await step1Clean();
  const demoLabId = await step2CreateLab();
  const created = await step3SeedUsers(demoLabId);
  await step4VerifyLogin(created);

  console.log("\n────────────────────────────────────────");
  console.log("Demo users (email / password):");
  for (const u of created) {
    console.log(`  ${u.role.padEnd(8)} ${u.email}  /  ${u.password}`);
  }
  console.log("────────────────────────────────────────");
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err);
  process.exit(1);
});
