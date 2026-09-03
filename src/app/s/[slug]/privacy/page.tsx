import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getStorefrontByKey, storefrontBasePath } from '@/lib/queries';

/**
 * The dealer's own privacy policy, generated per tenant.
 *
 * WHY THIS IS A ROUTE AND NOT A DOCUMENT THE DEALER UPLOADS
 * Two separate things need it and neither can wait on a dealer writing one:
 *
 * 1. **A2P 10DLC.** Carrier review rejects a campaign whose opt-in has no direct,
 *    ungated privacy-policy link, and rejects again if that policy does not carry
 *    the mobile-data carve-out verbatim. `claude/twilio-a2p-onboarding.md` names
 *    a per-tenant policy as the nearest real blocker on the compliance side. The
 *    carve-out sentence below is the one that matters and is quoted from the
 *    version already live on litespeedmarketing.com; do not reword it.
 * 2. **The credit application.** A storefront collects a consumer's name, phone,
 *    address and employment through `/loan-application`. Collecting that behind
 *    no policy at all is the exposure; a generated one is not a lawyer's document
 *    but it is an accurate description of what actually happens to the data,
 *    which is more than most dealer sites manage.
 *
 * It is written in the dealer's voice, not Rooftop's, because on their own domain
 * this is their policy — the visitor gave their phone number to the dealership.
 * Rooftop appears as the processor, named, because pretending otherwise would
 * make the document untrue.
 *
 * NOT `force-dynamic`: nothing here is per-request. It renders from the
 * storefront row and today's date.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  return {
    title: 'Privacy Policy',
    description: sf ? `How ${sf.name} collects and uses your information.` : undefined,
    // A policy page has no business competing with the inventory for search
    // attention, and a hundred near-identical policies across dealer domains is
    // exactly the doorway pattern that gets a small site demoted.
    robots: { index: false, follow: true },
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-[var(--muted,inherit)] opacity-90">
        {children}
      </div>
    </section>
  );
}

export default async function StorePrivacyPage({ params }: Params) {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf) notFound();

  // Same host-derived base the layout uses: on the dealer's own domain the
  // storefront is at the root, on ours it is under /s/<slug>.
  const host = (await headers()).get('host');
  const base = storefrontBasePath(sf, host) || '/';
  const primary = sf.rooftops[0];
  const postal = primary
    ? `${primary.addressLine1}, ${primary.city}, ${primary.state} ${primary.postalCode}`
    : (sf.addressLine ?? null);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-bold text-[var(--text)]">Privacy Policy</h1>
      <p className="mt-1 text-xs opacity-70">
        {sf.name}
        {' · '}
        Last updated {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </p>

      <Section title="Who we are">
        <p>
          This website is operated by {sf.name}
          {postal ? <>, {postal}</> : null}. You can reach us at{' '}
          <a href={`tel:+1${sf.phone.replace(/\D/g, '')}`} className="underline">
            {sf.phone}
          </a>
          . Our website and inventory software are provided by Rooftop Auto, a product of Litespeed
          Marketing LLC, which processes this information on our behalf.
        </p>
      </Section>

      <Section title="What we collect">
        <p>
          We collect what you give us: your name, phone number, email address, and anything you type
          into a form on this site — including a message about a specific vehicle, a trade-in
          description, or a credit application if you choose to start one.
        </p>
        <p>
          We also collect ordinary technical information every website receives, such as the pages
          you viewed and which vehicles you looked at, so we know which cars people are interested
          in.
        </p>
      </Section>

      <Section title="What we do with it">
        <p>
          We use it to answer you, to hold a vehicle, to arrange a test drive, and to follow up about
          the car you asked about. If you start a credit application, the information on that form
          goes to the lender or finance provider named on it so they can respond to your request.
        </p>
        <p>We do not sell your personal information.</p>
      </Section>

      {/*
        THE A2P CARVE-OUT. Carrier review looks for this and the campaign is
        rejected without it. Both sentences are load-bearing:
        the sharing sentence and the "may" in the rate and frequency lines.
        See `claude/twilio-a2p-onboarding.md`.
      */}
      <Section title="Text messages and your mobile number">
        <p>
          <strong>
            No mobile information will be shared with or sold to third parties or affiliates for
            marketing or promotional purposes.
          </strong>{' '}
          All of the above excludes text messaging originator opt-in data and consent; this
          information will not be shared with any third parties.
        </p>
        <p>
          If you give us your mobile number and agree to be texted, we may send you messages about
          the vehicle you asked about and your visit. <strong>Message frequency may vary.</strong>{' '}
          <strong>Message and data rates may apply.</strong> Reply STOP at any time to stop
          receiving messages, or HELP for help. Consent to receive text messages is not a condition
          of any purchase.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          Only the people who need to: our staff, the software that runs this website, and — if you
          apply for financing — the lender you applied to. We may also disclose information where the
          law requires it.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can ask us what we hold about you, ask us to correct it, or ask us to delete it. Call
          the number above or email the address on our contact page and we will take care of it. Ask
          us to stop contacting you and we will stop.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes we will post the new version on this page and update the date at the
          top.
        </p>
      </Section>

      <p className="mt-10 text-sm">
        <a href={base} className="underline">
          Back to inventory
        </a>
      </p>
    </div>
  );
}
