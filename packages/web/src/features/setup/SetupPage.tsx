import type { ReactNode } from 'react';
import { Card } from '../../components/Card';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { GLOSSARY, PAGES, SETUP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { HooksSetup } from './HooksSetup';
import { RegisterProjectForm } from './RegisterProjectForm';
import { UnaddedFolders } from './UnaddedFolders';

/** A numbered step: the number sits in a circle beside the card, like a checklist. */
function Step({
  n,
  optional = false,
  children,
}: {
  n: number;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4" data-step={n}>
      <div className="flex shrink-0 flex-col items-center pt-4">
        <span
          aria-hidden="true"
          className={`flex size-8 items-center justify-center rounded-full text-body font-semibold ${
            optional ? 'border border-line-strong bg-panel text-dim' : 'bg-accent-soft text-accent'
          }`}
        >
          {n}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <span className="sr-only">
          {SETUP_COPY.step(n)}
          {optional ? ` (${SETUP_COPY.optional})` : ''}:
        </span>
        {children}
      </div>
    </li>
  );
}

/** `#/setup`: connect the app to your work, step by step. `tabs` sits under the title. */
export function SetupPage({ tabs }: { tabs?: ReactNode } = {}) {
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  return (
    <div>
      <PageHeader
        title={PAGES.setup.title}
        description={
          <>
            <span className="font-medium text-ink">{SETUP_COPY.heading}.</span>{' '}
            {SETUP_COPY.description}
          </>
        }
      />
      {tabs}
      <ol className="flex flex-col gap-6">
        <Step n={1}>
          <Card
            title={SETUP_COPY.addProject.title}
            tip={GLOSSARY.project.tip}
            description={SETUP_COPY.addProject.description}
            testId="setup-add-project"
          >
            <RegisterProjectForm />
          </Card>
        </Step>
        <Step n={2}>
          <Card
            title={SETUP_COPY.unadded.title}
            tip={GLOSSARY.unaddedFolder.tip}
            description={SETUP_COPY.unadded.description}
            testId="setup-unadded"
          >
            <UnaddedFolders />
          </Card>
        </Step>
        <Step n={3} optional>
          <Card
            title={SETUP_COPY.hooks.title}
            description={SETUP_COPY.hooks.description}
            actions={<span className="text-caption text-dim">{SETUP_COPY.optional}</span>}
            testId="setup-hooks"
          >
            <QueryView query={caps}>{(c) => <HooksSetup caps={c} />}</QueryView>
          </Card>
        </Step>
      </ol>
    </div>
  );
}
