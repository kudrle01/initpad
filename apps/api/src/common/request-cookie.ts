export function readStringCookie(request: { cookies?: unknown }, name: string): string | undefined {
  const cookies = request.cookies;
  if (!cookies || typeof cookies !== 'object' || Array.isArray(cookies)) return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}
