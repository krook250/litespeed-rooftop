import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { operatedBy, senderName } from '@/lib/store/legal';

/**
 * The dealer's text messaging terms, generated per tenant.
 *
 * WHY THIS EXISTS
 * Every A2P 10DLC campaign must carry a public TermsAndConditionsUrl (Twilio
 * 30934), and the page behind it is read against a checklist. Malabar's first
 * campaign was rejected on 19 Oct 2026 with 30882 because there was no such
 * page at all. Each section below answers one rejection code; do not merge,
 * shorten or reword them without checking the code it answers:
 *
 *   30557  names the sending business (trade name AND the registered LLC)
 *   30559  says what the program is and what the messages are about
 *   30558  message frequency
 *   30562  "Message and data rates may apply." (literal "may")
 *   30561  STOP, with the keyword
 *   30560  working support contact (the lot phone) and HELP
 *   30563  carriers are not liable for delayed or undelivered messages
 *   30882  consent is direct to this dealer, and opt-in data is never shared
 *
 * Public, no login, linked from the opt-in block on every vehicle page and
 * from the footer. `noindex` for the same reason as the privacy page.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  return {
    title: 'Text Messaging Terms',
    description: sf ? `Terms for text messages from ${sf.name}.` : undefined,
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

export default async function StoreTermsPage({ params }: Params) {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf) notFound();

  const host = (await headers()).get('host');
  const base = storefrontBasePath(sf, host);
  const primary = sf.rooftops[0];
  const postal = primary
    ? `${primary.addressLine1}, ${primary.city}, ${primary.state} ${primary.postalCode}`
    : (sf.addressLine ?? null);
  const sender = senderName(sf.name, sf.legalName);
  const operator = operatedBy(sf.name, sf.legalName);
  const tel = `tel:+1${sf.phone.replace(/\D/g, '')}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-bold text-[var(--text)]">Text Messaging Terms</h1>
      <p className="mt-1 text-xs opacity-70">
        {sf.name}
        {' · '}
        Last updated {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </p>

      <Section title="Who sends these messages">
        <p>
          Text messages under these terms are sent by {sender}
          {postal ? <>, {postal}</> : null}.{operator ? <> {operator}</> : null} Our phone number is{' '}
          <a href={tel} className="underline">
            {sf.phone}
          </a>
          .
        </p>
      </Section>

      <Section title="What you are signing up for">
        <p>
          When you ask about a vehicle on this website and check the text message consent box, you
          agree to receive text messages from {sf.name} about your inquiry: confirmation that we got
          your request, whether the vehicle is still available, its price, scheduling a test drive or
          visit, and answers to your financing questions. These are one-to-one conversations with our
          staff about the vehicle you asked about. We do not send marketing blasts or promotions
          under this program.
        </p>
        <p>
          Checking the box is optional. You can ask about any vehicle without it, and consent to
          receive text messages is not a condition of any purchase.
        </p>
      </Section>

      <Section title="How often">
        <p>
          <strong>Message frequency may vary</strong> depending on your inquiry, typically a few
          messages while you are shopping for a vehicle.
        </p>
      </Section>

      <Section title="Cost">
        <p>
          <strong>Message and data rates may apply.</strong> Charges depend on your mobile plan; ask
          your wireless provider for details.
        </p>
      </Section>

      <Section title="How to stop">
        <p>
          Reply <strong>STOP</strong> to any message to opt out. You will receive one message
          confirming you have been unsubscribed, and no further messages after that. You can also
          reply CANCEL, END, QUIT, UNSUBSCRIBE or STOPALL. To start again, reply START.
        </p>
      </Section>

      <Section title="How to get help">
        <p>
          Reply <strong>HELP</strong> to any message for help, or call us at{' '}
          <a href={tel} className="underline">
            {sf.phone}
          </a>
          .
        </p>
      </Section>

      <Section title="Carriers">
        <p>
          Wireless carriers are not liable for delayed or undelivered messages.
        </p>
      </Section>

      <Section title="Your information">
        <p>
          Your consent is given to {sf.name} only. No mobile information will be shared with or sold
          to third parties or affiliates for marketing or promotional purposes. Text messaging
          originator opt-in data and consent will not be shared with any third parties. See our{' '}
          <a href={`${base}/privacy`} className="underline">
            Privacy Policy
          </a>
          .
        </p>
      </Section>

      <p className="mt-10 text-sm">
        <a href={base || '/'} className="underline">
          Back to inventory
        </a>
      </p>
    </div>
  );
}
