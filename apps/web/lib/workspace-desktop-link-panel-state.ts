import type {
  WorkspaceDesktopLinkIssue,
  WorkspaceDesktopLinkIssueResult,
} from './workspace-desktop-link-client';

export type WorkspaceDesktopLinkPanelTone =
  | 'neutral'
  | 'ready'
  | 'warning';

export interface WorkspaceDesktopLinkPanelView {
  readonly heading: string;
  readonly description: string;
  readonly badge: string;
  readonly tone: WorkspaceDesktopLinkPanelTone;
  readonly exchange: WorkspaceDesktopLinkIssue | null;
}

function view(
  heading: string,
  description: string,
  badge: string,
  tone: WorkspaceDesktopLinkPanelTone,
  exchange: WorkspaceDesktopLinkIssue | null = null,
): WorkspaceDesktopLinkPanelView {
  return Object.freeze({
    heading,
    description,
    badge,
    tone,
    exchange,
  });
}

export function workspaceDesktopLinkSelectionRequiredView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Select a workspace to link a desktop',
    'Desktop linking stays disabled until you explicitly choose an authenticated organization membership.',
    'No workspace selected',
    'neutral',
  );
}

export function workspaceDesktopLinkIdleView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Link a desktop',
    'Enter the identifier shown by the approved desktop client. The one-time exchange token is kept only in this page state.',
    'Ready to issue',
    'neutral',
  );
}

export function workspaceDesktopLinkIssuingView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Issuing one-time exchange',
    'Creating a short-lived tenant-bound exchange for the selected desktop.',
    'Issuing',
    'neutral',
  );
}

export function workspaceDesktopLinkCancelledView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Desktop link cancelled',
    'The pending one-time exchange was revoked and its exchange ID and token have been cleared from this page.',
    'Cancelled',
    'neutral',
  );
}

export function workspaceDesktopLinkCancelUnavailableView(
  exchange: WorkspaceDesktopLinkIssue,
): WorkspaceDesktopLinkPanelView {
  return view(
    'Cancellation not confirmed',
    'The revoke request could not be confirmed. This one-time exchange remains active until it is consumed, revoked, or expires automatically.',
    'Cancel not confirmed',
    'warning',
    exchange,
  );
}

export function workspaceDesktopLinkLinkedView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Desktop linked',
    'The approved desktop consumed the one-time exchange. The exchange ID and token have been cleared from this page.',
    'Linked',
    'ready',
  );
}

export function workspaceDesktopLinkUnavailableView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Desktop link unavailable',
    'The link status could not be verified safely. The one-time exchange has been cleared from this page.',
    'Unavailable',
    'warning',
  );
}

export function workspaceDesktopLinkExpiredView():
WorkspaceDesktopLinkPanelView {
  return view(
    'Desktop link expired',
    'The one-time exchange expired and has been cleared from this page. Create a new exchange if you still need to link this desktop.',
    'Expired',
    'warning',
  );
}

export function workspaceDesktopLinkPanelView(
  result: WorkspaceDesktopLinkIssueResult,
): WorkspaceDesktopLinkPanelView {
  switch (result.status) {
    case 'ready':
      return view(
        'Desktop link ready',
        'Use the exchange ID and one-time token together in the approved desktop client before they expire. Changing workspace or device input clears them from this page.',
        'One-time exchange',
        'ready',
        result.data,
      );
    case 'invalid_input':
      return view(
        'Check the device identifier',
        'Enter the non-empty device identifier shown by the approved desktop client.',
        'Invalid input',
        'warning',
      );
    case 'authentication_required':
      return view(
        'Authentication required',
        'Sign in through the approved workspace identity flow before linking a desktop.',
        'Signed out',
        'warning',
      );
    case 'forbidden':
      return view(
        'Desktop linking unavailable',
        'Your current workspace membership does not permit desktop linking.',
        'Restricted',
        'warning',
      );
    case 'invalid_response':
    case 'unavailable':
      return view(
        'Desktop link unavailable',
        'A safe one-time exchange could not be issued. No unverified exchange data is shown.',
        'Unavailable',
        'warning',
      );
  }
}
