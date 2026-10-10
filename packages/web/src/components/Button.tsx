import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-accent bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border-line bg-panel text-ink hover:bg-sunken',
  quiet: 'border-transparent bg-transparent text-dim hover:bg-sunken hover:text-ink',
};

/** Shared button look, also for links that act as buttons. */
export function buttonClass(variant: ButtonVariant = 'secondary'): string {
  return `inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]}`;
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`${buttonClass(variant)} ${className}`} {...rest} />;
}

export function ButtonLink({
  variant = 'secondary',
  className = '',
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; href: string }) {
  return <a className={`${buttonClass(variant)} ${className}`} {...rest} />;
}
