# XRF Testing Certificate Generator

A small, fully client-side web app that fills in a BIS "XRF Testing
Certificate" (jewellery hallmark certificate) using the original certificate
PDF as an exact master template. Only the **Name**, **Weight**, **Product**,
**Purity** and the **product photo** are replaced — the logo, headings,
rules, borders, spacing and all other static content are byte-for-byte the
original template, reused as a vector layer (never rasterized or redrawn).

## Running it

No build step and no server-side code are required.

**Option A — just open it**
Double-click `index.html` (or open it via `File → Open` in your browser).

**Option B — tiny local server** (recommended, some browsers restrict
`fetch()` on `file://` pages)
```bash
npm start
```
This runs a static file server (via `npx serve`) on `http://localhost:5173`.
It's only a convenience — the app has no runtime npm dependencies at all;
every library it needs is already vendored in `assets/`.

## How it works

1. `assets/template/certificate-template.pdf` — the original reference PDF,
   used as-is.
2. On "Generate PDF", the app (via `pdf-lib`, vendored in
   `assets/pdf-lib.min.js`) embeds that template's page as a vector object
   inside a brand-new PDF document, so nothing about the original artwork,
   logo or layout is touched.
3. It then draws four small white rectangles over the old placeholder
   values (Name / Weight / Product / Purity) and writes your new text in
   their place, auto-shrinking the font size so long values never overflow
   their row.
4. It clears the photo box and draws your uploaded image inside it, scaled
   to fit while preserving its aspect ratio, and centered — exactly the way
   the reference certificate's photo was placed.
5. The result is rendered in the in-page **PDF Preview** pane and made
   available via **Download PDF**. **Reset** clears the form, the preview,
   and any in-memory image/PDF data.

Because the template page is embedded as a vector object (not a flattened
image), the logo and static text stay perfectly sharp at any zoom level —
nothing is rasterized except the product photo you upload, which is placed
into its box at your original image's resolution.

## Font note

The reference PDF's certificate text is embedded as a **Type 3 font**
(effectively baked-in vector shapes rather than a standard, extractable
font file), so the exact original typeface cannot be recovered or reused
for the new dynamic text. The app uses **PT Serif Bold** (SIL Open Font
License, included in `assets/fonts/`) as the closest visual match — a bold
serif in the same spirit as the original — for the four replaced values. All
static text on the certificate (headings, labels, the "BIS 100% Hallmarked
Jewellery" line) is part of the original template and is completely
untouched, so it still renders in the exact original typeface.

## Security & privacy

- **Everything runs in the browser.** There is no backend; no form field
  and no uploaded image is ever transmitted anywhere.
- **Fresh template every time.** Each "Generate" run starts from a clean,
  independent copy of the template bytes — a previous run's data can never
  leak into a new one.
- **Image validation:**
  - Only JPG, PNG and WebP are accepted, verified by inspecting the file's
    magic bytes (not just its extension or reported MIME type).
  - Files over 5 MB are rejected.
  - WebP images are re-encoded to PNG via an in-memory `<canvas>` before
    embedding (`pdf-lib` can't embed WebP directly); this also strips any
    embedded metadata, since only pixel data survives the re-encode.
- **Text sanitization:** all four text fields are stripped of anything
  outside a safe character set (letters, numbers, spaces and basic
  punctuation) and length-capped before being used, before being drawn
  into the PDF.
- **No persistence:** nothing is written to `localStorage`, cookies, or
  disk. Object URLs used for previews/downloads are revoked on reset and
  before generating a new certificate.
- **No secrets:** the app has no API keys, tokens, or server credentials —
  there's nothing server-side to leak.

## Project structure

```
index.html
css/style.css
js/app.js               # form wiring, validation, sanitization, UI state
js/pdfGenerator.js       # template loading + overlay drawing (pdf-lib)
assets/
  pdf-lib.min.js         # vendored, MIT licensed
  fontkit.umd.min.js     # vendored, MIT licensed (custom font embedding)
  fonts/PTSerif-Bold.ttf # SIL OFL licensed substitute font (see OFL.txt)
  images/bis-logo.png    # provided BIS logo asset
  template/certificate-template.pdf  # original reference PDF, untouched
package.json             # optional local static server script
README.md
```

## Customizing the layout

All of the template's fixed coordinates (row positions, photo box, margins)
live in one place: the `LAYOUT` object at the top of `js/pdfGenerator.js`.
They were measured directly from the original PDF and should not need to
change unless a different template is supplied.
