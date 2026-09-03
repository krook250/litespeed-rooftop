const fs = require('fs');
const p = (f) => fs.readFileSync(__dirname + '/' + f, 'utf8');
const seed = JSON.parse(p('seed.json'));

/*
 * Analytics, and the reason it lives in the builder rather than in the file.
 *
 * `site/demo/index.html` is GENERATED. The gtag + Meta pixel block was once
 * hand-pasted into it, the way it is pasted into the nine hand-written pages
 * under `site/`, and the next `node mock/build.js` silently deleted it. The
 * demo is a page in the acquisition funnel like any other, so it has to carry
 * the tags; the only way that survives a rebuild is for the builder to emit
 * them. IDs are the same public ones as the rest of the site -- see
 * claude/google-analytics.md and claude/meta-pixel-and-signup-tracking.md.
 *
 * Injected into the SHIPPED copy only. `mock/rooftop-demo.html` is the local
 * working copy, opened off the filesystem while iterating, and hits from that
 * are not traffic.
 */
const TAGS = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-JPJLFV5STR"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-JPJLFV5STR');
</script>
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2026531694695828');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=2026531694695828&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooftop — dealer demo · Cascade Motors</title>
<meta name="description" content="Rooftop Auto — inventory, merchandising, syndication, website and reporting for independent used car lots.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@1,900&display=swap" rel="stylesheet">
<style>${p('src/styles.css')}</style>
</head><body>
<script>
const SEED = ${JSON.stringify(seed)};
${p('src/art.js')}
${p('src/data.js')}
${p('src/app.js')}
</script>
</body></html>`;

fs.writeFileSync(__dirname + '/rooftop-demo.html', html);

// Write straight into the folder that ships, too. Copying it across by hand is
// how the deployed demo drifts from the source.
const dest = __dirname + '/../site/demo/index.html';
fs.mkdirSync(__dirname + '/../site/demo', { recursive: true });
const shipped = html.replace('</head>', TAGS + '\n</head>');
fs.writeFileSync(dest, shipped);

console.log('rooftop-demo.html      ', (html.length / 1024).toFixed(0) + ' KB');
console.log('site/demo/index.html   ', (shipped.length / 1024).toFixed(0) + ' KB  (+ analytics tags)');
