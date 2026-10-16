import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * The shared field look (DESIGN.md, "Inputs"): 36px tall, soft border, the accent on focus. Use
 * `inputClass()` on native elements, or the wrappers below. Pages keep their own labels.
 */
export function inputClass(extra = ''): string {
  return `w-full rounded-control border border-line-strong/80 bg-panel px-3 py-2 text-ink shadow-card transition-colors hover:border-line-strong focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60 ${extra}`;
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass(className)} {...rest} />;
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass(`pr-8 ${className}`)} {...rest} />;
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={inputClass(className)} {...rest} />;
}
