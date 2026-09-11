import dns from "node:dns/promises";

import { HTTPError } from "nitro/h3";

// ── IP parsing ─────────────────────────────────────────
// Self-contained on purpose: the ipdo helpers this used to rely on have
// signed-integer and range bugs for addresses >= 128.0.0.0 and for
// fd00::/8, which silently defeated the metadata and ULA blocks.

function parseIPv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes as [number, number, number, number];
}

function parseIPv6(input: string): bigint | null {
  if (!input.includes(":")) return null;

  // IPv4-mapped tail (::ffff:192.168.0.1) becomes two hex groups
  let text = input;
  const v4Tail = input.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const bytes = parseIPv4(v4Tail[2]!);
    if (!bytes) return null;
    const g1 = (bytes[0]! << 8) | bytes[1]!;
    const g2 = (bytes[2]! << 8) | bytes[3]!;
    text = `${v4Tail[1]}${g1.toString(16)}:${g2.toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [...head, ...Array<number>(Math.max(missing, 0)).fill(0).map(String), ...tail];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

export function isValidIP(ip: string): boolean {
  return parseIPv4(ip) !== null || parseIPv6(ip) !== null;
}

// ── Blocked ranges ─────────────────────────────────────

function ipv4BlockedBytes(bytes: [number, number, number, number]): boolean {
  const [a, b] = bytes;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 100 && b === 64) return true; // 100.64/10 carrier-grade NAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a >= 224) return true; // multicast (224-239) and reserved (240-255)
  return false;
}

function isBlockedIPv4(ip: string): boolean {
  const bytes = parseIPv4(ip);
  return bytes !== null && ipv4BlockedBytes(bytes);
}

function isBlockedIPv6(ip: string): boolean {
  const value = parseIPv6(ip);
  if (value === null) return true; // unparseable — fail closed
  if (value === 0n) return true; // unspecified ::
  if (value === 1n) return true; // loopback ::1
  if (value >> 120n === 0xffn) return true; // multicast ff00::/8
  if (value >> 121n === 0x7en) return true; // unique local fc00::/7
  if (value >> 118n === 0x3fan) return true; // link-local fe80::/10
  // IPv4-mapped ::ffff:0:0/96 — apply the IPv4 rules to the embedded address
  if (value >> 96n === 0n && ((value >> 32n) & 0xffffn) === 0xffffn) {
    const a = Number((value >> 24n) & 0xffn);
    const b = Number((value >> 16n) & 0xffn);
    const c = Number((value >> 8n) & 0xffn);
    const d = Number(value & 0xffn);
    if (ipv4BlockedBytes([a, b, c, d])) return true;
  }
  return false;
}

function assertAllowedIP(ip: string): void {
  if (parseIPv4(ip) !== null && isBlockedIPv4(ip)) {
    throw new HTTPError({ status: 403, message: "URL points to a private or reserved IP address" });
  }
  if (parseIPv4(ip) === null && isBlockedIPv6(ip)) {
    throw new HTTPError({ status: 403, message: "URL points to a private or reserved IP address" });
  }
}

/**
 * Assert that a URL does not point at a private, loopback, link-local,
 * multicast, or metadata address. Hostnames are resolved and every address
 * they map to is checked (a hostname resolving only to blocked ranges is
 * rejected). Resolution is not atomic with the actual connection — the
 * browser-level `--block-private-networks` flag covers that gap for
 * browser routes.
 *
 * @throws HTTPError 400/403 when the URL is malformed or unsafe.
 */
export async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HTTPError({ status: 400, message: "Invalid URL" });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HTTPError({ status: 400, message: "Only http and https URLs are supported" });
  }

  // URL.hostname keeps the brackets for IPv6 literals ([::1]); the IP
  // parser and dns.lookup both want the bare address
  const hostname = parsed.hostname.replace(/^\[(.+)\]$/, "$1");
  if (!isValidIP(hostname)) {
    let addresses: Array<{ address: string }>;
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      throw new HTTPError({ status: 400, message: "URL hostname could not be resolved" });
    }
    for (const { address } of addresses) {
      assertAllowedIP(address);
    }
    return;
  }

  assertAllowedIP(hostname);
}

/**
 * fetch() wrapper for URLs derived from remote content (manifest icons, HTML
 * attributes): validates every redirect hop against the private-network
 * check. Returns null on any failure instead of throwing.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  const MAX_REDIRECTS = 3;
  let target = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertSafeUrl(target);
    } catch {
      return null;
    }

    const response = await fetch(target, { ...init, redirect: "manual" }).catch(() => null);
    if (!response) return null;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      try {
        target = new URL(location, target).href;
      } catch {
        return null;
      }
      continue;
    }

    return response;
  }

  return null;
}

/**
 * Prefix scheme-less user input (e.g. "example.com/page") with https:// and
 * reject non-web schemes instead of misreading them as hostnames.
 */
export function normalizeInputUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.includes("://")) {
    throw new HTTPError({ status: 400, message: "Only http and https URLs are supported" });
  }
  return `https://${input}`;
}

/** Hostname of a URL string, or null when it does not parse as a URL. */
export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
