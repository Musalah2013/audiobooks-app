---
name: samawy-design
description: Use Samawy's brand and UI kit when designing for Samawy — the Arab digital publishing platform (سمــــاوي). Apply when the user asks for Samawy mockups, screens, slides, marketing materials, or anything branded "Samawy". This skill provides the complete design system: colors, typography (Lama Sans), logos, the bookmark visual motif, voice/tone, and three pixel-close UI kits (mobile reading app, samawy.com web, and Creator admin).
---

# Samawy Design System

## What Samawy is

Samawy (سمــــاوي — "skyward / heavenly") is an Arab publishing-technology company building the digital infrastructure for the book industry. It produces ebooks and audiobooks, handles print-on-demand, distributes content digitally, and provides platform tooling for publishers, authors, and cultural institutions.

**Tone:** literary, calm, modern-Arabic. Always Arabic-first; English is secondary. Default to RTL.

## How to use this skill

1. **Always read `README.md` first** — it contains the full content fundamentals (voice, tagline, copy do's/don'ts), visual foundations (color rationale, type scale, motion), iconography rules, and product context for the three surfaces.
2. **Load tokens from `colors_and_type.css`** — link it from any HTML you produce. It defines:
   - Brand color: `--samawy-blue: #0B80FF` (with sky-blue + cyan secondaries, midnight-ink dark)
   - Typeface: `--font-arabic: 'Lama Sans'` and `--font-latin: 'Lama Sans'`
   - Type scale (display → caption), radii, shadows, spacing, motion
3. **Use the matching UI kit** as your component library:
   - `ui_kits/mobile/` — iOS/Android reading app (welcome, sign-in, home, book detail, audio player, ebook reader, tab bar)
   - `ui_kits/web/` — samawy.com (header, hero, books carousel, genre tiles, about strip, footer)
   - `ui_kits/creator/` — admin app (sidebar, top bar, Create Collection form with book search panel)
   Each kit has a `components.jsx` and a runnable `index.html`. Read them, copy components, follow their patterns.
4. **Brand assets** live in `assets/` — logos in 4 lockups (primary, on-dark, on-blue, monochrome) plus the bookmark icon. Use `assets/logo-primary.png` on light, `assets/logo-on-dark.png` on dark.

## The bookmark motif

Samawy's secondary brand mark is a **bookmark / book-spine** silhouette: `clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 88%, 0 100%)` with rounded top corners (`border-radius: 24px 24px 0 0`). Use it as decoration on hero sections, category tiles, and section dividers. Layer at low opacity (≈7%) on dark blue backgrounds. See `preview/brand-pattern.html` for the canonical treatment.

## Hard rules

- **Don't** translate the wordmark — "سمــــاوي" stays Arabic in lockups.
- **Don't** use gradients on body text or as default surfaces; reserve gradients for hero compositions and book covers.
- **Don't** use Inter, Roboto, or system fonts. Lama Sans is mandatory; if missing, fall back to `system-ui` only as last resort and flag it.
- **Don't** invent emoji or stock-icon iconography — use the bookmark mark or simple stroke icons (1.5–1.75 stroke width).
- **Do** set `dir="rtl"` on Arabic content and use `var(--font-arabic)` everywhere copy is Arabic.
- **Do** prefer book covers, type, and editorial composition over decorative illustration.

## Quick start template

```html
<!doctype html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="colors_and_type.css">
</head>
<body style="font-family: var(--font-arabic); color: var(--fg-1); background: #fff;">
  <!-- your design here -->
</body>
</html>
```
