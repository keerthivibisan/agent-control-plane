import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import {
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { SHELL_COPY } from '../lib/copy';
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../lib/theme';
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon, type IconProps } from './icons';
import { floatingClass, MenuLabel } from './Menu';
import { Segmented } from './Segmented';

const C = SHELL_COPY.theme;

export const THEME_ICON: Record<ThemePreference, ComponentType<IconProps>> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/** "Light", "Dark", or "System (dark)": the choice, and for System what it shows now. */
function themeWord(preference: ThemePreference, resolved: 'light' | 'dark'): string {
  return preference === 'system'
    ? `${C.options.system} (${resolved === 'dark' ? 'dark' : 'light'})`
    : C.options[preference];
}

/**
 * The top bar's theme control, like GitHub's appearance setting: an icon button (the current
 * choice's icon) opening a small menu of Light, Dark and System, the chosen one checked
 * (`menuitemradio`, `aria-checked`). Radix DropdownMenu: arrows move, Enter or Space choose,
 * Escape closes it to the button. `wrap` puts the button in the shell's tooltip.
 */
export function ThemeMenu({
  className = '',
  wrap = (b) => b,
}: {
  /** The button's look (the top bar's dark style). */
  className?: string;
  /** Wraps the button, e.g. in a tooltip; must pass a ref-taking element through. */
  wrap?: (button: ReactElement) => ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = THEME_ICON[theme.preference];
  return (
    <RadixMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      {wrap(
        <RadixMenu.Trigger
          asChild
          // Radix opens on pointerdown and keys; a click with no pointer (assistive tech,
          // `element.click()`) toggles it too.
          onClick={(e: MouseEvent) => {
            if (e.detail === 0) setOpen((o) => !o);
          }}
        >
          <button
            type="button"
            data-testid="theme-menu"
            aria-label={C.label(themeWord(theme.preference, theme.resolved))}
            className={className}
          >
            <Icon size={16} />
          </button>
        </RadixMenu.Trigger>,
      )}
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          loop
          aria-label={C.menu}
          aria-labelledby={undefined}
          className={`${floatingClass} flex w-60 flex-col p-2 focus:outline-none`}
        >
          <MenuLabel>{C.menu}</MenuLabel>
          <RadixMenu.RadioGroup
            value={theme.preference}
            onValueChange={(v) => {
              if (v === 'light' || v === 'dark' || v === 'system') theme.setPreference(v);
            }}
          >
            {THEME_PREFERENCES.map((p) => {
              const ItemIcon = THEME_ICON[p];
              return (
                <RadixMenu.RadioItem
                  key={p}
                  value={p}
                  data-testid={`theme-${p}`}
                  className="flex cursor-default items-center gap-2 rounded-control px-2 py-1.5 text-ink outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid data-[highlighted]:bg-hover"
                >
                  <span className="flex w-4 shrink-0 justify-center text-accent">
                    <RadixMenu.ItemIndicator>
                      <CheckIcon size={16} />
                    </RadixMenu.ItemIndicator>
                  </span>
                  <ItemIcon size={16} className="shrink-0 text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{C.options[p]}</span>
                    {p === 'system' ? (
                      <span className="block text-caption text-dim">{C.systemHint}</span>
                    ) : null}
                  </span>
                </RadixMenu.RadioItem>
              );
            })}
          </RadixMenu.RadioGroup>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/** The same choice as three buttons, for Settings ("Appearance"). */
export function ThemeChoice() {
  const theme = useTheme();
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented
        label={C.menu}
        options={THEME_PREFERENCES.map((p) => ({ value: p, label: C.options[p] }))}
        value={theme.preference}
        onChange={theme.setPreference}
      />
      {theme.preference === 'system' ? (
        <p className="text-caption text-dim">
          {C.systemHint} ({theme.resolved === 'dark' ? 'dark' : 'light'})
        </p>
      ) : null}
    </div>
  );
}
