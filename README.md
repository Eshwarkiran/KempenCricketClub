# Kempen Cricket Club — Astro site

The bilingual (EN + NL) static marketing site for kempencricket.be, built with [Astro](https://astro.build). Ported from the hand-built HTML prototype in `../prototype`, keeping the exact same design (`public/styles.css`) and content.

## Requirements

- Node.js 20+ (developed on Node 22)
- npm

## Commands

```bash
npm install      # install dependencies (first time)
npm run dev      # local dev server at http://localhost:4321
npm run build    # production build → dist/
npm run preview  # serve the built dist/ locally
```

## Structure

```
public/
  styles.css              # the site's stylesheet (shared with the prototype)
  robots.txt
  assets/                 # images, favicon, Stad Geel logo, cookie-consent.js
src/
  layouts/Layout.astro    # <head>, header, footer, global cookie script, hreflang
  components/
    Header.astro          # bilingual nav, active state, language toggle, CTA
    Footer.astro          # bilingual footer, legal links, Stad Geel sponsor logo
  fragments/
    en/ , nl/             # per-page body + scripts, extracted from the prototype
  pages/
    *.astro               # English pages  (/, /about, /join, ...)
    nl/*.astro            # Dutch pages     (/nl/, /nl/about, ...)
```

Each page is a thin `.astro` file that imports its content fragment and renders it inside the shared `Layout`. This keeps header/footer/head in one place (DRY) while preserving every page's original content and inline scripts (e.g. the Web3Forms handlers on Contact/Join and the registration form on Register).

## URLs

Astro uses clean URLs (no `.html`): `/about`, `/join`, `/nl/about`, etc. All internal links were rewritten accordingly during the port.

## Notes

- **Sitemap:** enabled via `@astrojs/sitemap`, pinned to **3.2.1** — versions 3.7+ require Astro 5 and crash the build (`astro:build:done` hook change). Don't upgrade it past 3.2.x while the project is on Astro 4. Noindex pages (404, thank-you, register) are excluded via the `filter` option. `public/robots.txt` points at `/sitemap-index.xml`.
- **URLs & SEO:** all URLs use trailing slashes (`/about/`, `/nl/join/`) to match `build.format: 'directory'`; `trailingSlash: 'always'` is set. `Layout.astro` emits `rel="canonical"`, `og:url`, and hreflang alternates in the same form.
- **Azure SWA config:** `public/staticwebapp.config.json` provides the custom 404, trailing-slash normalization, and security headers.
- **Forms:** no third-party form service. Contact/Join/Register POST JSON to Azure Functions endpoints (`/api/contact`, `/api/join`, `/api/register`) via `public/assets/forms.js`, which redirects to `/thank-you` on success. The footer also has a site-wide subscribe form (`Footer.astro`) posting to `/api/subscribe` — add this endpoint (and a `subscribers` table) to the member-system backend. These endpoints are Azure Functions built as part of the member system (`../KCC_Member_Management_System_Spec.md`); until they exist, submissions fail gracefully with a message to email the club. The registration form keeps its guardian-section auto-toggle for under-18s.
- **Content changes** from the editorial review can be applied directly in the `src/fragments/**` files (body HTML) — the layout/components don't change.

## Deploy

See `../KCC_Deployment_Readiness_Runbook.md` — this project deploys to Azure Static Web Apps via git, with **App location `/`** and **Output location `dist`**.
