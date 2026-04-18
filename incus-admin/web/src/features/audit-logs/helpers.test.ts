import { describe, expect, it } from "vitest";
import { stripCidrSuffix, targetLabel } from "./helpers";

describe("targetLabel", () => {
  it("prefers details.name for vm.create (even when target_id > 0)", () => {
    expect(
      targetLabel({
        target_type: "vm",
        target_id: 10,
        details: JSON.stringify({ name: "vm-aa6862", ip: "202.151.179.241" }),
      }),
    ).toBe("vm vm-aa6862");
  });

  it("falls back to target_id #N when details has no name/host/osd_id", () => {
    expect(
      targetLabel({ target_type: "vm", target_id: 42, details: "{}" }),
    ).toBe("vm #42");
  });

  it("shows host for node.exec when details has host", () => {
    expect(
      targetLabel({
        target_type: "node",
        target_id: 0,
        details: JSON.stringify({ host: "10.100.0.10", command: "incus list" }),
      }),
    ).toBe("node 10.100.0.10");
  });

  it("shows osd.N for ceph events using osd_id", () => {
    expect(
      targetLabel({
        target_type: "osd",
        target_id: 0,
        details: JSON.stringify({ osd_id: 2 }),
      }),
    ).toBe("osd osd.2");
  });

  it("survives malformed details JSON", () => {
    expect(
      targetLabel({ target_type: "vm", target_id: 7, details: "not-json{" }),
    ).toBe("vm #7");
  });

  it("returns target_type alone when everything is missing", () => {
    expect(
      targetLabel({ target_type: "test", target_id: 0, details: "" }),
    ).toBe("test");
  });
});

describe("stripCidrSuffix", () => {
  it("strips /32 from IPv4", () => {
    expect(stripCidrSuffix("172.235.204.215/32")).toBe("172.235.204.215");
  });

  it("strips /128 from IPv6", () => {
    expect(stripCidrSuffix("::1/128")).toBe("::1");
  });

  it("leaves non-host prefixes untouched", () => {
    expect(stripCidrSuffix("10.0.20.0/24")).toBe("10.0.20.0/24");
  });

  it("returns em dash for falsy input", () => {
    expect(stripCidrSuffix("")).toBe("—");
    expect(stripCidrSuffix(null)).toBe("—");
    expect(stripCidrSuffix(undefined)).toBe("—");
  });

  it("leaves bare IP unchanged", () => {
    expect(stripCidrSuffix("1.2.3.4")).toBe("1.2.3.4");
  });
});
