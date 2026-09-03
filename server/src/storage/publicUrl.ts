export function rewriteStorageUrl(url: string, publicEndpoint: string, internalEndpoint: string): string {
  if (!publicEndpoint || publicEndpoint === internalEndpoint) return url;
  try {
    const signed = new URL(url);
    const pub = new URL(publicEndpoint);
    const internal = new URL(internalEndpoint);
    const sameHost = signed.host === internal.host || signed.hostname === internal.hostname;
    if (!sameHost) return url;
    signed.protocol = pub.protocol;
    signed.host = pub.host;
    return signed.toString();
  } catch {
    return url;
  }
}

export function originFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
