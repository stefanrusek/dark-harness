import { describe, expect, test } from "bun:test";
import { hostMatchesSuffix, isPrivateAddress } from "./net-guard.ts";

describe("isPrivateAddress", () => {
  test("rejects 0.0.0.0/8", () => {
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("0.255.255.255")).toBe(true);
  });

  test("rejects 10/8", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.255.255.255")).toBe(true);
  });

  test("rejects 100.64/10 (CGNAT)", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("100.127.255.255")).toBe(true);
    expect(isPrivateAddress("100.63.255.255")).toBe(false);
    expect(isPrivateAddress("100.128.0.0")).toBe(false);
  });

  test("rejects 127/8 (loopback)", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
  });

  test("rejects 169.254/16 (link-local / cloud metadata)", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });

  test("rejects 172.16/12", () => {
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("172.15.255.255")).toBe(false);
    expect(isPrivateAddress("172.32.0.0")).toBe(false);
  });

  test("rejects 192.168/16", () => {
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  test("rejects 198.18/15 (benchmarking)", () => {
    expect(isPrivateAddress("198.18.0.1")).toBe(true);
    expect(isPrivateAddress("198.19.255.255")).toBe(true);
    expect(isPrivateAddress("198.20.0.0")).toBe(false);
  });

  test("allows a public IPv4 address", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
  });

  test("rejects IPv6 unspecified and loopback", () => {
    expect(isPrivateAddress("::")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
  });

  test("rejects IPv6 unique-local (fc00::/7)", () => {
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456:789a::1")).toBe(true);
  });

  test("rejects IPv6 link-local (fe80::/10)", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });

  test("allows a public IPv6 address", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  test("rejects IPv4-mapped IPv6 addresses in a private range", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
  });

  test("allows IPv4-mapped IPv6 addresses in a public range", () => {
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  test("handles a malformed address gracefully (not privately matched)", () => {
    expect(isPrivateAddress("not-an-address")).toBe(false);
  });

  test("rejects an octet out of range as not a valid IPv4 (falls through to hextet checks)", () => {
    expect(isPrivateAddress("999.999.999.999")).toBe(false);
  });
});

describe("hostMatchesSuffix", () => {
  test("matches an exact host", () => {
    expect(hostMatchesSuffix("example.com", "example.com")).toBe(true);
  });

  test("matches a subdomain via dot-suffix", () => {
    expect(hostMatchesSuffix("docs.example.com", "example.com")).toBe(true);
  });

  test("does not match a different domain that merely shares a suffix string", () => {
    expect(hostMatchesSuffix("notexample.com", "example.com")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(hostMatchesSuffix("Docs.Example.COM", "example.com")).toBe(true);
  });

  test("does not match an unrelated host", () => {
    expect(hostMatchesSuffix("other.org", "example.com")).toBe(false);
  });
});
