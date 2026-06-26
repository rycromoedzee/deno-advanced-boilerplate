import { assert, assertEquals, assertFalse } from "@std/assert";
import { IPValidationUtils } from "@utils/network/ip-validation.ts";
import { IPLookupUtils } from "@utils/network/ip-lookup.ts";

/**
 * IP utilities surface — `IPValidationUtils` (validation / CIDR matching, IPv4
 * and IPv6) plus `IPLookupUtils.anonymizeIP` (the live privacy helper). The two
 * classes are intentionally separate: pure IP/CIDR logic vs. the broader
 * Hono-aware request-extraction class; only the pure, testable methods are here.
 */

Deno.test("IPValidationUtils.isValidIP: accepts valid IPv4 addresses", () => {
  assertTrue(IPValidationUtils.isValidIP("0.0.0.0"));
  assertTrue(IPValidationUtils.isValidIP("127.0.0.1"));
  assertTrue(IPValidationUtils.isValidIP("192.168.1.1"));
  assertTrue(IPValidationUtils.isValidIP("255.255.255.255"));
  assertTrue(IPValidationUtils.isValidIP("8.8.8.8"));
});

Deno.test("IPValidationUtils.isValidIP: rejects invalid IPv4 (out-of-range octets / wrong shape)", () => {
  assertFalse(IPValidationUtils.isValidIP("256.0.0.1")); // octet > 255
  assertFalse(IPValidationUtils.isValidIP("1.2.3")); // too few octets
  assertFalse(IPValidationUtils.isValidIP("1.2.3.4.5")); // too many octets
  assertFalse(IPValidationUtils.isValidIP("abc.def.ghi.jkl"));
  assertFalse(IPValidationUtils.isValidIP(""));
  assertFalse(IPValidationUtils.isValidIP("..."));
});

Deno.test("IPValidationUtils.isValidIP: accepts valid IPv6 addresses", () => {
  assertTrue(IPValidationUtils.isValidIP("::1")); // loopback compressed
  assertTrue(IPValidationUtils.isValidIP("::")); // unspecified
  assertTrue(IPValidationUtils.isValidIP("2001:db8::1"));
  assertTrue(IPValidationUtils.isValidIP("fe80::1"));
  assertTrue(IPValidationUtils.isValidIP("2001:0db8:85a3:0000:0000:8a2e:0370:7334")); // full form
});

Deno.test("IPValidationUtils.isValidIP: rejects malformed IPv6", () => {
  assertFalse(IPValidationUtils.isValidIP("gggg::1")); // non-hex
  assertFalse(IPValidationUtils.isValidIP("2001:db8:::1")); // triple colon
});

Deno.test("IPValidationUtils.isPrivateIP: RFC1918 + loopback + link-local are private", () => {
  assertTrue(IPValidationUtils.isPrivateIP("10.0.0.1")); // 10/8
  assertTrue(IPValidationUtils.isPrivateIP("10.255.255.255"));
  assertTrue(IPValidationUtils.isPrivateIP("192.168.0.1")); // 192.168/16
  assertTrue(IPValidationUtils.isPrivateIP("192.168.50.50"));
  assertTrue(IPValidationUtils.isPrivateIP("172.16.0.1")); // 172.16/12 start
  assertTrue(IPValidationUtils.isPrivateIP("172.31.255.255")); // 172.16/12 end
  assertTrue(IPValidationUtils.isPrivateIP("127.0.0.1")); // loopback
  assertTrue(IPValidationUtils.isPrivateIP("127.1.2.3"));
  assertTrue(IPValidationUtils.isPrivateIP("169.254.0.1")); // link-local
});

Deno.test("IPValidationUtils.isPrivateIP: 172.32.x is NOT private (boundary just past /12)", () => {
  assertFalse(IPValidationUtils.isPrivateIP("172.32.0.1"));
  assertFalse(IPValidationUtils.isPrivateIP("172.15.0.1")); // just below
  assertFalse(IPValidationUtils.isPrivateIP("172.0.0.1"));
});

Deno.test("IPValidationUtils.isPrivateIP: public IPs are NOT private", () => {
  assertFalse(IPValidationUtils.isPrivateIP("8.8.8.8"));
  assertFalse(IPValidationUtils.isPrivateIP("1.1.1.1"));
  assertFalse(IPValidationUtils.isPrivateIP("203.0.113.5"));
});

