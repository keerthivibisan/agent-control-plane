import { Card } from '../../components/Card';
import { InfoTip } from '../../components/InfoTip';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { GLOSSARY, PAGES } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { CandidateRoots } from '../command-center/CandidateRoots';
import { HooksStatus } from '../command-center/CapabilitiesPanel';
import { RegisterProjectForm } from '../command-center/RegisterProjectForm';

/*
 * Phase-1 placeholder (UI foundation): renders the existing register form, unadded folders and
 * hook status inside the new layout. Phase 2 moves these components here from command-center and
 * rewrites their wording.
 */

/** `#/setup`: add project folders and check the optional Claude Code hooks. */
export function SetupPage() {
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  return (
    <div>
      <PageHeader title={PAGES.setup.title} description={PAGES.setup.description} />
      <div className="flex flex-col gap-6">
        <Card
          title="Add a project"
          tip={GLOSSARY.project.tip}
          description="Only sessions that ran inside a project folder are read. Add a folder by its full path."
        >
          <RegisterProjectForm />
        </Card>
        <Card
          title="Unadded folders"
          tip={GLOSSARY.unaddedFolder.tip}
          description="Folders where Claude Code ran that aren't projects yet. Add one to start reading its sessions."
        >
          <CandidateRoots />
        </Card>
        <Card
          title="Claude Code hooks (optional)"
          description={
            <>
              Hooks tell this app when a session ends or is waiting for you. Without them, quiet
              sessions show as Inactive instead of Ended.{' '}
              <InfoTip
                label="hooks"
                tip="This app never edits your Claude Code settings. You add the hook yourself."
              />
            </>
          }
        >
          <QueryView query={caps}>{(c) => <HooksStatus hooks={c.hooks} />}</QueryView>
        </Card>
      </div>
    </div>
  );
}
