# مختبرك / Makhbartak

Next.js 16 app for at-home lab test ordering in Damascus and Rural Damascus.
Arabic-first, RTL, mobile-first. Customer + Nurse + Lab + Admin in one repo.

> **Status: frontend-only prototype.** No backend, no database, no real auth
> or payment provider is wired up. State is held in memory and persisted to
> the browser's `localStorage`. See "Backend status" below.

---

## Tech stack

- **Next.js** `16.2.4` (App Router, Turbopack)
- **React** `19.2.4`
- **TypeScript** strict
- **Tailwind CSS** v4 + `tailwind.config.ts`
- **framer-motion** `12`
- **lucide-react** `1.x`
- **Radix UI** primitives, `class-variance-authority`, `clsx`, `tailwind-merge`
- Font: **Readex Pro** via `next/font/google`

Internal architecture, conventions, and per-app rules are documented in
`CLAUDE.md`. Product context is in `PRODUCT.md`. Visual system in `DESIGN.md`.

## Apps in this repo

| Route     | Audience          |
|-----------|-------------------|
| `/`       | Customer (mobile-shaped on every viewport) |
| `/admin`  | Admin dashboard (desktop) |
| `/nurse`  | Nurse field app (mobile-shaped) |
| `/lab`    | Lab portal (desktop) |

## Local development

Requirements: **Node.js 20+**, npm.

```bash
npm install
npm run dev
# open http://localhost:3000
```

Demo credentials (all stored in mock data, hot-swappable from the admin UI):

- **Admin** (super_admin): `admin / admin123`
- **Lab admin** (Sham Medical Lab): `sham-admin / sham123`
- **Lab accountant**: `sham-acct / sham456`
- **Customer OTP**: any phone, OTP `1234`

## Available scripts

| Command         | What it does |
|-----------------|--------------|
| `npm run dev`   | Start the dev server with Turbopack at `http://localhost:3000`. |
| `npm run build` | Production build. Type-checks + statically prerenders all routes. |
| `npm start`     | Serve the production build (`next start`). Vercel calls this for you. |
| `npm run lint`  | ESLint with `eslint-config-next/core-web-vitals` + `…/typescript`. |

## Deploy on Vercel

The app is a stock Next.js project; Vercel detects it without configuration.

1. **Push to a Git host** (GitHub / GitLab / Bitbucket).
2. Open <https://vercel.com/new> and import the repository.
3. Vercel auto-detects:
   - Framework: **Next.js**
   - Build command: `next build`
   - Output: `.next/`
   - Install: `npm install`
   - Node.js: 20+
4. **Environment variables**: none required for the current prototype. If you
   later wire a backend, copy keys from `.env.example` to Vercel project
   settings → Environment Variables (Production / Preview / Development as
   appropriate). Anything prefixed with `NEXT_PUBLIC_` is exposed to the
   browser.
5. Click **Deploy**. First build takes ~1 minute.

### After deploy

- All routes (`/`, `/admin`, `/nurse`, `/lab`) are statically prerendered (`○`
  in the build output) — no SSR, no Edge function cost, no cold start.
- All client state lives in the browser. Two users on the same machine share
  a `localStorage` namespace; two browsers / two devices do not.
- Remote images are restricted to the hosts listed in `next.config.ts`
  (Picsum + Unsplash). Adding a new image source means adding its hostname
  to `images.remotePatterns` and redeploying.

## Backend status

There is **no backend**. Everything that looks like an API call is in fact:

- An in-memory live store (`src/lib/store.ts` + sibling stores), or
- A `localStorage`-persisted store (branding, system settings, content pages,
  lab users, profile, payment preference, nurse profile, libraries, shortage
  requests, ratings).

Cross-tab / multi-user sync, real auth, real payments, real PDF storage, and
audit-grade activity logs all need a backend. When the backend lands, the
swap is intentionally narrow: the `useXxx` hooks remain, the read/write
helpers move to `fetch` + websocket. See `CLAUDE.md` → "Mock data rules".

## Environment variables

None required for the prototype. `.env.example` documents the *future*
contract (site URL, API base URL, secret API keys for payments/OTP/etc.) so
the deploy story is explicit.

## Production checklist

The audit below covers the items that matter when shipping this repo to
Vercel as-is. The build is currently green and reproducibly deployable.

- [x] `npm run build` succeeds with TypeScript strict + ESLint clean.
- [x] All four routes (`/`, `/admin`, `/nurse`, `/lab`) prerender as static.
- [x] No hard-coded `localhost` URLs in `src/`.
- [x] No `process.env.*` reads (so no missing-env crashes in production).
- [x] No committed `.env*`, `.pem`, `.key`, or service-account files.
- [x] `.gitignore` excludes `node_modules`, `.next`, `.env*`, `.vercel`,
      `*.tsbuildinfo`, `next-env.d.ts`.
- [x] Remote image hosts whitelisted in `next.config.ts`.
- [x] PWA manifest references no missing icon files.
- [x] No API routes (no functions to provision).

## Known caveats

- **Two raw `<img>` tags** exist in `AdminDashboard.tsx` (package thumbnail
  and slider preview) with `eslint-disable @next/next/no-img-element`. They
  work in production; switching to `next/image` later is a follow-up.
- **PWA icons**: `public/manifest.json` ships an empty `icons[]` because the
  192/512 PNG assets aren't in the repo. Add them and re-populate the array
  before promoting the PWA to install banners.
- **`localStorage` scope**: the prototype uses many localStorage keys
  (`makhbartak.*`). Clearing site data resets the entire customer/admin/lab
  experience. This is intentional for a prototype.

## Repository layout

```
src/
  app/                Next.js App Router pages
    page.tsx          Customer (auth + tabbed shell, guest mode)
    admin/page.tsx    Admin dashboard
    nurse/page.tsx    Nurse field app
    lab/page.tsx      Lab portal
  components/         Per-app + shared UI
  lib/                Types + live stores + helpers
public/
  manifest.json       PWA manifest (icons stubbed for now)
```

## Contributing / model context

If you're using Claude Code or a similar coding agent on this repo, read
`CLAUDE.md` first — it documents the breaking-change Next.js notes, RTL
rules, design tokens, prototype boundaries, and per-stage QA checklists
that the project has accumulated.
