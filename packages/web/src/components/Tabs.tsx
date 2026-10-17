import * as RadixTabs from '@radix-ui/react-tabs';
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';

/** Lets a Tab select itself on click too (Radix selects on mousedown and on keys). */
const SelectContext = createContext<(value: string) => void>(() => {});

/**
 * Tabs (Radix Tabs), replacing the per-feature copies: a `tablist` of `tab`s with
 * `aria-selected`, each controlling a `tabpanel`. Arrow keys move between tabs and select them
 * (automatic activation), Home/End jump to the ends. Controlled: the owner keeps the value (often
 * in the address). Tabs and panels carry Radix's `data-state`; never put the app's own on them.
 *
 * ```tsx
 * <Tabs value={tab} onValueChange={setTab}>
 *   <TabList label="Sections">
 *     <Tab value="chat">Chat</Tab>
 *     <Tab value="files">Files</Tab>
 *   </TabList>
 *   <TabPanel value="chat">…</TabPanel>
 *   <TabPanel value="files">…</TabPanel>
 * </Tabs>
 * ```
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  children,
  className = '',
}: {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
  className?: string;
}) {
  // Radix types the value as a string; every Tab inside is a T, so this is one.
  // Radix can report one mousedown twice (mousedown, then focus); report each change once.
  const latest = useRef<string>(value);
  useLayoutEffect(() => {
    latest.current = value;
  }, [value]);
  const select = (v: string) => {
    if (v === latest.current) return;
    latest.current = v;
    onValueChange(v as T);
  };
  return (
    <SelectContext.Provider value={select}>
      <RadixTabs.Root value={value} onValueChange={select} className={className}>
        {children}
      </RadixTabs.Root>
    </SelectContext.Provider>
  );
}

export function TabList({
  label,
  children,
  className = '',
}: {
  /** Accessible name of the tab list. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixTabs.List aria-label={label} className={`${tabListClass} ${className}`}>
      {children}
    </RadixTabs.List>
  );
}

/** The underline tab look, shared by `Tab` (selected: Radix `data-state`) and `LinkTab`. */
const tabClass =
  'relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-0.5 font-medium whitespace-nowrap text-dim no-underline transition-colors hover:text-ink';

const tabListClass = 'flex min-w-0 items-center gap-4 overflow-x-auto border-b border-line';

export function Tab({
  value,
  children,
  testId,
}: {
  value: string;
  children: ReactNode;
  testId?: string;
}) {
  const select = useContext(SelectContext);
  return (
    <RadixTabs.Trigger
      value={value}
      // A click without a mousedown (assistive tech, `element.click()`) selects the tab as well.
      onClick={() => select(value)}
      data-testid={testId}
      className={`${tabClass} data-[state=active]:border-accent data-[state=active]:text-ink`}
    >
      {children}
    </RadixTabs.Trigger>
  );
}

export function TabPanel({
  value,
  children,
  className = '',
  testId,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <RadixTabs.Content
      value={value}
      data-testid={testId}
      className={`min-w-0 focus-visible:outline-offset-4 ${className}`}
    >
      {children}
    </RadixTabs.Content>
  );
}

/**
 * The link variant: sections that are addresses (Data health and its Connection), so a
 * `navigation` of links with `aria-current="page"` on the open one, drawn like the tab bar above.
 * Tab moves between the links as usual; there are no panels.
 */
export function LinkTabList({
  label,
  children,
  className = '',
}: {
  /** Accessible name of the navigation. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`${tabListClass} ${className}`}>
      {children}
    </nav>
  );
}

export function LinkTab({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`${tabClass} aria-[current=page]:border-accent aria-[current=page]:text-ink`}
    >
      {children}
    </a>
  );
}
