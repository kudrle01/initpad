import { brand, LOGO_CID } from './brand';

/**
 * Everything a transactional message says, as plain text. The layout is the
 * only place that turns it into HTML and escapes every value on the way, so a
 * template can never inject markup – user-chosen names included.
 */
export interface MailContent {
  /** Inbox preview line shown after the subject; hidden in the body. */
  preheader: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  /** Optional label/value facts shown in a highlighted panel. */
  details?: Array<{ label: string; value: string }>;
  action: { label: string; url: string };
  /** Expiry and "ignore this message" guidance under the button. */
  note: string;
}

export interface RenderedBody {
  text: string;
  html: string;
}

const { light, dark } = brand;
const FONT = brand.fontStack;

export function renderMail(content: MailContent): RenderedBody {
  return { text: renderText(content), html: renderHtml(content) };
}

function renderText(content: MailContent): string {
  const details = content.details?.length
    ? content.details.map((row) => `${row.label}: ${row.value}`).join('\n') + '\n\n'
    : '';
  return (
    `${content.greeting}\n\n` +
    content.paragraphs.map((paragraph) => `${paragraph}\n\n`).join('') +
    details +
    `${content.action.label}:\n${content.action.url}\n\n` +
    `${content.note}\n\n` +
    '-- \nInitPad\n'
  );
}

function renderHtml(content: MailContent): string {
  const heading = escapeHtml(content.heading);
  const paragraphs = content.paragraphs
    .map((paragraph) => textBlock(escapeHtml(paragraph), 'ip-ink', light.ink, '0 0 16px'))
    .join('');
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${heading}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
@media (max-width: 620px) {
  .ip-outer { padding: 16px 8px !important; }
  .ip-card { padding: 28px 24px !important; }
  .ip-heading { font-size: 20px !important; line-height: 28px !important; }
}
@media (prefers-color-scheme: dark) {
${darkRules('', '  ')}
}
${darkRules('[data-ogsc] ', '')}
</style>
</head>
<body class="ip-canvas" style="margin:0;padding:0;background-color:${light.canvas};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${light.canvas};">${escapeHtml(content.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ip-canvas" style="background-color:${light.canvas};">
<tr><td align="center" class="ip-outer" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="cid:${LOGO_CID}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;"></td>
<td class="ip-ink" style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:19px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${light.ink};">InitPad</td>
</tr></table>
</td></tr>
<tr>${cardOpen()}
<h1 class="ip-ink ip-heading" style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:${light.ink};">${heading}</h1>
${textBlock(escapeHtml(content.greeting), 'ip-ink', light.ink, '0 0 16px')}
${paragraphs}
${detailsPanel(content.details)}
${button(content.action.label, content.action.url)}
${textBlock('If the button does not work, copy this link into your browser:', 'ip-muted', light.muted, '0 0 6px', 13, 20)}
<p style="margin:0 0 28px;font-family:${brand.monoStack};font-size:12px;line-height:18px;word-break:break-all;"><a class="ip-link" href="${escapeHtml(content.action.url)}" target="_blank" rel="noopener" style="color:${light.primary};text-decoration:underline;">${escapeHtml(content.action.url)}</a></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ip-rule" style="border-top:1px solid ${light.border};font-size:0;line-height:0;height:20px;">&nbsp;</td></tr></table>
${textBlock(escapeHtml(content.note), 'ip-muted', light.muted, '0', 13, 20)}
${cardClose()}</tr>
<tr><td align="center" class="ip-muted" style="padding:20px 16px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${light.muted};">This is an automated message from InitPad.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

/**
 * The white card. Desktop Outlook renders with Word, which ignores
 * border-radius, so it gets the card as a rounded VML shape that grows with
 * its content; every other client gets the styled table cell. 560px is 420pt
 * and 40px padding 30pt; arcsize is relative to the shorter side, so 4% of a
 * typical ~480px tall card is the same ~20px radius as elsewhere.
 */
function cardOpen(): string {
  return (
    `<!--[if mso]><td style="padding:0;"><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" arcsize="4%" fillcolor="${light.card}" strokecolor="${light.border}" strokeweight="0.75pt" style="width:420pt;"><v:textbox inset="30pt,30pt,30pt,30pt" style="mso-fit-shape-to-text:true;"><div><![endif]-->` +
    `<!--[if !mso]><!-- --><td class="ip-card" style="background-color:${light.card};border:1px solid ${light.border};border-radius:20px;padding:40px;"><!--<![endif]-->`
  );
}

function cardClose(): string {
  return '<!--[if mso]></div></v:textbox></v:roundrect><![endif]--></td>';
}

/**
 * Dark-theme overrides. Apple Mail and other WebKit clients honour the media
 * query; Outlook.com marks its own dark mode with [data-ogsc]. Gmail ignores
 * both and inverts colours itself, which the light palette survives.
 */
function darkRules(selectorPrefix: string, indent: string): string {
  const rules: Array<[string, string]> = [
    ['.ip-canvas', `background-color: ${dark.canvas} !important;`],
    [
      '.ip-card',
      `background-color: ${dark.card} !important; border-color: ${dark.border} !important;`,
    ],
    ['.ip-ink', `color: ${dark.ink} !important;`],
    ['.ip-muted', `color: ${dark.muted} !important;`],
    ['.ip-rule', `border-color: ${dark.border} !important;`],
    ['.ip-panel', `background-color: ${dark.secondary} !important;`],
    ['.ip-link', `color: ${dark.primary} !important;`],
    ['.ip-button-cell', `background-color: ${dark.primary} !important;`],
    [
      '.ip-button',
      `background-color: ${dark.primary} !important; color: ${dark.primaryInk} !important;`,
    ],
  ];
  return rules
    .map(([selector, body]) => `${indent}${selectorPrefix}${selector} { ${body} }`)
    .join('\n');
}

function textBlock(
  html: string,
  className: string,
  color: string,
  margin: string,
  size = 15,
  lineHeight = 24,
): string {
  return `<p class="${className}" style="margin:${margin};font-family:${FONT};font-size:${size}px;line-height:${lineHeight}px;color:${color};">${html}</p>`;
}

function detailsPanel(details: MailContent['details']): string {
  if (!details?.length) return '';
  const rows = details
    .map(
      (row, index) =>
        `<tr><td class="ip-muted" style="padding:${index ? 8 : 0}px 16px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${light.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(row.label)}</td>` +
        `<td class="ip-ink" style="padding:${index ? 8 : 0}px 0 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${light.ink};word-break:break-word;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;"><tr>` +
    `<td class="ip-panel" style="background-color:${light.secondary};border-radius:12px;padding:16px 20px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table>` +
    `</td></tr></table>`
  );
}

/**
 * A "bulletproof" button: a rounded VML shape for desktop Outlook, whose Word
 * engine ignores padding on links, and a padded link in every other client.
 */
function button(label: string, url: string): string {
  const href = escapeHtml(url);
  const text = escapeHtml(label);
  const width = Math.max(180, label.length * 9 + 64);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;"><tr>` +
    `<td class="ip-button-cell" align="center" bgcolor="${light.primary}" style="border-radius:12px;background-color:${light.primary};">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="25%" stroke="f" fillcolor="${light.primary}"><w:anchorlock/><center style="color:${light.primaryInk};font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;">${text}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!-- --><a class="ip-button" href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${light.primaryInk};text-decoration:none;border-radius:12px;background-color:${light.primary};">${text}</a><!--<![endif]-->` +
    `</td></tr></table>`
  );
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}
