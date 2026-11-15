import type { ReactNode } from 'react';

export interface PageProps {
  /** One short noun phrase or sentence. Sentence case, no trailing period. */
  title: ReactNode;
  /** At most one line that says what this page is for. Optional. */
  lede?: ReactNode;
  /** One action at most, top right (e.g. a primary Button). */
  action?: ReactNode;
  /** 'reading' (720 px) for prose and lists; 'wide' (1040 px) only for a graph or a dense list. */
  width?: 'reading' | 'wide';
  children: ReactNode;
}

/** Every page starts here: the title, an optional lede, and the content column. */
export function Page({ title, lede, action, width = 'reading', children }: PageProps) {
  return (
    <div className="qi-page" data-width={width}>
      <header className="qi-page-head">
        <div className="min-w-0">
          <h1 className="qi-page-title">{title}</h1>
          {lede ? <p className="qi-page-lede">{lede}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </div>
  );
}
