import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestId } from './request-id';

afterEach(() => vi.unstubAllGlobals());

describe('createRequestId', () => {
  it('uses the native UUID implementation when available', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const randomUUID = vi.fn(() => id);
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: vi.fn() });

    expect(createRequestId()).toBe(id);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates a valid UUIDv4 from getRandomValues on an HTTP origin', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0xff, 0x77, 0xff, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
        0xff,
      ]);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(createRequestId()).toBe('00112233-4455-4f77-bf99-aabbccddeeff');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('fails closed when no cryptographic random source exists', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => createRequestId()).toThrow(/Secure random number generation/);
  });
});
