import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  // GitHub's buttons (DESIGN.md v3, "Buttons"): green primary with white text, the default a
  // bordered grey, danger red text that fills red on hover, quiet a borderless icon or text button.
  primary:
    'border-primary-edge bg-primary text-primary-ink shadow-card hover:bg-primary-hover disabled:hover:bg-primary',
  secondary: 'border-line bg-control text-ink shadow-card hover:bg-control-hover',
  quiet: 'border-transparent bg-transparent text-dim hover:bg-hover hover:text-ink',
  danger:
    'border-line bg-control text-danger shadow-card hover:border-danger-emphasis hover:bg-danger-emphasis hover:text-on-emphasis disabled:hover:border-line disabled:hover:bg-control disabled:hover:text-danger',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'h-8 px-3',
  sm: 'h-7 px-2 text-caption',
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
