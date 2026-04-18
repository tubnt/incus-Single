import { describe, expect, it } from "vitest";
import { defaultUserForImage } from "./default-user";

describe("defaultUserForImage", () => {
  it("matches Ubuntu cloud image", () => {
    expect(defaultUserForImage("images:ubuntu/24.04/cloud")).toBe("ubuntu");
    expect(defaultUserForImage("images:ubuntu/22.04")).toBe("ubuntu");
  });

  it("matches Debian", () => {
    expect(defaultUserForImage("images:debian/12/cloud")).toBe("debian");
  });

  it("matches Rocky / AlmaLinux / CentOS / Fedora", () => {
    expect(defaultUserForImage("images:rockylinux/9/cloud")).toBe("rocky");
    expect(defaultUserForImage("images:almalinux/9/cloud")).toBe("almalinux");
    expect(defaultUserForImage("images:centos/9-Stream/cloud")).toBe("centos");
    expect(defaultUserForImage("images:fedora/40/cloud")).toBe("fedora");
  });

  it("matches openSUSE / Arch / Alpine / FreeBSD", () => {
    expect(defaultUserForImage("images:opensuse/15.5/cloud")).toBe("opensuse");
    expect(defaultUserForImage("images:archlinux/cloud")).toBe("arch");
    expect(defaultUserForImage("images:alpine/3.19")).toBe("alpine");
    expect(defaultUserForImage("images:freebsd/14.0")).toBe("freebsd");
  });

  it("falls back to ubuntu for empty / unknown", () => {
    expect(defaultUserForImage("")).toBe("ubuntu");
    expect(defaultUserForImage(null)).toBe("ubuntu");
    expect(defaultUserForImage(undefined)).toBe("ubuntu");
    expect(defaultUserForImage("custom:my-image")).toBe("ubuntu");
  });
});
