import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { dealerGroups, messagingRegistrations, storefronts } from '@/db/schema';
import { canonicalUrl } from '@/lib/store/seo';
import { smsConsentLabel } from '@/lib/store/sms-consent';
import { distinctLegalName, senderName } from '@/lib/store/legal';
import { activeNumber } from './numbers';
import { API, MESSAGING, PRIMARY_PROFILE, REGISTRATION_READY, TRUSTHUB, call, inboundUrl, joinService, prettyNumber } from './twilio';

/**
 * A dealer group's own carrier registration, so its number can text buyers.
 *
 * Litespeed files it as the ISV, under its primary profile, in the dealer's own
 * legal name and EIN, from our own form — ported from just.diy's
 * `text-registration.ts` (Oct 2026). The Compliance Embeddable is retired.
 * One brand and one campaign per group: a brand is a legal entity, and carriers
 * reject many businesses under one campaign (Twilio 30926).
 *
 *   PROFILE:  secondary customer profile + A2P profile, both submitted
 *   BRAND:    brand registration, waiting on the carriers (usually days)
 *   CAMPAIGN: messaging service + campaign, waiting on the carriers
 *   DONE:     approved; the group's number is on its messaging service
 *
 * `advance` moves a row as far as it can go right now and is safe to call
 * again at any point: every id Twilio hands back is saved before the next call,
 * so a run that dies halfway picks up where it stopped. Settings calls it when
 * the page is opened, and the daily cron calls it for everyone still waiting.
 *
 * Each brand and campaign costs Litespeed a Twilio fee. Server only.
 */

type Row = typeof messagingRegistrations.$inferSelect;
type Patch = Partial<typeof messagingRegistrations.$inferInsert>;

/** Twilio's policies for a secondary customer profile and an A2P profile. */
const PROFILE_POLICY = 'RNdfbf3fae0e1107f8aded0e7cead80bf5';
const A2P_POLICY = 'RNb0d4771c2c98518d916a3d4cd70a8f8b';
/** Twilio emails status changes here. Twilio says not to use the customer's own address. */
const OUR_EMAIL = process.env.TWILIO_NOTIFY_EMAIL || 'support@rooftopauto.com';
/** Signed webhooks and storefront links resolve against production. */
const APP_HOST = (process.env.BETTER_AUTH_URL ?? 'https://app.rooftopauto.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export const BUSINESS_TYPES = [
  { value: 'LLC', label: 'LLC', twilio: 'Limited Liability Corporation' },
  { value: 'CORPORATION', label: 'Corporation', twilio: 'Corporation' },
  { value: 'PARTNERSHIP', label: 'Partnership', twilio: 'Partnership' },
  { value: 'NONPROFIT', label: 'Non-profit', twilio: 'Non-profit Corporation' },
] as const;

export const POSITIONS = ['CEO', 'GM', 'VP', 'Director', 'CFO', 'General Counsel', 'Other'] as const;

/* ---- the business, as the carriers want it --------------------------------- */

/** EIN as Twilio wants it: 12-3456789. */
const einOf = (raw: string | null) => {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
};

