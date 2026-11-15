/** "/settings?bus=…#phone": keep the query (it names the backend) and land on a section. */
export function settingsHref(hash: string, searchParams: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  }
  const query = q.toString();
  return `/settings${query ? `?${query}` : ''}#${hash}`;
}
