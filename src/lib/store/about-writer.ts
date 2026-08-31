/**
 * The model call behind "write it for me".
 *
 * Follows the pattern already proven in `src/lib/intake/read-document.ts`: forced
 * tool use so there is exactly one response shape, an explicit workspace header,
 * a hard timeout, and failures classified into "our setup is wrong" versus "that
 * call went badly". The comments there explain why each of those exists; they
 * were all learned the expensive way and are not re-argued here.
 *
 * THE ONE RULE THAT MATTERS: this never fails closed. `ANTHROPIC_API_KEY` is
 * optional in this app, the account can be out of credit on a Tuesday, and the
 * dealer is mid-way through building their website either way. Every failure
 * path returns `draftAbout()` — the deterministic copy built from the same
 * answers — and says so, rather than showing an error where the text should be.
 */

import 'server-only';
import {
  draftAbout,
  factsForPrompt,
  sanitiseDraft,
  writerPrompt,
  type AboutContext,
  type AboutFacts,
} from './about';

const MODEL = process.env.ABOUT_MODEL || 'claude-sonnet-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID;
const TIMEOUT_MS = 30_000;

/**
 * Sonnet rather than Haiku, unlike the document reader.
 *
 * There the cheap model is defended by a VIN check digit, so a weak read is
 * caught and escalated. Here there is no check digit — the only reviewer is a
 * dealer who will accept whatever appears in the box, and the output goes on
 * their website under their name. It is also one call per dealer per lifetime,
 * not one per vehicle, so the cost argument that drives the reader's choice
 * simply does not apply.
 */

const WRITE_TOOL = {
  name: 'write_about_section',
  description: 'Write the About section for this dealership using only the supplied facts.',
  input_schema: {
    type: 'object',
    properties: {
      about: {
        type: 'string',
        description:
          'Two or three short paragraphs, plain text, separated by blank lines. Under 180 words.',
      },
    },
    required: ['about'],
  },
} as const;

export type WrittenAbout = {
  text: string;
  /** How it was produced, so the screen can be honest about it. */
  source: 'model' | 'template';
  /**
   * Why the model was not used, when it was not. Shown to the dealer only when
   * it is something they can act on; a missing key is our problem, not theirs.
   */
  note?: string;
};

export async function writeAbout(facts: AboutFacts, ctx: AboutContext): Promise<WrittenAbout> {
  const fallback = () => draftAbout(facts, ctx);

  if (!process.env.ANTHROPIC_API_KEY) {
    return { text: fallback(), source: 'template' };
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        ...(WORKSPACE_ID ? { 'anthropic-workspace-id': WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: writerPrompt(ctx),
        tools: [WRITE_TOOL],
        tool_choice: { type: 'tool', name: WRITE_TOOL.name },
        messages: [{ role: 'user', content: factsForPrompt(facts) }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('about-writer: anthropic %d %s', res.status, body.slice(0, 300));
      return { text: fallback(), source: 'template' };
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    };
    const block = json.content?.find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL.name);
    const raw = typeof block?.input?.about === 'string' ? block.input.about : '';
    const clean = sanitiseDraft(raw);
    if (!clean) {
      console.error('about-writer: unusable output (%d chars)', raw.length);
      return { text: fallback(), source: 'template' };
    }
    return { text: clean, source: 'model' };
  } catch (err) {
    /* A timeout is the common one, and it is not worth a different message to
       the dealer: they get working copy either way and can press the button
       again if they want to try for something better. */
    console.error('about-writer:', err);
    return { text: fallback(), source: 'template' };
  }
}