const siteOf = (raw: string | null) => {
  const s = (raw ?? '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};

const twilioType = (v: string | null) => BUSINESS_TYPES.find((t) => t.value === v)?.twilio ?? '';

const businessAttributes = (r: Row) => ({
  business_name: r.legalName,
  website_url: siteOf(r.website),
  business_regions_of_operation: 'USA_AND_CANADA',
  business_type: twilioType(r.businessType),
  business_registration_identifier: 'EIN',
  business_identity: 'direct_customer',
  business_industry: 'AUTOMOTIVE',
  business_registration_number: einOf(r.ein) ?? '',
});

const repAttributes = (r: Row) => ({
  first_name: r.contactFirst,
  last_name: r.contactLast,
  business_title: r.contactTitle,
  job_position: r.contactPosition,
  email: r.contactEmail,
  phone_number: r.contactPhone,
});

/* ---- the campaign text ----------------------------------------------------- */

/** The name buyers know, the LLC behind it, and the public pages a reviewer opens. */
async function publicFace(groupId: string, legalName: string | null) {
  const [group, sf] = await Promise.all([
    db.query.dealerGroups.findFirst({ where: eq(dealerGroups.id, groupId) }),
    db.query.storefronts.findFirst({ where: eq(storefronts.groupId, groupId) }),
  ]);
  const name = sf?.name || group?.name || '';
  return {
    name,
    /** "Malabar Truck and Trade (MDF GLOBAL ENTERPRISES, LLC)": matches both the site and the brand. */
    sender: senderName(name, legalName),
    legal: distinctLegalName(name, legalName),
    phone: prettyNumber(`+1${(sf?.phone ?? '').replace(/\D/g, '').slice(-10)}`),
    site: sf ? canonicalUrl(sf, APP_HOST, '') || `https://${APP_HOST}/s/${sf.slug}` : '',
    privacy: sf ? canonicalUrl(sf, APP_HOST, '/privacy') : '',
    terms: sf ? canonicalUrl(sf, APP_HOST, '/terms') : '',
  };
}

type Face = Awaited<ReturnType<typeof publicFace>>;

/**
 * The confirmation a buyer gets first after opting in. Filed as the campaign's
 * opt-in message, so it carries everything a double opt-in confirmation needs
 * (30540): who, what, frequency, rates, HELP, STOP. The filing promises it:
 * when buyer texting ships, the first text to a consented lead must be this.
 */
export function optInMessage(dealerName: string): string {
  return `${dealerName}: thanks for your inquiry. We'll text you here about the vehicle you asked about. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
}

/** The HELP reply: names the dealer and gives a phone that answers (30890). */
const helpMessage = (f: Face) =>
  `${f.name}: for help call ${f.phone}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`;

const optOutMessage = (f: Face) =>
  `${f.name}: you're unsubscribed and won't get more texts from us. Reply START to resubscribe.`;

/**
 * What can't be filed. A campaign costs a vetting fee and a week, so it is never
 * sent with a hole a reviewer will find: no public https Terms, Privacy or
 * website, or no phone for HELP. Malabar's first campaign went out with no Terms
 * URL and came back 30882.
 */
function campaignProblem(f: Face): string | null {
  const https = (u: string) => /^https:\/\/[^/\s]+/.test(u);
  if (!f.name) return 'no storefront name';
  if (!https(f.site)) return `website is not https: "${f.site}"`;
  if (!https(f.privacy)) return `privacy URL is not https: "${f.privacy}"`;
  if (!https(f.terms)) return `terms URL is not https: "${f.terms}"`;
  if (!f.phone) return 'no storefront phone for the HELP reply';
  return null;
}

/** What the carriers read. Every sentence answers something on Twilio's rejection list. */
function campaignText(f: Face, r: Row): Record<string, string | string[]> {
  const who = f.legal ? `${f.legal}, doing business as ${f.name},` : `${f.name}`;
  const where = [r.city, r.state].filter(Boolean).join(', ');
  return {
    Description:
      `${who} is an independent used vehicle dealership${where ? ` in ${where}` : ''}. ` +
      `This campaign sends conversational, one-to-one text messages from the dealership's own sales staff to car shoppers ` +
      `who asked about a specific vehicle on the dealership's website (${f.site}) and checked the optional text message consent box. ` +
      `The dealership's first text to a shopper confirms the inquiry was received. After that, staff answer questions about that vehicle: whether it is ` +
      `still available, its price, scheduling a test drive or visit, and financing questions. Messages are triggered by the ` +
      `shopper's own inquiry and sent from the dealership's inventory and lead management software. ` +
      `No marketing blasts, no promotions, no purchased, rented or shared lists, and no third-party lead generation.`,
    MessageFlow:
      `Consumers opt in on the dealership's own public website, ${f.site} (no login). Every vehicle detail page, reached by ` +
      `clicking any vehicle on the home page, has a "Check availability" form with name, email, an optional phone field and a ` +
      `message. Below the fields is an unchecked, optional checkbox the consumer must actively tick, reading: ` +
      `"${smsConsentLabel(f.name, f.legal)}" Directly beside the checkbox are labeled links to the Text Messaging Terms ` +
      `(${f.terms}) and the Privacy Policy (${f.privacy}). The form submits without the box checked, and anyone who does not ` +
      `check it, or leaves the phone blank, is never texted. The time and exact consent wording are stored with each inquiry. ` +
      `The dealership's first text to an opted-in consumer is this confirmation: "${optInMessage(f.name)}" ` +
      `A consumer who has opted out can reply START to resubscribe.`,
    MessageSamples: [
      `${f.name}: got your request on stock #[stock number]. [salesperson] will text you shortly about the [2020 Ford F-150]. Reply STOP to opt out.`,
      `Hi [first name], it's [salesperson] at ${f.name}. The [2019 Toyota Tacoma] you asked about is still on the lot. Want to come see it [today] or [tomorrow]? Reply STOP to opt out.`,
      `${f.name}: [first name], the [2017 Chevrolet Silverado 1500] is $[price] plus tax and fees. Happy to go over financing options when you stop by. Reply STOP to opt out.`,
    ],
    HasEmbeddedLinks: 'false',
    HasEmbeddedPhone: 'false',
    AgeGated: 'false',
    DirectLending: 'false',
    PrivacyPolicyUrl: f.privacy,
    TermsAndConditionsUrl: f.terms,
  };
}

/* ---- reading and writing the row ------------------------------------------ */

export async function getRegistration(groupId: string): Promise<Row | null> {
  return (await db.query.messagingRegistrations.findFirst({ where: eq(messagingRegistrations.groupId, groupId) })) ?? null;
}

async function save(groupId: string, patch: Patch) {
  await db
    .update(messagingRegistrations)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(messagingRegistrations.groupId, groupId));
}

