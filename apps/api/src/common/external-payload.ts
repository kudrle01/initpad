import { BadRequestException } from '@nestjs/common';

/**
 * Optional string fields of a payload whose shape InitPad does not own: CI
 * callbacks sent by workflows already committed to repositories and SCM
 * webhooks. Unknown fields stay allowed, so older or edited workflows keep
 * working, but a known field holding an object, array, number or an oversized
 * string is rejected before it reaches a database filter or string handling.
 */
export function stringFields<K extends string>(
  payload: unknown,
  maxLengths: Record<K, number>,
): Partial<Record<K, string>> {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BadRequestException('The request body must be a JSON object');
  }
  const fields: Partial<Record<K, string>> = {};
  for (const [name, maxLength] of Object.entries(maxLengths) as [K, number][]) {
    const value = (payload as Record<string, unknown>)[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.length > maxLength) {
      throw new BadRequestException(`${name} must be a string of at most ${maxLength} characters`);
    }
    fields[name] = value;
  }
  return fields;
}
