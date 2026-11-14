export interface AvatarProps {
  /** The person's name; initials are taken from it. */
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** person (default, coral), me (teal: you), coach (amber: the coach). */
  tone?: 'person' | 'me' | 'coach';
}

/** First letters of the first and last word: "Sam Ortiz" -> "SO", "Priya" -> "P". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

/** A person as coloured initials. The colour is the person kind; the letters tell people apart. */
export function Avatar({ name, size = 'md', tone = 'person' }: AvatarProps) {
  return (
    <span className="qi-avatar" data-size={size} data-tone={tone === 'person' ? undefined : tone} role="img" aria-label={name}>
      <span aria-hidden>{initials(name)}</span>
    </span>
  );
}
