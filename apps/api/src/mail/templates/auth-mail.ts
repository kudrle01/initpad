import {
  ACTIVATION_TTL_MS,
  EMAIL_VERIFY_TTL_MS,
  INVITATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  describeTtl,
} from '../../common/link-ttl';
import { renderMail, type MailContent } from './layout';

export type MailKind = 'email_verify' | 'password_reset' | 'activation' | 'workspace_invite';

export interface AuthMailPayload {
  displayName: string | null;
  url: string;
  workspaceName?: string | null;
  inviterName?: string | null;
  role?: string | null;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function renderAuthMail(kind: MailKind, payload: AuthMailPayload): RenderedMail {
  const { subject, content } = compose(kind, payload);
  return { subject, ...renderMail(content) };
}

function compose(
  kind: MailKind,
  payload: AuthMailPayload,
): { subject: string; content: MailContent } {
  const greeting = payload.displayName ? `Hello ${oneLine(payload.displayName)},` : 'Hello,';
  switch (kind) {
    case 'email_verify':
      return {
        subject: 'Verify your InitPad e-mail',
        content: {
          preheader: 'Confirm your address to finish creating your InitPad account.',
          heading: 'Confirm your e-mail address',
          greeting,
          paragraphs: [
            'Thanks for signing up for InitPad. Confirm that this address belongs to you to finish creating your account.',
          ],
          action: { label: 'Verify e-mail', url: payload.url },
          note:
            `The link works once and expires in ${describeTtl(EMAIL_VERIFY_TTL_MS)}. ` +
            'If you did not create an InitPad account, you can ignore this message.',
        },
      };
    case 'password_reset':
      return {
        subject: 'Reset your InitPad password',
        content: {
          preheader: 'Choose a new password for your InitPad account.',
          heading: 'Reset your password',
          greeting,
          paragraphs: [
            'We received a request to reset the password of your InitPad account. Use the button below to choose a new one.',
          ],
          action: { label: 'Reset password', url: payload.url },
          note:
            `The link works once and expires in ${describeTtl(PASSWORD_RESET_TTL_MS)}. ` +
            'If you did not request a reset, you can ignore this message – your password stays unchanged.',
        },
      };
    case 'activation':
      return {
        subject: 'Activate your InitPad account',
        content: {
          preheader: 'Set your password and sign in to InitPad.',
          heading: 'Activate your account',
          greeting,
          paragraphs: [
            'An InitPad account has been created for you. Activate it by choosing your password, and you will be signed in right away.',
          ],
          action: { label: 'Activate account', url: payload.url },
          note:
            `The link works once and expires in ${describeTtl(ACTIVATION_TTL_MS)}. ` +
            'If you did not expect this message, you can ignore it.',
        },
      };
    case 'workspace_invite':
      return composeInvitation(payload);
  }
}

function composeInvitation(payload: AuthMailPayload): { subject: string; content: MailContent } {
  // Names are user-chosen; a line break must never reach a mail header.
  const workspace = oneLine(payload.workspaceName) || 'a team workspace';
  const inviter = oneLine(payload.inviterName) || 'A workspace administrator';
  const role = oneLine(payload.role) || 'member';
  return {
    subject: `You are invited to ${workspace} on InitPad`,
    content: {
      preheader: `${inviter} invited you to join ${workspace} on InitPad.`,
      heading: 'You are invited to a workspace',
      greeting: 'Hello,',
      paragraphs: [`${inviter} invited you to join ${workspace} on InitPad as ${role}.`],
      details: [
        { label: 'Workspace', value: workspace },
        { label: 'Invited by', value: inviter },
        { label: 'Role', value: capitalize(role) },
      ],
      action: { label: 'Accept invitation', url: payload.url },
      note:
        `The invitation works once and expires in ${describeTtl(INVITATION_TTL_MS)}. ` +
        'If you did not expect it, you can ignore this message.',
    },
  };
}

function oneLine(value: string | null | undefined): string {
  return (value ?? '').replace(/[\r\n\0]+/g, ' ').trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