const sidOf = async (p: Promise<{ data?: { sid: string }; error?: string }>): Promise<string> => {
  const r = await p;
  if (r.error !== undefined || !r.data) throw new Error(r.error ?? 'No sid');
  return r.data.sid;
};

const fix = (reason: string): Patch => ({ status: 'ACTION_NEEDED', actionNeeded: reason });

/* ---- the steps -------------------------------------------------------------- */

/** Build and submit both profiles, then file the brand. Each id is saved the moment it exists. */
async function fileProfile(groupId: string, r: Row): Promise<Patch> {
  const name = r.legalName ?? '';
  const s = async (key: keyof Row & keyof Patch, make: () => Promise<string>) => {
    if (r[key]) return r[key] as string;
    const sid = await make();
    (r as Record<string, unknown>)[key] = sid;
    await save(groupId, { [key]: sid });
    return sid;
  };

  const profile = await s('customerProfileSid', () =>
    sidOf(call('POST', `${TRUSTHUB}/CustomerProfiles`, { PolicySid: PROFILE_POLICY, FriendlyName: `${name} (Rooftop)`, Email: OUR_EMAIL })),
  );
  const bizUser = await s('businessUserSid', () =>
    sidOf(
      call('POST', `${TRUSTHUB}/EndUsers`, {
        Type: 'customer_profile_business_information',
        FriendlyName: `${name} business`,
        Attributes: JSON.stringify(businessAttributes(r)),
      }),
    ),
  );
  const rep = await s('repUserSid', () =>
    sidOf(
      call('POST', `${TRUSTHUB}/EndUsers`, {
        Type: 'authorized_representative_1',
        FriendlyName: `${name} contact`,
        Attributes: JSON.stringify(repAttributes(r)),
      }),
    ),
  );
  const address = await s('addressSid', () =>
    sidOf(
      call('POST', `${API}/Addresses.json`, {
        CustomerName: name,
        Street: r.street ?? '',
        City: r.city ?? '',
        Region: r.state ?? '',
        PostalCode: r.zip ?? '',
        IsoCountry: 'US',
        FriendlyName: `${name} address`,
      }),
    ),
  );
  const doc = await s('addressDocSid', () =>
    sidOf(
      call('POST', `${TRUSTHUB}/SupportingDocuments`, {
        Type: 'customer_profile_address',
        FriendlyName: `${name} address`,
        Attributes: JSON.stringify({ address_sids: address }),
      }),
    ),
  );

  // Attaching twice is refused, harmlessly, so a rerun just attaches everything again.
  const attach = (bundle: string, object: string, kind: 'CustomerProfiles' | 'TrustProducts') =>
    call('POST', `${TRUSTHUB}/${kind}/${bundle}/EntityAssignments`, { ObjectSid: object });

  if (!r.profileSubmitted) {
    for (const o of [bizUser, rep, doc, PRIMARY_PROFILE]) await attach(profile, o, 'CustomerProfiles');
    const ev = await call<{ status: string; results?: unknown }>('POST', `${TRUSTHUB}/CustomerProfiles/${profile}/Evaluations`, {
      PolicySid: PROFILE_POLICY,
    });
    if (ev.error !== undefined) throw new Error(ev.error);
    if (ev.data.status !== 'compliant') {
      console.error('[registration] profile noncompliant', groupId, JSON.stringify(ev.data.results).slice(0, 2000));
      return fix(
        "Something in your business details or contact didn't pass the carriers' check. Make sure the legal name, EIN and address match your IRS letter exactly, then send it again.",
      );
    }
    const up = await call('POST', `${TRUSTHUB}/CustomerProfiles/${profile}`, { Status: 'pending-review' });
    if (up.error !== undefined) throw new Error(up.error);
    r.profileSubmitted = true;
    await save(groupId, { profileSubmitted: true });
  }

  const a2p = await s('a2pSid', () =>
    sidOf(call('POST', `${TRUSTHUB}/TrustProducts`, { PolicySid: A2P_POLICY, FriendlyName: `${name} A2P`, Email: OUR_EMAIL })),
  );
  const a2pUser = await s('a2pUserSid', () =>
    sidOf(
      call('POST', `${TRUSTHUB}/EndUsers`, {
        Type: 'us_a2p_messaging_profile_information',
        FriendlyName: `${name} A2P info`,
        Attributes: JSON.stringify({ company_type: r.businessType === 'NONPROFIT' ? 'non-profit' : 'private' }),
      }),
    ),
  );
  if (!r.a2pSubmitted) {
    for (const o of [a2pUser, profile]) await attach(a2p, o, 'TrustProducts');
    const ev = await call<{ status: string; results?: unknown }>('POST', `${TRUSTHUB}/TrustProducts/${a2p}/Evaluations`, {
      PolicySid: A2P_POLICY,
    });
    if (ev.error !== undefined) throw new Error(ev.error);
    if (ev.data.status !== 'compliant') {
      console.error('[registration] a2p noncompliant', groupId, JSON.stringify(ev.data.results).slice(0, 2000));
      return fix("The carriers couldn't check your business. Make sure your details match your IRS letter, then send it again.");
    }
    const up = await call('POST', `${TRUSTHUB}/TrustProducts/${a2p}`, { Status: 'pending-review' });
    if (up.error !== undefined) throw new Error(up.error);
    r.a2pSubmitted = true;
    await save(groupId, { a2pSubmitted: true });
  }

  // Low-volume brand: skips the paid secondary vetting a single dealership doesn't need.
  // Saved the moment it exists: a second brand would be a second fee.
  const brand = await s('brandSid', () =>
    sidOf(
      call('POST', `${MESSAGING}/a2p/BrandRegistrations`, {
        CustomerProfileBundleSid: profile,
        A2PProfileBundleSid: a2p,
        SkipAutomaticSecVet: 'true',
      }),
    ),
  );
  return { brandSid: brand, step: 'BRAND', status: 'SUBMITTED', actionNeeded: null };
}

