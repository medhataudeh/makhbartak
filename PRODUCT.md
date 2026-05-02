# Product

## Register

product

## Users

Patients and family members in Damascus and Rural Damascus ordering home lab tests for themselves or their relatives. Age range 25–60. Diverse mobile literacy — the UI must work for a non-technical user picking up the app for the first time. Mobile-first, Arabic-first. Reduce long text at every opportunity; prefer icons and short labels.

## Product Purpose

مختبرك enables users to order certified home lab collection visits — either by picking a ready-made package, uploading a doctor's prescription, or manually building a custom test set. A nurse visits the patient's home, collects samples, and the lab returns results digitally. The product must feel as easy and trustworthy as ordering a ride — but with the reassurance of a clinical experience.

## Brand Personality

Reliable · Clinical · Human

The interface should project calm competence. Not sterile or bureaucratic. Not playful or consumer-cute. Somewhere between Careem's operational clarity and Vezeeta's medical trustworthiness — but simpler and more direct than either, sized for a Syrian market where users may distrust complex interfaces.

## Anti-references

- Complex, cluttered medical portals (LabCorp, Mawid)
- Government / e-government interface aesthetics
- Generic e-commerce / marketplace look (Noon, Amazon)
- Over-designed luxury healthcare (flashy gradients, excessive animation)
- Loud multi-color palettes or anything "playful"
- Multi-page navigation where a bottom sheet or full-screen modal would serve better

## Design Principles

1. **Clarity over cleverness** — Every element earns its place. If a label, icon, or animation doesn't reduce cognitive load, remove it.
2. **One clear action per screen** — Each view has one dominant CTA. Secondary actions are quieter or tucked in sheets.
3. **Trust through restraint** — Clinical credibility comes from clean spacing and consistent type, not from "medical" stock icons or over-designed cards.
4. **Sheets over pages** — Prefer bottom sheets for quick choices and full-screen modals for complex inputs. Avoid navigation that feels like a separate app.
5. **Human feedback at every step** — Loading states, success confirmations, and error messages must feel warm and specific, not generic spinners and "Error occurred."

## Accessibility & Inclusion

- WCAG AA minimum; aim for AA+ on text contrast.
- Minimum 44×44px touch targets throughout.
- All interactive elements need visible focus states.
- `prefers-reduced-motion` respected — animations degrade gracefully.
- Arabic-first: all primary labels, CTAs, and error messages in Arabic. English/abbreviations as secondary, smaller text only.
- Font size minimum 14px for secondary text, 16px for body, 18px+ for primary actions.
