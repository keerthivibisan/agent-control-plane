import { LinkTab, LinkTabList } from '../components/Tabs';
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
  // addresses, so they are the shared tab bar's link variant (a navigation with `aria-current`).
  const tabs = (
    <LinkTabList label={C.tabs} className="-mt-1 mb-6">
      {TABS.map((t) => (
        <LinkTab key={t.id} href={t.to} current={t.id === tab}>
          {t.label}
        </LinkTab>
      ))}
    </LinkTabList>
  );
  return tab === 'overview' ? <DataHealthPage tabs={tabs} /> : <SetupPage tabs={tabs} />;
}