/** Brand waiting on the carriers. Approved: file the campaign. */
async function checkBrand(groupId: string, r: Row): Promise<Patch | null> {
  const got = await call<{ status: string; failure_reason?: unknown }>('GET', `${MESSAGING}/a2p/BrandRegistrations/${r.brandSid}`);
  if (got.error !== undefined) return null;
  const st = got.data.status;
  if (st === 'FAILED' || st === 'SUSPENDED') {
    const why = typeof got.data.failure_reason === 'string' ? got.data.failure_reason : JSON.stringify(got.data.failure_reason ?? '');
    return fix(`The carriers turned your business down: ${why || 'no reason given'}. Check your details match your IRS letter, then send it again.`);
  }
  if (st !== 'APPROVED') return null;

  const face = await publicFace(groupId, r.legalName);
  const problem = campaignProblem(face);
  if (problem) {
    console.error('[registration] campaign not filed', groupId, problem);
    return fix("Your business is approved, but texting can't be sent for approval yet. That part is ours to fix; we'll look at it and get back to you.");
  }

  const service =
    r.messagingServiceSid ??
    (await sidOf(
      call('POST', `${MESSAGING}/Services`, {
        FriendlyName: `${r.legalName} (Rooftop)`,
        InboundRequestUrl: inboundUrl(),
        InboundMethod: 'POST',
      }),
    ));
  await save(groupId, { messagingServiceSid: service });
  const camp = await sidOf(
    call('POST', `${MESSAGING}/Services/${service}/Compliance/Usa2p`, {
      BrandRegistrationSid: r.brandSid!,
      UsAppToPersonUsecase: 'LOW_VOLUME',
      ...campaignText(face, r),
      // Opt-in, opt-out and HELP can't be changed after filing (only a new
      // campaign can), so they are filed explicitly rather than left to defaults.
      OptInMessage: optInMessage(face.name),
      OptInKeywords: ['START', 'UNSTOP'],
      OptOutMessage: optOutMessage(face),
      OptOutKeywords: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'],
      HelpMessage: helpMessage(face),
      HelpKeywords: ['HELP', 'INFO'],
    }),
  );
  return { campaignSid: camp, step: 'CAMPAIGN', status: 'SUBMITTED', actionNeeded: null };
}

