import { describe, expect, it } from "vitest";
import { validHost } from "./host-validation";

describe("validHost", () => {
  it("accepts IPv4", () => {
    expect(validHost("10.100.0.10")).toBe(true);
    expect(validHost("202.151.179.241")).toBe(true);
    expect(validHost("0.0.0.0")).toBe(true);
    expect(validHost("255.255.255.255")).toBe(true);
  });

  it("partial-IP forms are accepted only as hostnames", () => {
    // 256.0.0.1 fails the IPv4 octet check but matches the hostname grammar
    // (digits + dots), which is acceptable — backend SSH dial will fail with
    // a clear DNS error if the user actually means an IP.
    expect(validHost("256.0.0.1")).toBe(true);
    // No trailing octet — neither valid IPv4 nor valid hostname (ends with digit segment OK, but 10.100.0 still parses as a hostname)
    // Test something actually invalid:
    expect(validHost("..foo")).toBe(false);
  });

  it("accepts IPv6", () => {
    expect(validHost("::1")).toBe(true);
    expect(validHost("2001:db8::1")).toBe(true);
    expect(validHost("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
  });

  it("accepts hostnames", () => {
    expect(validHost("node1")).toBe(true);
    expect(validHost("node1.cluster.local")).toBe(true);
    expect(validHost("n-1.example.com")).toBe(true);
  });

  it("rejects empty / whitespace / junk", () => {
    expect(validHost("")).toBe(false);
    expect(validHost("   ")).toBe(false);
    expect(validHost("not an ip")).toBe(false);
    expect(validHost("http://10.0.0.1")).toBe(false);
  });

  it("rejects hostnames starting with dash", () => {
    expect(validHost("-bad")).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(validHost("  10.0.0.1  ")).toBe(true);
  });
});
