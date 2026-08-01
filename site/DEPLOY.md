# Rooftop Auto — marketing site

Static site. No build step, no Node, no database. Everything here is plain HTML,
CSS and one small PHP file, which is exactly what Bluehost shared hosting is good at.

## What's here

```
index.html        the marketing page (all CSS is inline — one file)
demo/index.html   the clickable product demo, fully self-contained
img/              screenshots, .webp with .jpg fallback
contact.php       the "book a walkthrough" form handler
thanks.html       post-submit page
favicon.svg
robots.txt
sitemap.xml
.htaccess         forces https, blocks leads.log, sets caching
```

## Uploading to Bluehost

1. cPanel → **File Manager** → navigate to `public_html/rooftop`
2. **Upload** `rooftop-site.zip`
3. Right-click the zip → **Extract** → into the current folder
4. Delete the zip
5. Load `https://rooftopauto.com` — you should get the marketing page

`.htaccess` is a dotfile. In File Manager turn on **Settings → Show Hidden Files**
or it will look like it didn't upload.

## After it's live — five minutes of housekeeping

- **Email address.** Every mailto and the form handler point at
  `david@litespeedmarketing.com`. If you set up `hello@rooftopauto.com` in cPanel,
  change it in two places: the `$TO` line at the top of `contact.php`, and the three
  `mailto:` links in `index.html`.
- **Test the form.** Submit it once. Bluehost's `mail()` sometimes lands in spam
  from a new domain — check there before assuming it broke. Every submission is also
  appended to `leads.log` in the same folder as a backup, and `.htaccess` blocks that
  file from the web.
- **SPF/DKIM.** If form mail bounces, it's almost always because the domain has no
  SPF record yet. cPanel → Email Deliverability → Repair.

## Changing the price

One place, `index.html`, marked with a comment:

```html
<!-- PRICE: change these two numbers and nothing else -->
```

The FAQ answer "I run more than one lot" repeats the same two numbers — search for
`$149` and you'll find both.

## Swapping the demo for the real app later

The demo button points at `demo/` — the self-contained HTML build. When the Next.js
app is running on Vercel, change every `href="demo/"` in `index.html` (there are five)
to the Vercel URL. Nothing else changes.

## Rebuilding the demo file

The demo is generated from the mock sources in `../mock/` — plain JavaScript, no
dependencies, no build tooling:

```bash
cd mock
node seed.js                                  # regenerate the 25 seeded units
node build.js                                 # emit rooftop-demo.html
cp rooftop-demo.html ../site/demo/index.html
```

`mock/src/` holds four files: `art.js` (placeholder vehicle imagery), `data.js` (the
feed and the metrics), `app.js` (screens and routing), `styles.css`. `build.js` inlines
all four plus `seed.json` into the single HTML file.

Note this is the standalone mock, not the Next.js app in `src/`. The two are separate
on purpose — the mock runs anywhere with zero infrastructure, which is what makes it
safe to hang off a marketing page on shared hosting.
