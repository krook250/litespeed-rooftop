/**
 * What an ad's Meta `effective_status` means to the dealer.
 *
 * Before this, everything that was not ACTIVE read as "Off", so an ad Facebook
 * had rejected looked exactly like one somebody paused, and the only way anyone
 * found out was Meta's own email. A rejection has to say so, and say why.
 *
 * Kept free of server imports so client components can use it.
 */
export type AdState = 'running' | 'rejected' | 'review' | 'issues' | 'off';

export function adState(effectiveStatus: string): AdState {
  switch (effectiveStatus) {
    case 'ACTIVE':
      return 'running';
    case 'DISAPPROVED':
      return 'rejected';
    case 'PENDING_REVIEW':
    case 'IN_PROCESS':
      return 'review';
    case 'WITH_ISSUES':
      return 'issues';
    default:
      return 'off';
  }
}

export const AD_STATE_LABEL: Record<AdState, string> = {
  running: 'Running',
  rejected: 'Rejected by Facebook',
  review: 'Facebook is reviewing it',
  issues: 'Facebook flagged a problem',
  off: 'Off',
};
