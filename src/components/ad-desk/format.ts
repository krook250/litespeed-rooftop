/**
 * Money, the way every Ad Desk screen writes it.
 *
 * A PLAIN MODULE, deliberately. This lived in `ad-fields.tsx` for about an
 * hour, which is a `'use client'` file — so when the server-rendered groups
 * list imported it, Next handed the page a client reference rather than a
 * function and calling it threw on the server. A helper that both sides call
 * cannot live in a client module; only components can cross that line.
 */
export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
