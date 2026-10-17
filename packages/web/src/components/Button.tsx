import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    // Signal lime with graphite text; on ivory a darker lime edge keeps it a button, not a stain.
    'border-accent-fill-edge/45 bg-accent-fill text-accent-fill-ink shadow-[0_1px_1px_rgb(23_23_23/0.06)] hover:border-accent-fill-edge/70 hover:bg-accent-fill-hover',
  secondary: 'border-line-strong bg-panel text-ink shadow-card hover:bg-hover',
  quiet: 'border-transparent bg-transparent text-dim hover:bg-hover hover:text-ink',
  danger: 'border-danger/30 bg-danger-soft text-danger hover:border-danger/60',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'h-8 px-3',
  sm: 'h-7 px-2.5 text-caption',
};

/** Shared button look (DESIGN.md, "Buttons"), also for links that act as buttons. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border font-medium whitespace-nowrap no-underline transition-[background-color,border-color,color,box-shadow] duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0 ${SIZE[size]} ${VARIANT[variant]}`;
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
