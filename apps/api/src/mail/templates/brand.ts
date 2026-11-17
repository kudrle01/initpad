/**
 * InitPad brand tokens for e-mail, taken from the web app's light and dark
 * themes (apps/web/src/index.css). Mail clients do not support CSS variables,
 * so the values are plain hex colours inlined into every template.
 */
export const brand = {
  light: {
    canvas: '#f0f2f5',
    card: '#ffffff',
    ink: '#111b21',
    muted: '#5b6c76',
    border: '#e3e8eb',
    primary: '#075e54',
    primaryInk: '#ffffff',
    secondary: '#e7f8f0',
  },
  dark: {
    canvas: '#0b141a',
    card: '#1f2c34',
    ink: '#e9edef',
    muted: '#94a4ae',
    border: '#2a3942',
    primary: '#00a884',
    primaryInk: '#111b21',
    secondary: '#12332a',
  },
  fontStack:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monoStack: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/** Content-ID of the inline logo attachment referenced as `cid:` in the HTML. */
export const LOGO_CID = 'initpad-logo@initpad';

/**
 * apps/web/public/brand/initpad-tile-96.png – the white mark on the brand-green
 * rounded tile (the app icon), so the logo stays legible on light and dark
 * backgrounds alike, including clients that apply their own dark mode and
 * cannot swap images. Regenerate it from the maskable icon with:
 *   magick initpad-maskable-512.png -gravity center -crop 368x368+0+0 +repage \
 *     -resize 96x96 \( -size 96x96 xc:none -fill white \
 *     -draw "roundrectangle 0,0,95,95,22,22" \) -alpha set -compose DstIn \
 *     -composite -strip initpad-tile-96.png
 *
 * It is embedded so the API image does not need the web assets at runtime, and
 * travels as an inline (CID) attachment: remote images are blocked by default
 * in many clients and a self-hosted platform URL may not be reachable from the
 * recipient's network. A spec keeps this copy byte-identical to the web asset.
 */
export const LOGO_PNG_BASE64 =
  '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';
