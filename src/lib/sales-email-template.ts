/**
 * The "info, as promised" email reps send after a call. Shared by the compose
 * page (live preview, client) and the send action (server), so what the rep
 * sees is exactly what goes out.
 */

export const SALES_SUBJECT = 'Rooftop info, as promised';

const BULLETS = [
  'A dealer website with your inventory on it, kept current',
  'Listings pushed out to the marketplaces you already use',
  'Facebook and Instagram ads built from your actual inventory, without needing an agency',
  'Social media posting so your pages stay active without anyone remembering to do it',
  'AI lead follow-up that answers every lead right away, including the ones that come in at 9pm',
  'Leads in one inbox instead of five',
  'Reporting like no other: what you spent, what it brought in, and which cars are getting the attention',
];

const SITE = 'https://rooftopauto.com';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function salesInfoText(name: string, phone: string): string {
  return [
    `Hi ${name || '[Name]'},`,
    '',
    'Thanks for taking my call. Here’s the short version.',
    'Rooftop gives an independent dealer one place to run the online side of the lot:',
    '',
    ...BULLETS.map((b) => `* ${b}`),
    '',
    `You can see it here: ${SITE}`,
    `If it looks worth 15 minutes, reply here or call me at ${phone || '[phone]'} and I’ll walk you through it on your own inventory.`,
    '',
    'David',
    'Rooftop Auto',
  ].join('\n');
}

export function salesInfoHtml(name: string, phone: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:560px">
<p>Hi ${esc(name)},</p>
<p>Thanks for taking my call. Here&rsquo;s the short version.<br>Rooftop gives an independent dealer one place to run the online side of the lot:</p>
<ul style="padding-left:20px;margin:0 0 14px">
${BULLETS.map((b) => `<li style="margin:0 0 4px">${esc(b)}</li>`).join('\n')}
</ul>
<p>You can see it here: <a href="${SITE}" style="color:#047857">${SITE}</a><br>If it looks worth 15 minutes, reply here or call me at ${esc(phone)} and I&rsquo;ll walk you through it on your own inventory.</p>
<p>David<br>Rooftop Auto</p>
</div>`;
}
