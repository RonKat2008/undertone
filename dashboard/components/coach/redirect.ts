/** A path with the current query kept, so ?bus= survives a redirect. */
export function withQuery(path: string, params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') q.append(k, v);
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
