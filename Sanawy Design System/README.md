# Samawy Design System

> سمــــاوي — an Arab publishing-technology company building the digital infrastructure of the book industry. Samawy produces ebooks and audiobooks, handles print-on-demand, distributes content digitally, and provides platform tooling for publishers, authors, and cultural institutions to grow their catalogs across physical and digital channels.

This folder is the canonical source of truth for Samawy's look, voice, and UI building blocks. It is consumed by designers using this platform's Design System tab, and it also works as a portable Claude Code skill (see `SKILL.md`).

---

## Index

| Path | What's in it |
|---|---|
| `colors_and_type.css` | All design tokens — color, type, spacing, radius, shadow, motion |
| `fonts/` | Lama Sans (9 weights) — primary brand typeface |
| `assets/` | Logos, app icons, book-spine pattern, hero imagery |
| `preview/` | Small HTML cards that render in the Design System tab |
| `ui_kits/mobile/` | Pixel-close recreation of the Samawy mobile reading app — welcome, sign-in, home, book detail, audio player, ebook reader, tab bar. Toggle EN/AR. |
| `ui_kits/web/` | Recreation of samawy.com — header, hero, books carousel, genre tiles, about strip, footer. Toggle EN/AR. |
| `ui_kits/creator/` | Recreation of the admin "Create Collection" tool — sidebar, top bar, form fields, surface picker, dropzone, book-search panel. |
| `SKILL.md` | Agent-skill entry point (compatible with Claude Code) |

---

## Source materials

These are the inputs this system was built from. The reader does not necessarily have access to them — they are noted for provenance.

- **Figma file**: `🔵 Samawy _ سمــــاوى.fig` (11 pages, 1173 top-level frames). Focus pages: `/UX`, `/Mobile`, `/Web`, `/App-Website-Collections-Creator`, `/store-screens`. Key frames documented by name in each UI kit's README.
- **Brand PDF**: `Visual identity FD.pdf` (V1.0, 2025 — "Colors That Speak Samawy", "Letters that Speak Our Identity").
- **Lama Sans font files**: licensed delivery, 18 files (Thin → Black + italics).
- **Logo pack**: 10 PNG lockups (full logo × icon, light/dark/blue/black backgrounds).

---

## Products represented

Samawy is a platform company, so the system covers three distinct surfaces with shared DNA:

1. **Mobile app (iOS & Android)** — the consumer reading/listening product. Arabic-first, RTL. Screens: onboarding, welcome, home/discover, search, book details, ebook reader, audio player, library, profile, marathons (reading challenges), plans/subscription.
2. **Web (samawy.com)** — the marketing site plus consumer web reader. Hero banners, genre pages, blog, author/publisher landing pages, checkout.
3. **Collections & Carousels Creator** — an internal admin tool that publishers use to assemble merchandising (collections, carousels, banners, filters, layouts). LTR English UI, data-dense tables and form builders.

---

## Content fundamentals

**Languages.** Arabic-first (RTL) for the consumer apps; English (LTR) for the admin tools and international App Store copy. Every screen in the consumer product has both directions.

**Voice.** Quiet, respectful, and elevating. Samawy positions reading as a refuge — the brand PDF opens with copy translating roughly to *"In a world that does not rest, where events race and preoccupations overlap, we sometimes forget to grant ourselves moments of calm. Between the covers of a book, we may find a haven…"* The product copy mirrors this: calm, inviting, low-urgency, second-person ("you"/"أنت") rather than corporate "we".

**Casing.** Title Case for headings and primary buttons ("Create an Account", "Continue with Apple"). Sentence case for body copy and in-app metadata. No SHOUTY ALL-CAPS except the occasional SAR currency glyph.

**Tone examples** (pulled from the Figma):
- Welcome/hero: "اخترنا لك" ("Picked for you") — one breath, no exclamation.
- Empty reading list: "هذه القائمة تجمع أكثر الكتب التي حازت إعجاب القرّاء خلال الفترة الأخيرة…" — narrative, not instructional.
- CTAs: "Create an Account", "Continue", "Get Started", "Listen Now", "اشترك الآن" — verbs, no exclamations.
- Meta labels: "إشتراك سماوي" ("Samawy Subscription"), "مجانا" ("Free"), "Currently Reading", "My Library".

