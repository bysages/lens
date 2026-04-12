import {
  ipInRange,
  isIPv4,
  isIPv6,
  isLoopbackIPv4,
  isLoopbackIPv6,
  isMulticastIPv4,
  isMulticastIPv6,
  isPrivateIPv4,
  isPrivateIPv6,
  isValidIP,
} from "ipdo";
import { HTTPError } from "nitro/h3";

/**
 * Blocked CIDR ranges that ipdo's individual checks don't fully cover.
 * - 0.0.0.0/8  : "this network" (includes 0.0.0.0 which binds to all interfaces)
 * - 169.254.0.0/16 : link-local (cloud metadata endpoint 169.254.169.254)
 * - fc00::/7  : IPv6 Unique Local Addresses (ULA)
 * - fe80::/10 : IPv6 link-local
 */
const BLOCKED_RANGES_v4 = ["0.0.0.0/8", "169.254.0.0/16"] as const;
const BLOCKED_RANGES_v6 = ["fc00::/7", "fe80::/10"] as const;

function isBlockedIPv4(ip: string): boolean {
  return (
    isPrivateIPv4(ip) ||
    isLoopbackIPv4(ip) ||
    isMulticastIPv4(ip) ||
    BLOCKED_RANGES_v4.some((cidr) => ipInRange(cidr, ip))
  );
}

function isBlockedIPv6(ip: string): boolean {
  return (
    isPrivateIPv6(ip) ||
    isLoopbackIPv6(ip) ||
    isMulticastIPv6(ip) ||
    BLOCKED_RANGES_v6.some((cidr) => ipInRange(cidr, ip))
  );
}

/**
 * Assert that a URL does not point to a private, loopback, link-local,
 * multicast, or metadata IP address.
 *
 * Hostnames (non-IP) are allowed through — DNS resolution is handled
 * by the runtime and is outside the scope of this check.
 *
 * @throws HTTPError 403 if the hostname resolves to a blocked IP range.
 */
export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HTTPError({ status: 400, message: "Invalid URL" });
  }

  const hostname = parsed.hostname;
  if (!isValidIP(hostname)) return;

  if (isIPv4(hostname) && isBlockedIPv4(hostname)) {
    throw new HTTPError({ status: 403, message: "URL points to a private or reserved IP address" });
  }

  if (isIPv6(hostname) && isBlockedIPv6(hostname)) {
    throw new HTTPError({ status: 403, message: "URL points to a private or reserved IP address" });
  }
}
