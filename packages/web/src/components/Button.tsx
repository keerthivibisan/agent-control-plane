import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-accent text-accent-ink shadow-card hover:bg-[color-mix(in_srgb,var(--color-accent)_88%,black)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_88%,white)]',
  secondary: 'border-line-strong/70 bg-panel text-ink shadow-card hover:bg-sunken',
  quiet: 'border-transparent bg-transparent text-dim hover:bg-sunken hover:text-ink',
  danger: 'border-danger/40 bg-danger-soft text-danger hover:border-danger',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'h-9 px-3.5',
  sm: 'h-8 px-2.5 text-caption',
};

/** Shared button look (DESIGN.md, "Buttons"), also for links that act as buttons. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return `inline-flex shrink-0 items-center justify-center gap-2 rounded-control border font-medium whitespace-nowrap no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SIZE[size]} ${VARIANT[variant]}`;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href: string;
}) {
  return <a className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}
