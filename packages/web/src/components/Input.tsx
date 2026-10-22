import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * The one field look (DESIGN.md, "Inputs") for native `<input>`, `<select>` and `<textarea>`:
 * GitHub's text field: 32px tall for one line (`min-h-8`), 6px radius, a 1px border, and on focus
 * the accent border plus a 1px inner accent ring (2px of accent in all), the danger border and
 * ring for an invalid value (`aria-invalid`). No width: add `w-full` or a fixed width. Features
 * use this string on their native elements, or the wrappers below.
 */
export const fieldClass =
  'min-h-8 min-w-0 rounded-control border border-line-strong bg-panel px-3 py-[5px] text-ink shadow-[inset_0_1px_0_rgb(31_35_40/0.02)] transition-[border-color,box-shadow] duration-150 placeholder:text-dim/70 focus:border-accent focus:ring-1 focus:ring-accent focus:ring-inset focus:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70 aria-invalid:border-danger aria-invalid:focus:ring-danger';

/** `fieldClass` at full width, plus extra classes. */
export function inputClass(extra = ''): string {
  return `w-full ${fieldClass} ${extra}`;
}

/** Labels above a field, hints in caption text below (DESIGN.md, "Inputs"). */
export const labelClass = 'text-caption font-medium text-ink';
export const hintClass = 'text-caption text-dim';

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass(className)} {...rest} />;
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass(`pr-8 ${className}`)} {...rest} />;
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={inputClass(className)} {...rest} />;
}
