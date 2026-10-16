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
  return (
    <div>
      <nav aria-label={C.tabs} className="mb-6 inline-flex rounded-control bg-sunken p-1">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={t.to}
            aria-current={t.id === tab ? 'page' : undefined}
            className={`rounded-[0.375rem] px-3 py-1.5 font-medium no-underline transition-colors ${
              t.id === tab ? 'bg-panel text-ink shadow-card' : 'text-dim hover:text-ink'
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === 'overview' ? <DataHealthPage /> : <SetupPage />}
    </div>
  );
}
