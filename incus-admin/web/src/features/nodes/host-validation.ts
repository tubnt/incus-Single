// IPv4, IPv6 (basic) or RFC 1123 hostname.
const IPV4_RE = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6_RE = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|::([0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}|::)$/i;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function validHost(h: string): boolean {
  const v = (h ?? "").trim();
  if (!v) return false;
  return IPV4_RE.test(v) || IPV6_RE.test(v) || HOSTNAME_RE.test(v);
}
