import { useId, type ReactNode } from 'react';

export interface SectionProps {
  /** A plain sentence-case heading: "Recent conversations", "Habits". */
  title?: ReactNode;
  /** A lucide icon element shown before the title in the muted colour. Optional. */
  icon?: ReactNode;
  /** One link or small action on the right of the heading. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A heading and its content. Sections are separated by space; their content usually sits in one Panel. */
export function Section({ title, icon, aside, className, children }: SectionProps) {
  const id = useId();
  return (
    <section className={`qi-section ${className ?? ''}`} aria-labelledby={title ? id : undefined}>
      {title || aside ? (
        <div className="qi-section-head">
          {title ? <h2 id={id} className="qi-section-title">{icon}{title}</h2> : <span />}
          {aside ? <div className="qi-section-note">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
