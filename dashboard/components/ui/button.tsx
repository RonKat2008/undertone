import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'danger';

interface CommonProps {
  /**
   * primary: the one main action on a page (accent fill; at most one per view).
   * quiet: every other action (hairline border).
   * ghost: icon-only or low-stakes inline actions (no border).
   * danger: destructive actions; confirm them in a Dialog.
   */
  variant?: ButtonVariant;
  size?: 'default' | 'small';
  /** Spinner in place of the label; keeps the width, blocks clicks, sets aria-busy. */
  loading?: boolean;
  /** Icon-only square button. Requires aria-label. */
  iconOnly?: boolean;
  className?: string;
  children: ReactNode;
}

export type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & { href?: undefined };

export interface ButtonLinkProps extends CommonProps {
  /** Navigation that looks like an action renders a Next link. */
  href: string;
  disabled?: boolean;
  'aria-label'?: string;
}

function Inner({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <>
      <span className="qi-btn-label">{children}</span>
      {loading ? (
        <span className="qi-btn-spinner" aria-hidden>
          <span className="qi-spinner" />
        </span>
      ) : null}
    </>
  );
}

/** The one button. Labels are verbs that say what happens: "Save coach", not "Submit". */
export function Button(props: ButtonProps | ButtonLinkProps) {
  if (typeof props.href === 'string') return <ButtonAsLink {...props} />;
  const {
    variant = 'quiet', size = 'default', loading = false, iconOnly = false, className, children,
    type = 'button', disabled, onClick, ...rest
  } = props;
  return (
    <button
      {...rest}
      type={type}
      className={`qi-btn ${className ?? ''}`}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      disabled={disabled}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
    >
      <Inner loading={loading}>{children}</Inner>
    </button>
  );
}

function ButtonAsLink({ href, variant = 'quiet', size = 'default', loading = false, iconOnly = false, className, children, disabled, ...aria }: ButtonLinkProps) {
  const shared = {
    className: `qi-btn ${className ?? ''}`,
    'data-variant': variant,
    'data-size': size,
    'data-icon-only': iconOnly || undefined,
    'aria-label': aria['aria-label'],
  };
  if (disabled) return <span {...shared} aria-disabled role="link"><Inner loading={false}>{children}</Inner></span>;
  return <Link {...shared} href={href} aria-busy={loading || undefined}><Inner loading={loading}>{children}</Inner></Link>;
}
