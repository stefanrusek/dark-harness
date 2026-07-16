// DH-0074 (tracking/DH-0074-*.md, architect design Fable 2026-07-16): shared SSRF/host
// filtering primitives for WebFetch (private-address rejection, `allowedHosts`) and
// WebSearch (`allowed_domains`/`blocked_domains` post-filters) — both use the same
// dot-suffix host-matching rule, so it lives here once rather than duplicated per tool.

/** Parses an IPv4 dotted-quad string into four octets, or returns null if it isn't one. */
function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** IPv4 ranges considered private/non-routable-from-the-public-internet for SSRF purposes:
 * 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8 (loopback), 169.254/16 (link-local/cloud
 * metadata), 172.16/12, 192.168/16, 198.18/15 (benchmarking). */
function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

/**
 * Returns true if `address` (a literal IP, v4 or v6) falls in a private/loopback/link-local/
 * CGNAT/benchmarking range and should be rejected by WebFetch's default SSRF check. Pure and
 * synchronous — callers resolve hostnames to addresses first (via DNS or by recognizing a
 * literal IP hostname) and check each resolved address with this function.
 */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = parseIPv4(address);
  if (ipv4) return isPrivateIPv4(ipv4);

  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4 address against the same
  // ranges above.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped?.[1]) {
    const embedded = parseIPv4(mapped[1]);
    if (embedded) return isPrivateIPv4(embedded);
  }
  // fc00::/7 (unique local) — first 7 bits are 1111 110, i.e. the first hextet is fc00-fdff.
  const firstHextetMatch = /^([0-9a-f]{1,4})/.exec(lower);
  if (firstHextetMatch?.[1]) {
    const firstHextet = Number.parseInt(firstHextetMatch[1], 16);
    if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true;
    // fe80::/10 (link-local) — first 10 bits 1111111010, i.e. fe80-febf.
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true;
  }
  return false;
}

/**
 * Dot-suffix host matching used by `web.fetch.allowedHosts` and WebSearch's
 * `allowed_domains`/`blocked_domains` post-filters: `pattern` matches `host` exactly, or
 * matches when `host` ends with `.` + `pattern` (so `example.com` matches `docs.example.com`
 * but not `notexample.com`). Case-insensitive.
 */
export function hostMatchesSuffix(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}
