'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

/**
 * The email the dealer sends to their account rep, with a copy button.
 *
 * Rendered as selectable text rather than a `mailto:` link on purpose. The
 * dealer does not know their rep's address off the top of their head, this
 * usually gets sent from a phone or forwarded to whoever handles the account,
 * and a mailto that opens the wrong client is a dead end. Text they can copy
 * works everywhere.
 */
export function RepEmail({ body }: { body: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and blocked outright in some embedded
      // browsers. The text is on screen and selectable either way, so a failure
      // here needs no error state — it just means they select it by hand.
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50">
      <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-3 py-2">
        <span className="text-xs font-medium text-ink-600">Send this to your rep</span>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-ink-700">
        {body}
      </pre>
    </div>
  );
}
