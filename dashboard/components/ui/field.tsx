'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

interface FieldFrameProps {
  label: ReactNode;
  /** One short line under the control. */
  hint?: ReactNode;
  /** What is wrong and how to fix it. Replaces the hint while present. */
  error?: ReactNode;
}

function Frame({ id, label, hint, error, children }: FieldFrameProps & { id: string; children: ReactNode }) {
  return (
    <div className="qi-field">
      <label className="qi-field-label" htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="qi-field-error" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className="qi-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export type InputProps = FieldFrameProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'children'>;

/** A labelled single-line input. The label is always visible; a placeholder is an example, never the label. */
export function Input({ label, hint, error, id: given, className, ...rest }: InputProps) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        className={`qi-input ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        {...rest}
      />
    </Frame>
  );
}

export type TextareaProps = FieldFrameProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'>;

/** A labelled multi-line input, for describing a coach or writing a note. */
export function Textarea({ label, hint, error, id: given, className, ...rest }: TextareaProps) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        className={`qi-input ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        {...rest}
      />
    </Frame>
  );
}
