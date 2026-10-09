import { BlockList, isIP } from 'node:net';

/**
 * Address ranges where many people share one public IP, such as a school
 * behind NAT (ADR-149). Their per-IP rate limits are multiplied; limits per
 * account or token stay as they are.
 */
export function parseSharedNetworks(values: string[]): BlockList {
  const networks = new BlockList();
  for (const value of values) {
    const [address, prefixText, extra] = value.split('/');
    const family = isIP(address);
    const prefix = Number(prefixText);
    const maxPrefix = family === 6 ? 128 : 32;
    if (
      !family ||
      extra !== undefined ||
      !/^\d{1,3}$/.test(prefixText ?? '') ||
      prefix > maxPrefix ||
      // A range wider than /8 (IPv4) or /32 (IPv6) is a typo, not a network.
      prefix < (family === 6 ? 32 : 8)
    ) {
      throw new Error(
        `INITPAD_RATE_LIMIT_SHARED_NETWORKS contains an invalid CIDR range: '${value}'`,
      );
    }
    networks.addSubnet(address, prefix, family === 6 ? 'ipv6' : 'ipv4');
  }
  return networks;
}

export function inSharedNetwork(networks: BlockList, ip: string): boolean {
  // Express reports IPv4 clients on a dual-stack socket as ::ffff:a.b.c.d.
  const address = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(address);
  if (!family) return false;
  return networks.check(address, family === 6 ? 'ipv6' : 'ipv4');
}