Deno.test("IPValidationUtils.isPrivateIP: multicast (224/4) and reserved (240/4) are private/non-routable", () => {
  assertTrue(IPValidationUtils.isPrivateIP("224.0.0.1")); // multicast
  assertTrue(IPValidationUtils.isPrivateIP("240.0.0.1")); // reserved
});

Deno.test("IPValidationUtils.isPrivateIP: IPv6 loopback/link-local/ULA/multicast/unspecified are private", () => {
  assertTrue(IPValidationUtils.isPrivateIP("::1")); // loopback
  assertTrue(IPValidationUtils.isPrivateIP("::")); // unspecified
  assertTrue(IPValidationUtils.isPrivateIP("fe80::1")); // link-local
  assertTrue(IPValidationUtils.isPrivateIP("fc00::1")); // ULA fc00
  assertTrue(IPValidationUtils.isPrivateIP("fd00::1")); // ULA fd00
  assertTrue(IPValidationUtils.isPrivateIP("ff00::1")); // multicast
});

Deno.test("IPValidationUtils.isPrivateIP: a public IPv6 is NOT private", () => {
  assertFalse(IPValidationUtils.isPrivateIP("2606:4700:4700::1111")); // Cloudflare DNS, public
});

Deno.test("IPValidationUtils.ipToNumber: converts dotted-quad to its (signed) 32-bit number", () => {
  // NOTE: the implementation uses bitwise OR on `<<`, which yields a SIGNED
  // 32-bit int in JS. So 255.255.255.255 (0xFFFFFFFF) wraps to -1, and high-
  // octet values >= 128 come out negative. This matches how CIDR masking uses
  // the result, so we assert the signed behaviour here.
  assertEquals(IPValidationUtils.ipToNumber("0.0.0.0"), 0);
  assertEquals(IPValidationUtils.ipToNumber("0.0.0.1"), 1);
  assertEquals(IPValidationUtils.ipToNumber("1.0.0.0"), 16777216); // 1 << 24 (positive, < 2^31)
  assertEquals(IPValidationUtils.ipToNumber("255.255.255.255"), -1); // 0xFFFFFFFF as signed int32
  assertEquals(IPValidationUtils.ipToNumber("127.0.0.1"), 2130706433); // 0x7F000001 (positive)
  // 192.168.1.1 → 0xC0A80101 → signed -1062731519
  assertEquals(IPValidationUtils.ipToNumber("192.168.1.1"), -1062731519);
});

Deno.test("IPValidationUtils.ipToNumber: throws on invalid IP", () => {
  assertThrows(() => IPValidationUtils.ipToNumber("256.0.0.1"));
  assertThrows(() => IPValidationUtils.ipToNumber("not-an-ip"));
});

Deno.test("IPValidationUtils.matchesAnyCIDR: matches when IP is inside one of the CIDRs", () => {
  assertTrue(IPValidationUtils.matchesAnyCIDR("192.168.1.5", ["10.0.0.0/8", "192.168.0.0/16"]));
  assertTrue(IPValidationUtils.matchesAnyCIDR("10.1.2.3", ["10.0.0.0/8"]));
  assertTrue(IPValidationUtils.matchesAnyCIDR("8.8.8.8", ["8.8.8.0/24", "1.2.3.0/24"]));
});

Deno.test("IPValidationUtils.matchesAnyCIDR: false when IP is not in any CIDR", () => {
  assertFalse(IPValidationUtils.matchesAnyCIDR("8.8.4.4", ["10.0.0.0/8", "192.168.0.0/16"]));
  assertFalse(IPValidationUtils.matchesAnyCIDR("1.2.3.4", [])); // empty list
});

Deno.test("IPValidationUtils.matchesAnyCIDR: returns false (not throws) for an invalid IP", () => {
  assertFalse(IPValidationUtils.matchesAnyCIDR("not-an-ip", ["10.0.0.0/8"]));
});