/** Campaign waiting on the carriers. Approved: the group's number joins it. */
async function checkCampaign(groupId: string, r: Row): Promise<Patch | null> {
  const got = await call<{ campaign_status: string; errors?: { description?: string }[] }>(
    'GET',
    `${MESSAGING}/Services/${r.messagingServiceSid}/Compliance/Usa2p/${r.campaignSid}`,
  );
  if (got.error !== undefined) return null;
  const st = got.data.campaign_status;
  if (st === 'FAILED' || st === 'SUSPENDED') {
    const why = (got.data.errors ?? []).map((e) => e.description).filter(Boolean).join(' ');
    console.error('[registration] campaign failed', groupId, why);
    return fix(`The carriers didn't approve texting from your number${why ? `: ${why}` : ''}. That part is ours to fix; we'll look at it and get back to you.`);
  }
  if (st !== 'VERIFIED') return null;
  const n = await activeNumber(groupId);
  if (n && !(await joinService(r.messagingServiceSid!, n.twilioSid))) {
    console.error('[registration] approved but the number would not join', groupId, n.phoneNumber);
    return null;
  }
  return { step: 'DONE', status: 'READY', actionNeeded: null, readyAt: new Date() };
}

/** Move one registration on as far as it goes right now. */
export async function advance(groupId: string): Promise<void> {
  if (!REGISTRATION_READY) return;
  const r = await getRegistration(groupId);
  if (!r || r.status !== 'SUBMITTED' || !r.step) return;
  await save(groupId, {});
  try {
    const next =
      r.step === 'PROFILE'
        ? await fileProfile(groupId, r)
        : r.step === 'BRAND'
          ? await checkBrand(groupId, r)
          : r.step === 'CAMPAIGN'
            ? await checkCampaign(groupId, r)
            : null;
    if (next) await save(groupId, next);
  } catch (e) {
    // Twilio hiccup mid-run. The ids so far are saved; the next look carries on.
    console.error('[registration] advance', groupId, e instanceof Error ? e.message : e);
  }
}

/** Settings: look again if nobody has for five minutes. */
export async function advanceIfStale(groupId: string): Promise<void> {
  const r = await getRegistration(groupId);
  if (r?.status === 'SUBMITTED' && Date.now() - r.updatedAt.getTime() > 5 * 60 * 1000) await advance(groupId);
}

/** Daily cron: everyone still waiting. */
export async function advanceAll(): Promise<number> {
  if (!REGISTRATION_READY) return 0;
  const rows = await db.query.messagingRegistrations.findMany({
    where: eq(messagingRegistrations.status, 'SUBMITTED'),
    columns: { groupId: true },
    limit: 200,
  });
  for (const row of rows) {
    await advance(row.groupId);
    // Twilio asks for one brand/campaign request a second.
    await new Promise((ok) => setTimeout(ok, 1100));
  }
  return rows.length;
}

/* ---- sending it ---------------------------------------------------------------- */

export type RegistrationInput = {
  legalName: string;
  businessType: string;
  ein: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  contactFirst: string;
  contactLast: string;
  contactTitle: string;
  contactPosition: string;
  contactEmail: string;
  /** E.164. */
  contactPhone: string;
};

