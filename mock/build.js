const fs = require('fs');
const p = (f) => fs.readFileSync(__dirname + '/' + f, 'utf8');
const seed = JSON.parse(p('seed.json'));

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooftop — dealer demo · Cascade Motors</title>
<meta name="description" content="Rooftop Auto — inventory, merchandising, syndication, website and reporting for independent used car lots.">
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
console.log('rooftop-demo.html', (html.length / 1024).toFixed(0) + ' KB');
