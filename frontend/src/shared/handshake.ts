import type { PageSupportStatus } from "./contracts";

const SUPPORTED_ROOT_DOMAINS = ["handshake.com", "joinhandshake.com"];

function isSupportedHostname(hostname: string): boolean {
  return SUPPORTED_ROOT_DOMAINS.some((domain) => {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

export function inferPageSupport(url: string | null | undefined): PageSupportStatus {
  if (!url) {
    return "unknown";
  }

  try {
    const parsed = new URL(url);
    return isSupportedHostname(parsed.hostname) ? "supported" : "unsupported";
  } catch {
    return "unsupported";
  }
}
