import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rooftop Auto',
  description:
    'Inventory, merchandising and syndication for independent dealers. One record, every channel.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // System font stack on purpose: no build-time network fetch, no font file on
  // the wire, and the storefront VDP is a page where load time is an SEO input.
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
