// The tab keeps an invitation token while the invitee signs in, because the
// invitation page drops the fragment from the address bar (ADR-143, ADR-188).
// It never reaches a URL query. GitHub sign-in returns to "/", so the signed-in
// shell sends the user back to the invitation.
const PENDING_KEY = 'initpad.pendingInvitation';

export function pendingInvitation(): string {
  try {
    return sessionStorage.getItem(PENDING_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberInvitation(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(PENDING_KEY, token);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage the invitee opens the link again after signing in.
  }
}