Deno.test("IPValidationUtils.matchesAnyCIDR: /32 matches exactly one address", () => {
  assertTrue(IPValidationUtils.matchesAnyCIDR("8.8.8.8", ["8.8.8.8/32"]));
  assertFalse(IPValidationUtils.matchesAnyCIDR("8.8.8.9", ["8.8.8.8/32"]));
});

Deno.test("IPValidationUtils.isValidCIDR: accepts valid CIDRs, rejects malformed ones", () => {
  assertTrue(IPValidationUtils.isValidCIDR("10.0.0.0/8"));
  assertTrue(IPValidationUtils.isValidCIDR("192.168.1.0/24"));
  assertTrue(IPValidationUtils.isValidCIDR("8.8.8.8/32"));
  assertTrue(IPValidationUtils.isValidCIDR("0.0.0.0/0"));
  assertFalse(IPValidationUtils.isValidCIDR("10.0.0.0/33")); // prefix > 32
  assertFalse(IPValidationUtils.isValidCIDR("256.0.0.0/8")); // bad IP
  assertFalse(IPValidationUtils.isValidCIDR("10.0.0.0")); // no prefix
  assertFalse(IPValidationUtils.isValidCIDR("not-a-cidr/8"));
});

Deno.test("IPValidationUtils.isValidCIDR: accepts IPv6 CIDRs (prefix 0–128), rejects malformed", () => {
  assertTrue(IPValidationUtils.isValidCIDR("fe80::/10"));
  assertTrue(IPValidationUtils.isValidCIDR("::1/128"));
  assertTrue(IPValidationUtils.isValidCIDR("2001:db8::/32"));
  assertTrue(IPValidationUtils.isValidCIDR("::/0"));
  assertFalse(IPValidationUtils.isValidCIDR("gggg::/8")); // non-hex group
  assertFalse(IPValidationUtils.isValidCIDR("fe80::/200")); // prefix > 128
  assertFalse(IPValidationUtils.isValidCIDR("fe80::1")); // no prefix
});

Deno.test("IPValidationUtils.matchesAnyCIDR: matches IPv6 IPs against IPv6 CIDRs (128-bit)", () => {
  assertTrue(IPValidationUtils.matchesAnyCIDR("fe80::1", ["fe80::/10"]));
  assertTrue(IPValidationUtils.matchesAnyCIDR("::1", ["::1/128"]));
  assertTrue(IPValidationUtils.matchesAnyCIDR("2001:db8::1", ["2001:db8::/32"]));
  assertFalse(IPValidationUtils.matchesAnyCIDR("2606:4700::1", ["fe80::/10"])); // different range
  assertFalse(IPValidationUtils.matchesAnyCIDR("2001:db9::1", ["2001:db8::/32"])); // adjacent /32
});

Deno.test("IPValidationUtils.matchesAnyCIDR: cross-family never matches (IPv4 IP vs IPv6 CIDR and vice-versa)", () => {
  assertFalse(IPValidationUtils.matchesAnyCIDR("192.168.1.1", ["fe80::/10"]));
  assertFalse(IPValidationUtils.matchesAnyCIDR("fe80::1", ["192.168.0.0/16"]));
});

Deno.test("IPLookupUtils.anonymizeIP: zeroes the IPv4 last octet for log privacy", () => {
  assertEquals(IPLookupUtils.anonymizeIP("192.168.1.5"), "192.168.1.0");
  assertEquals(IPLookupUtils.anonymizeIP("10.20.30.255"), "10.20.30.0");
});

Deno.test("IPLookupUtils.anonymizeIP: zeroes the IPv6 interface ID (last 64 bits, full form)", () => {
  // Keep the first 4 hextets (the /64 network prefix), drop the interface ID.
  assertEquals(
    IPLookupUtils.anonymizeIP("2001:db8:85a3:1234:5678:9abc:def0:1234"),
    "2001:db8:85a3:1234::",
  );
});

Deno.test("IPLookupUtils.anonymizeIP: returns a fixed token for non-IP input", () => {
  assertEquals(IPLookupUtils.anonymizeIP("not-an-ip"), "anonymized");
});

function assertTrue(value: unknown, message?: string): void {
  assert(value, message ?? `expected truthy, got ${String(value)}`);
}

function assertThrows(fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch (_e) {
    threw = true;
  }
  assert(threw, "expected function to throw");
}
