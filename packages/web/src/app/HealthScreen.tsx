import { DataHealthPage } from '../features/health/DataHealthPage';
import { SetupPage } from '../features/setup/SetupPage';
import { SHELL_COPY } from '../lib/copy';
import { href, type HealthTab } from '../lib/router';

const C = SHELL_COPY.health;

const TABS: readonly { id: HealthTab; label: string; to: string }[] = [
  { id: 'overview', label: C.overview, to: href.health() },
  { id: 'connection', label: C.connection, to: href.setup() },
];

/**
 * Data health with its two sections: the diagnostics (`#/health`) and the connection, which was
 * the Setup page (`#/health/connection`: project folders and hooks; docs/redesign/README.md §3).
 */
export function HealthScreen({ tab }: { tab: HealthTab }) {
  // Under the page title, like every page's own controls (R-V visual problem 9). The sections are
  // addresses, so they stay links in a navigation (with `aria-current`), drawn like the shared
  // underline tab bar (components/Tabs.tsx, whose Radix tabs are buttons that switch panels).
  const tabs = (
    <nav aria-label={C.tabs} className="-mt-1 mb-6 flex items-center gap-5 border-b border-line">
      {TABS.map((t) => (
        <a
          key={t.id}
          href={t.to}
          aria-current={t.id === tab ? 'page' : undefined}
          className={`-mb-px inline-flex h-9 items-center border-b-2 px-0.5 font-medium whitespace-nowrap no-underline transition-colors ${
            t.id === tab ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'
          }`}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
  return tab === 'overview' ? <DataHealthPage tabs={tabs} /> : <SetupPage tabs={tabs} />;
}
