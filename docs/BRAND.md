# ARDS Operations — design system

Internal operations app for **Area 4 · Unit 12** (KNPC Mina Abdullah Refinery). This module: **Manpower Control**.
The system below is built from the U12 brand reference and is what the app actually uses.

## Logo

| File | Use |
|---|---|
| `public/brand/mark.svg` | The U12 mark, full colour, for light backgrounds. Vector; the "U12" lettering is outlined (Montserrat ExtraBold) so it renders the same everywhere. |
| `public/icon.svg` | Mark on a white rounded tile: favicon and "any" app icon. |
| `public/icon-192.png`, `icon-512.png` | Android / install icons (mark on white). |
| `public/icon-maskable-512.png` | Android adaptive icon: the mark sits inside the 66 % safe zone. |
| `public/apple-touch-icon.png` | iPhone / iPad home screen (180 px, opaque). |
| `public/favicon-32.png` | Fallback favicon. |

In code (`src/ui/brand.tsx`): `BrandMark`, `BrandTile` (the mark on a white tile, how it sits on the navy header),
`BrandLockup` (mark + wordmark + "Area 4 · Unit 12", stacked or inline), `SplashScreen`, `BrandBackdrop`, `Skyline`.

Rules
- Minimum size: 24 px for the mark, 32 px inside a tile. Keep clear space of at least a quarter of the mark's width.
- On navy or photos, always place the mark on the white tile; never recolour it, never put it on a coloured tile.
- Wordmark: **ARDS** in navy, **Operations** in logo blue, Montserrat ExtraBold; "AREA 4 · UNIT 12" in Montserrat SemiBold, slate, letter-spaced.

## Colour

| Token | Hex | Use |
|---|---|---|
| `brand-700` | `#0E2A63` | **Interface colour**: header, primary buttons, links, headings (logo navy) |
| `brand-800` / `900` | `#0A1F4A` / `#071636` | Pressed states, deep text |
| `brand-600` | `#173F8A` | Focus rings, spinner |
| `brand-50…400` | `#EEF2F9 … #4C70B6` | Tints: selected rows, subtle fills |
| `canvas` | `#F3F5F9` | App background |
| `logo-blue` `logo-red` `logo-green` | `#1D5BBF` `#E11D2A` `#12944A` | **Logo artwork and wordmark only** |
| `status-green` `status-amber` `status-red` + slate (pending) | | Manpower result only |
| `crew-a…d` | blue, green, orange, purple | Crew identity only |

The logo's red, green and blue are never used for interface elements: in this app red and green already mean
manpower status, and blue and green are crew colours. Colour always means one thing.

## Type

| Face | Use |
|---|---|
| **Montserrat** (variable, bundled) | Wordmark, page titles (`h1`), display numbers — `font-display` |
| **Inter** (variable, bundled) | Everything else; tables and figures use tabular numbers |

Scale: page title 20 px bold · section label 12 px uppercase semibold, letter-spaced · body 14–16 px · meta 11–12 px.
Only the Latin files are bundled (≈ 86 KB together) and they are cached with the app for offline use.

## Screens

- **Loading**: white-to-canvas gradient, faint sweep in the logo colours (top right), stacked lockup, navy spinner,
  "Loading operational data…", faint refinery line drawing, footer "KNPC · Mina Abdullah Refinery". The same screen is
  painted by `index.html` before the app code arrives, so there is no blank flash.
- **Sign in**: the same backdrop with the lockup and "Manpower Control" above the form.
- **Header**: navy bar, mark on a white tile, "ARDS Operations" (Montserrat Bold) and "Manpower Control · person · role".

## Components (unchanged foundations)

Cards `rounded-2xl` white with a slate ring; buttons 44 px min height (touch), primary navy; bottom sheets for editing
(swipe down to close, page locked behind); chips for status, crew badges for crews.