**Emoji.** Not used. Iconography carries affect instead.

**Numerals.** Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) in Arabic contexts; Western (0–9) in English. Currency: SAR glyph `﷼` / `S.R` or the Samawy-SAR custom font (ligature `S1 40.6` etc.) in the mobile app.

**Vibe.** Thoughtful, modern, a little literary. Not playful; not austere. The kind of brand that would rather show a book cover than a stock photo.

---

## Visual foundations

### Color
- **Samawy Blue `#0B80FF`** is the primary action color — CTAs, active tabs, links, selected states, the bookmark-mark itself. Used on white (`#FFFFFF`) 80% of the time in the consumer app.
- **Midnight Ink `#010B26`** is the dark surface — used full-bleed on splash screens, the player background, dark mode reader, and the brand's dark lockup. It's a true navy, not pure black.
- **Cyan `#0BC0F1`** is the secondary, used for info states, section accents on web, and the gradient ends on marathon screens.
- **Sky `#A9DDF7`**, **Lime `#B5D77A`**, **Sun `#F9E866`** are category/badge accents — lime for free titles, sun for sale/highlight chips, sky for illustration washes.
- Greys lean cool and muted; the canonical working palette uses `#212121` for body text, `#6B6B6B` secondary, `#9C9C9C` tertiary, `#EEEEEE` hairlines/dividers, `#F7F8FA` section backgrounds.

### Type
- **Lama Sans** — custom Arabic/Latin display. Thin → Black. Used for brand-forward surfaces (hero banners, logo, splash, reading-mode "Publisher Style").
- **Hanken Grotesk** stands in for the licensed **Effra** used throughout the product (all UI chrome, buttons, metadata). Substitution flagged — see Caveats.
- **IBM Plex Sans Arabic / Noto Naskh / Amiri** — offered inside the ebook reader as reading-face options (Themes & Fonts panel).
- **Samawy-SAR** — custom currency font, always 10px, always in secondary grey next to price numerals.
- Scale is fairly tight: 10, 12, 13, 14, 16, 18, 20, 24, 32, 48, 64. Line-heights 1.4 for UI, 1.5 for body, 1.6 for hero blocks. Arabic lines are the same values but visually airier because of the script.

### Spacing & layout
- 4px base grid. Common gaps 8 / 12 / 16 / 24 / 32.
- Mobile screens use a 16 or 24px page gutter; cards sit edge-to-edge inside the page.
- Web uses a 1440 / 1920 max-width composition with 1920×600 hero banners stitched from a 3-piece export (full-bleed).
- Tables and admin layouts use a 12-column grid, 24px gutter.

### Backgrounds
- **Surfaces are almost always flat white or flat navy** — no gradient fills on cards.
- **Full-bleed photography** on hero banners (authors, book covers, illustrated compositions); never a photo behind body copy.
- **"Book-spine" pattern** from the brand PDF is the signature texture: the three bookmark shapes repeated in blue + white on navy. Used sparingly, mostly on empty states, splash, and share sheets.
- No noise, no glass/blur on surfaces — though the audio player uses the cover art blurred ~30px as a backdrop behind the controls (subtle, heavy darken overlay).
- No drop-shadowed gradients on buttons. The tab bar gets a `0 -2px 4px rgba(0,0,0,0.09)` upward shadow; that's the main use of shadows in mobile chrome.

### Motion
- Standard ease `cubic-bezier(.2,.7,.3,1)`. Durations 120ms (micro), 200ms (base), 320ms (page-level).
- Fade + 4px upward slide on sheet entries; fade-only on menu/tooltip entries.
- No bounces. No parallax. Interactions feel confident, not cute.

### States
- **Hover (web/admin)**: background darkens 4–6% for neutral surfaces; primary buttons go `--blue-600`. Links underline on hover.
- **Active/press**: mobile primary buttons darken to `--blue-700` and shrink 2% on tap. No colored ring.
- **Focus**: 4px `rgba(11,128,255,0.18)` ring outside the element (see `--shadow-ring-brand`).
- **Disabled**: 40% opacity, no pointer events, never a separate grey token.