/** What's wrong with the form, in words for the owner, or null. */
export function inputProblem(i: RegistrationInput): string | null {
  if (!i.legalName) return 'Enter the legal business name, exactly as on your IRS letter.';
  if (!BUSINESS_TYPES.some((t) => t.value === i.businessType)) return 'Pick what kind of business it is.';
  if (!einOf(i.ein)) return 'Your EIN needs nine digits, as it appears on your IRS letter.';
  if (!i.street || !i.city || !/^[A-Z]{2}$/.test(i.state) || !/^\d{5}$/.test(i.zip))
    return 'Enter the business address: street, city, two-letter state and five-digit ZIP.';
  if (!i.website) return 'Add your website. The carriers open it to check you are real.';
  if (!i.contactFirst || !i.contactLast) return "Enter the contact's first and last name.";
  if (!i.contactTitle) return 'Enter their job title.';
  if (!(POSITIONS as readonly string[]).includes(i.contactPosition)) return 'Pick their role.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.contactEmail)) return 'Enter an email address that works.';
  if (!i.contactPhone) return 'Enter a ten-digit phone number for the contact.';
  return null;
}

/** First send, or send again after a fix. Spends a Twilio fee once the brand is filed. */
export async function sendRegistration(groupId: string, i: RegistrationInput): Promise<string | null> {
  if (!REGISTRATION_READY) return "Texting sign-up isn't switched on on this deployment.";
  if (!(await activeNumber(groupId))) return 'Get a number first.';
  const problem = inputProblem(i);
  if (problem) return problem;

  const fields: Patch = { ...i, ein: i.ein.replace(/\D/g, '') };
  const r = await getRegistration(groupId);

  // Never sent (including rows left over from the retired embed): start from the top.
  if (!r || !r.step) {
    const start: Patch = { ...fields, status: 'SUBMITTED', step: 'PROFILE', actionNeeded: null, submittedAt: new Date() };
    if (r) await save(groupId, start);
    else await db.insert(messagingRegistrations).values({ groupId, ...start });
    await advance(groupId);
    return null;
  }

  if (r.status !== 'ACTION_NEEDED') return null;

  await save(groupId, fields);
  const fresh = (await getRegistration(groupId))!;
  // A campaign refile leaves the approved profile and brand alone.
  if (r.step !== 'CAMPAIGN') await refreshFiled(fresh);
  // A brand turned down is resubmitted in place; anything earlier runs again from where it stopped.
  if (r.step === 'BRAND' && r.brandSid) await call('POST', `${MESSAGING}/a2p/BrandRegistrations/${r.brandSid}`, {});
  /*
   * A campaign turned down is deleted and filed fresh, not edited in place.
   * Twilio's in-place update cannot change the opt-in, opt-out or HELP
   * messages, and those are part of what the carriers review. A new campaign is
   * another vetting fee; a second rejection costs more. The brand is untouched
   * and still approved, so stepping back to BRAND lets `checkBrand` file the new
   * one on the next `advance`, through the same checks as the first.
   */
  if (r.step === 'CAMPAIGN' && r.messagingServiceSid && r.campaignSid) {
    const face = await publicFace(groupId, fresh.legalName);
    const problem = campaignProblem(face);
    if (problem) {
      console.error('[registration] campaign not refiled', groupId, problem);
      return "Texting can't be sent for approval yet. That part is ours to fix.";
    }
    const gone = await call('DELETE', `${MESSAGING}/Services/${r.messagingServiceSid}/Compliance/Usa2p/${r.campaignSid}`);
    if (gone.error !== undefined && !/not found|20404/i.test(gone.error)) return gone.error;
    await save(groupId, { campaignSid: null, step: 'BRAND' });
  }
  await save(groupId, {
    status: 'SUBMITTED',
    actionNeeded: null,
    submittedAt: new Date(),
    // Nothing was submitted for a profile that failed its check, so it is checked again.
    ...(r.step === 'PROFILE' ? { profileSubmitted: false, a2pSubmitted: false } : {}),
  });
  await advance(groupId);
  return null;
}

/** After a fix: what Twilio already holds is brought up to date with what they typed. */
async function refreshFiled(r: Row) {
  if (r.businessUserSid) {
    await call('POST', `${TRUSTHUB}/EndUsers/${r.businessUserSid}`, { Attributes: JSON.stringify(businessAttributes(r)) });
  }
  if (r.repUserSid) {
    await call('POST', `${TRUSTHUB}/EndUsers/${r.repUserSid}`, { Attributes: JSON.stringify(repAttributes(r)) });
  }
  if (r.addressSid) {
    await call('POST', `${API}/Addresses/${r.addressSid}.json`, {
      CustomerName: r.legalName ?? '',
      Street: r.street ?? '',
      City: r.city ?? '',
      Region: r.state ?? '',
      PostalCode: r.zip ?? '',
    });
  }
}
