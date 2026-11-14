import { useId, type ReactNode } from 'react';

export interface SectionProps {
  /** A quiet heading: a few words, sentence case. Omit only when the page title already names it. */
  title?: ReactNode;
  /** A short note or one action on the right of the heading (a TextLink, a small Button, a Menu). */
  aside?: ReactNode;
  /** Draw the hairline above. Turn off for the first section straight under the page title. */
  rule?: boolean;
  className?: string;
  children: ReactNode;
}

/** A group of related content under a hairline rule. No box, no background. */
export function Section({ title, aside, rule = true, className, children }: SectionProps) {
  const id = useId();
  return (
    <section className={`qi-section ${className ?? ''}`} data-rule={rule} aria-labelledby={title ? id : undefined}>
      {title || aside ? (
        <div className="qi-section-head">
          {title ? <h2 id={id} className="qi-section-title">{title}</h2> : <span />}
          {aside ? <div className="qi-section-note">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
