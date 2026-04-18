// Map an Incus image alias (e.g. "images:ubuntu/24.04/cloud") to the cloud-init
// default username configured by the official cloud images. We don't deploy
// custom images here, so this static lookup is sufficient.
const DEFAULT_USER_BY_DISTRO: Array<[RegExp, string]> = [
  [/(^|[/:_-])debian([/:_-]|$)/i, "debian"],
  [/(^|[/:_-])rocky/i, "rocky"],
  [/(^|[/:_-])almalinux/i, "almalinux"],
  [/(^|[/:_-])centos/i, "centos"],
  [/(^|[/:_-])fedora/i, "fedora"],
  [/(^|[/:_-])opensuse/i, "opensuse"],
  [/(^|[/:_-])arch/i, "arch"],
  [/(^|[/:_-])alpine/i, "alpine"],
  [/(^|[/:_-])freebsd/i, "freebsd"],
  [/(^|[/:_-])ubuntu/i, "ubuntu"],
];

export function defaultUserForImage(image: string | undefined | null): string {
  const v = (image ?? "").trim();
  if (!v) return "ubuntu";
  for (const [re, user] of DEFAULT_USER_BY_DISTRO) {
    if (re.test(v)) return user;
  }
  return "ubuntu";
}