### Borders, dividers, cards
- Card radius is **16px** by default, **12px** for smaller tiles, **24px** on bottom sheets (top corners only). Buttons are **pill-shape** (`999px`) or **12px rounded rectangle**; both exist — pills dominate primary CTAs, rectangles dominate input-adjacent buttons.
- 1px borders in `#EEEEEE` or `#E0E0E0`. Dividers inside lists are 1px in `#D0D0D0` full-bleed.
- Cards get `--shadow-md` (`0 6px 14px rgba(1,11,38,.08)`) when elevated, otherwise they sit flat with a 1px border.

### Transparency & blur
- Used only for the **audio player** (blurred cover art behind the controls), **modal overlays** (`rgba(1,11,38,0.6)` backdrop), and the **tab-bar shadow**. Not for card surfaces.

### Imagery
- **Book covers** carry the color vibe — publishers supply their own palette, the app frames them cleanly. Covers are always rendered at their native aspect, never cropped.
- Editorial/marketing photography is warm, natural-light, slightly cinematic. Not pure black and white, not grainy.
- Illustrations (where they exist, mostly on empty states and onboarding) are flat geometric with the brand blue + ink.

### Fixed elements
- Mobile: status bar (device), top bar (screen title, back), bottom tab bar (4 items: Home, My Library, Discover, Settings), optional mini audio player sitting just above the tab bar.
- Web: persistent header (logo right in RTL, nav, user menu), sticky on scroll after 80px. Footer full-bleed in navy.

---

## Iconography

Samawy's icon language is defined in the brand PDF as:

> **Modern, Minimal, Geometric, Flat, Rounded — solid & outline variants.**

In practice the Figma leans heavily on **Iconly (Regular – Outline / Bold)** and **Hugeicons / Iconsax** for product icons — the existing components are `Iconly/Regular/Outline/Star`, `Iconly/Regular/Bold/Paper-Negative`, `Iconly/Regular/Outline/Arrow-Right`, `iconsax-okb--okb`, `Hugeicons` bookmark-add, headphones, glasses (reading), share-05, etc.

**Approach:**
- **System icons at 24×24** (sometimes 20 or 28 in chrome), **1.5–1.75px stroke weight**, **rounded caps and joins**. Colors resolve to `currentColor` and inherit from text.
- **Outline by default**; **solid** variant only when indicating an active state (filled bookmark = saved, filled star = rated, filled heart = liked).
- **Bookmark mark** (`m` made of three bookmark ribbons) is *the* brand icon — never redraw by hand; always use the PNGs in `assets/`.
- **Custom SAR currency glyph** (`Samawy-SAR` font) appears beside prices — always 10px, secondary grey.
- **No emoji**. **No unicode symbol icons** beyond the currency ligature.

**CDN substitutes.** Because the codebase uses mixed Iconly/Hugeicons/Iconsax sets (none CDN-hosted as a cohesive pack), the UI kits here render icons via **Lucide** (`https://cdn.jsdelivr.net/npm/lucide-static@0.474.0/`) — same stroke weight, same rounded caps, visually near-identical for production-feel mockups. When building with the real product, swap Lucide imports for the Figma originals.

**Flagged substitutions:**
- Effra → Hanken Grotesk (Latin UI type).
- Iconly/Hugeicons/Iconsax → Lucide (system icons).
- Samawy-SAR → literal `SAR` text (the custom ligature font is not distributed).

---

## Caveats & next steps (for the user)

- **Effra is not bundled** — please drop `Effra-Regular/Medium/Bold.woff2` into `fonts/` and the `--font-latin` stack will pick it up ahead of the fallback.
- The **Samawy-SAR** currency font is referenced in the Figma but not delivered; mockups show literal `SAR` text.
- **Icon substitution**: Lucide is used throughout the UI kits. If you have the packaged Iconly/Hugeicons bundle, drop it into `assets/icons/` and swap the CDN link.
- The pattern/texture described in the brand PDF ("bookmarks and book spines") is not delivered as a vector; a close approximation is rendered procedurally in `preview/brand-pattern.html`.
