# Wedding Invitation

A single static page listing every wedding function with its date, time and
venue. Tapping a card opens turn-by-turn navigation — Apple Maps on iPhone,
iPad and Mac, Google Maps everywhere else. There is also an offline QR
generator at `/qr` for the printed invite.

No database. No backend. No API keys. No build step. Four files of plain
HTML, CSS and JavaScript served as static assets.

```
index.html      the invitation (all content + styles inline)
qr.html         QR generator — /qr
assets/qr.js    dependency-free QR encoder (ISO/IEC 18004)
favicon.svg     monogram icon
vercel.json     clean URLs + cache headers
```

## Editing the details

Everything a guest sees lives in one object near the bottom of `index.html`,
under the comment banner that says **EDIT EVERYTHING HERE**. All current
values are placeholders.

```js
const WEDDING = {
  nameA: "Aanya",
  nameB: "Kevin",
  monogram: "A & K",
  tagline: "invite you to celebrate the days that make us one",
  hashtag: "#AanyaAndKevin",
  timeZone: "Asia/Kolkata",   // the venues' time zone, not the guest's
  mainEventId: "wedding",     // which event the countdown points at
  events: [ /* one entry per function */ ]
};
```

Each event:

| Field | Notes |
|---|---|
| `id` | any unique word; used for the `.ics` filename |
| `name`, `subtitle` | card title and the small gold line under it |
| `icon` | `leaf`, `diya`, `henna`, `music`, `rings` or `glass` |
| `date` | `YYYY-MM-DD` |
| `start`, `end` | `HH:MM`, 24-hour. `end` may be omitted |
| `venue`, `address` | shown on the card and sent to the maps app |
| `lat`, `lng` | **these are what navigation actually uses** |
| `note` | optional line — dress code, timings, anything |

To get `lat` / `lng`: open Google Maps, right-click the venue, and click the
two numbers at the top of the menu to copy them. Paste them in that order.

Add, remove or reorder events freely — the page, the countdown and the
calendar files all follow the array.

The names on the printed QR card are in `qr.html` (search for `id="names"`).

## Deploying

```bash
npx vercel          # preview
npx vercel --prod   # production
```

Or push to GitHub and import the repo at vercel.com — no framework, no build
command, no environment variables. Vercel serves the directory as-is.

## The QR code

Open `/qr` on the deployed site, confirm the URL, and download the SVG for
print or the PNG for WhatsApp.

The code is generated in the browser by `assets/qr.js`, which implements the
QR spec directly — byte mode, error-correction level M, versions 1–10. That
matters: the QR encodes your URL and nothing else, so **it never expires and
can never be rate-limited**. It is not a short link, not a redirect, and not
a tracking service that could disappear and take the invitation with it.
Scanning it does not contact this project at all; the phone decodes the URL
locally and goes straight there.

Print it once and it works for every guest, forever — as long as the URL
keeps working. So:

- Keep the production URL stable. If you later attach a custom domain, make
  the domain the primary URL *before* printing, and regenerate the QR for it.
- Error-correction level M tolerates about 15% damage, so a little wear or
  a thumbprint is fine.
- Print the SVG at 2 cm or larger and keep the white margin around it.

## Notes

- Times are stored in the venues' time zone and rendered in each guest's
  local format, so a relative abroad sees a correct, sensibly formatted time.
- "Add to calendar" builds the `.ics` file in the browser.
- Works with JavaScript disabled? No — the card list is rendered from the
  config at runtime. That is the trade for keeping it one editable file.
- Respects `prefers-reduced-motion` and `prefers-color-scheme`.
