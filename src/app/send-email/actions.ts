'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { sendEmail } from '@/lib/email';
import {
  SALES_COOKIE,
  SALES_FROM,
  SALES_REPLY_TO,
  gateToken,
  passwordMatches,
  salesUnlocked,
} from '@/lib/sales-gate';
import { SALES_SUBJECT, salesInfoHtml, salesInfoText } from '@/lib/sales-email-template';

export async function unlock(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!passwordMatches(password)) redirect('/send-email?error=1');

  (await cookies()).set(SALES_COOKIE, gateToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/send-email',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect('/send-email');
}

export async function lock() {
  (await cookies()).delete({ name: SALES_COOKIE, path: '/send-email' });
  redirect('/send-email');
}

export type SendState = { ok: boolean; message: string; sentTo?: string } | null;

const Input = z.object({
  name: z.string().trim().min(1, 'Add their first name.').max(60).regex(/^[^<>\r\n]+$/, 'Name has odd characters.'),
  email: z.email('That email address doesn’t look right.').max(200),
  phone: z.string().trim().min(7, 'Add the phone number for the signature.').max(30).regex(/^[0-9()+.\-\s]+$/, 'Phone should be digits only.'),
});

export async function sendSalesEmail(_prev: SendState, formData: FormData): Promise<SendState> {
  if (!(await salesUnlocked())) return { ok: false, message: 'Signed out. Reload the page and enter the password.' };

  const parsed = Input.safeParse({
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    phone: String(formData.get('phone') ?? ''),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the fields.' };

  const { name, email, phone } = parsed.data;
  const sent = await sendEmail({
    from: SALES_FROM,
    replyTo: SALES_REPLY_TO,
    to: email,
    subject: SALES_SUBJECT,
    text: salesInfoText(name, phone),
    html: salesInfoHtml(name, phone),
  });

  if (!sent) return { ok: false, message: 'Didn’t send. Nothing went out — tell David.' };
  console.log(`[sales-email] sent to ${email}`);
  return { ok: true, message: `Sent to ${email}`, sentTo: email };
}
