# Design

## Visual Theme

Clean, clinical, restrained. Whitespace-forward. Touches of cyan convey trustworthiness without sterility. No gradients except the single hero surface (one, flat-ish). No decorative elements — every shape serves structure or feedback.

## Color Strategy

**Restrained** — tinted neutrals carry the surface, one cyan accent at ≤10% coverage outside the hero, emerald only on primary CTAs.

| Role | Value | Usage |
|------|-------|-------|
| Primary | `#0891B2` (cyan-600) | Links, active states, info chips, top bar accent |
| CTA | `#059669` (emerald-600) | Primary action buttons, success, cart badge |
| Surface | `#ECFEFF` (cyan-50) | Selected states, info boxes, hero tint |
| Background | `#F9FAFB` (gray-50/40) | Screen backgrounds behind cards |
| Card | `#FFFFFF` | All cards and inputs |
| Text primary | `#164E63` (cyan-900) | Headings, body, data |
| Text secondary | `#0E7490` (cyan-800) | Subheadings, meta on light |
| Text muted | `#6B7280` (gray-500) | Labels, hints |
| Text placeholder | `#9CA3AF` (gray-400) | Input placeholder |
| Border | `border-gray-100` / `border-gray-200` | Card edges, section dividers |
| Error | `#EF4444` (red-500) | Error states, danger actions |
| Warning | `#F59E0B` (amber-500) | Alerts, unclear prescription matches |

## Typography

Font family: **Readex Pro** (Google Fonts) — single primary face for Arabic + Latin, weights 200–700.
Direction: RTL. Arabic is primary. Latin/English text appears at ~92% size and 400 weight via the `.lat` utility class — visually subordinate to Arabic.

| Style | Size | Weight | Usage |
|-------|------|--------|-------|
| Screen title | 20–21px | 700 | Page headers, success title |
| Section title | 15–16px | 700 | Card headings, section names |
| Body | 14–15px | 400–600 | Content, descriptions |
| Label | 12px | 500–600 | UPPERCASE tracking-wide metadata |
| Caption | 12px | 400 | Timestamps, secondary info |
| Micro | 11px | 500 | Nav tab labels, pills |
| Minimum on screen | 11px | — | Nothing below this |

Line height: 1.5–1.6 for body. Headings: 1.2–1.3.

## Elevation & Borders

No heavy box shadows. Cards sit on slightly off-white backgrounds for separation.

| Level | CSS |
|-------|-----|
| Card rest | `border border-gray-100` — no shadow |
| Card interactive | `border border-gray-200` with `active:bg-gray-50` |
| Bottom sheet | `rounded-t-2xl`, overlay `bg-black/50` |
| Buttons (primary) | `shadow-[0_2px_8px_rgba(5,150,105,0.28)]` — small, purposeful |

## Spacing Scale

Use Tailwind's default scale. Key conventions:
- Screen horizontal padding: `px-4` (16px)
- Card internal padding: `p-4` (16px), details `px-4 py-3.5`
- Vertical section gap: `space-y-3` to `space-y-4`
- Touch targets: minimum 44×44px (`min-h-[44px] min-w-[44px]`)

## Border Radius

| Context | Value |
|---------|-------|
| Screen hero | `rounded-2xl` (16px) |
| Cards | `rounded-xl` (12px) |
| Inputs | `rounded-xl` (12px) |
| Buttons | `rounded-xl` sm, `rounded-2xl` lg |
| Bottom sheet | `rounded-t-2xl` |
| Icon containers | `rounded-xl` (12px) |
| Pills/chips | `rounded-full` |
| Badges | `rounded-md` or `rounded-full` |

## Motion

Animations use **transform and opacity only** — no width/height/top/left animation.
Easing: `easeOut` for entrances, `easeIn` for exits. Spring physics for sheets and interactive elements.

| Interaction | Duration | Easing |
|-------------|----------|--------|
| Fade in (content) | 220–250ms | easeOut |
| Slide up (bottom sheet) | Spring: damping 32, stiffness 320 |
| Push/pop (full-screen) | Spring: damping 30, stiffness 300 |
| Button tap | 100ms, scale 0.97 |
| Chip/card tap | Spring: damping 18 |
| Skeleton | 1.5s shimmer loop |

`prefers-reduced-motion`: animations disabled globally via CSS media query.

## Components

### Button
- `primary` — emerald-600 bg, small drop shadow, white text
- `secondary` — cyan-600 bg
- `outline` — white bg, cyan border
- `ghost` — transparent, cyan text
- `danger` — red-500
- Sizes: `sm` h-9, `md` h-12, `lg` h-14
- Always `aria-busy` during loading; always explicit `type` attribute

### BottomSheet
- Spring slide-up, `damping 32 stiffness 320`
- Drag handle + drag-to-dismiss (80px threshold)
- `bg-black/50` backdrop, no blur (performance)
- `rounded-t-2xl`, max-height 75vh

### BackButton
- In RTL layout, "back" = ChevronRight (→)
- Always 44×44px touch target

### StatusBadge
- Rounded pill, small font, semantic color per status

### Cards
- White bg, `border-gray-100`, `rounded-xl`
- `active:bg-gray-50` on interactive rows
- Divide rows with `divide-y divide-gray-50` (not borders per row)
