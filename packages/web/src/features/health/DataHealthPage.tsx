import { PageHeader } from '../../components/PageHeader';
import { PAGES } from '../../lib/copy';
import { CapabilitiesPanel } from '../command-center/CapabilitiesPanel';
import { DiagnosticsPanel } from '../command-center/DiagnosticsPanel';

/*
 * Phase-1 placeholder (UI foundation): renders the existing capabilities and diagnostics panels
 * inside the new layout. Phase 2 moves them here from command-center and rewrites their wording.
 */

/** `#/health`: what the app can observe and what it had to skip. */
export function DataHealthPage() {
  return (
    <div>
      <PageHeader title={PAGES.health.title} description={PAGES.health.description} />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <CapabilitiesPanel />
        <DiagnosticsPanel />
      </div>
    </div>
  );
}
