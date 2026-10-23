import type { CodeHostStatusDto } from '@acp/core/api';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { hintClass } from '../../components/Input';
import { Pill } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import { codeHostPaths, codeHostSchemas } from '../../lib/api';
import { CODE_HOST_CONNECT_COPY, CODE_HOST_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { CopyableCode } from '../setup/HooksSetup';
import { connectStep, gitHubRepoUrl, type ConnectStep } from './code-host';
import { ConnectRepository } from './ConnectRepository';
import { ExternalLinkIcon } from './icons';

const C = CODE_HOST_COPY;
const K = CODE_HOST_CONNECT_COPY;

/**
 * The project's code host status (`GET /api/projects/:id/code-host`), read when a screen that
 * needs it is shown and on "Check again", never on a timer (ADR-0025 §2). `recheck` asks again.
 */
export function useCodeHost(projectId: string | null) {
  const path = projectId === null ? null : codeHostPaths.status(projectId);
  const q = useApiQuery(path, codeHostSchemas.status);
  const store = useQueryStore();
  const recheck = useCallback(() => {
    if (path !== null) store.invalidate((key) => key === path);
  }, [store, path]);
  return { ...q, recheck };
}

/** A step's message in the warning box, kept as `code-host-message` with the problem's key. */
function StepMessage({ problem, children }: { problem: string; children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5"
      data-testid="code-host-message"
      data-problem={problem}
    >
      <AlertIcon size={16} className="mt-0.5 shrink-0 text-warning" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** `gh` is missing: how to install it, then sign in. */
function InstallStep() {
  return (
    <div className="flex flex-col gap-3" data-testid="code-host-install">
      <StepMessage problem="no-cli">{K.install.message}</StepMessage>
      <div className="flex flex-col gap-1.5">
        <p className={hintClass}>{K.install.brew}</p>
        <CopyableCode text={K.install.command} label={K.copyCommand} />
      </div>
      <p className="text-caption text-dim">
        {K.install.other}{' '}
        <a
          href={K.install.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium"
        >
          {K.install.site}
          <ExternalLinkIcon size={12} />
          <span className="sr-only">{K.newTab}</span>
        </a>
        . {K.install.then}
      </p>
    </div>
  );
}

/** `gh` is not signed in: the owner runs `gh auth login` themselves. */
function LoginStep() {
  return (
    <div className="flex flex-col gap-3" data-testid="code-host-login">
      <StepMessage problem="not-logged-in">{K.login.message}</StepMessage>
      <div className="flex flex-col gap-1.5">
        <p className={hintClass}>{K.login.run}</p>
        <CopyableCode text={K.login.command} label={K.copyCommand} />
      </div>
      <p className="text-caption text-dim">
        {K.login.why} {K.login.then}
      </p>
    </div>
  );
}

/** Connected: `owner/name`, linking to the repository on GitHub. */
function Connected({
  status,
  focusRef,
}: {
  status: CodeHostStatusDto;
  focusRef: RefObject<HTMLParagraphElement | null>;
}) {
  const repo = status.repo ?? '';
  const url = gitHubRepoUrl(repo);
  return (
    <div className="flex flex-col gap-1.5">
      <p
        ref={focusRef}
        tabIndex={-1}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 outline-none"
        data-testid="code-host-message"
      >
        <CheckIcon size={16} className="shrink-0 text-success" />
        <span>{K.connectedLead}</span>{' '}
        {url === null ? (
          <span className="min-w-0 font-medium break-words">{repo}</span>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 font-medium break-all"
            data-testid="code-host-repo-link"
          >
            {repo}
            <ExternalLinkIcon size={13} />
            <span className="sr-only">{K.newTab}</span>
          </a>
        )}
      </p>
      {status.defaultBranch !== null ? (
        <p className="text-caption text-dim">
          {C.defaultBranch}: <span className="font-mono text-ink">{status.defaultBranch}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Settings' GitHub card (ADR-0025 §7): install the GitHub CLI, sign in with it, then create a
 * repository or connect an existing one; once connected, `owner/name` with a link. Check again
 * asks the server once more; nothing is read on a timer.
 */
export function CodeHostCard({ projectId }: { projectId: string }) {
  const host = useCodeHost(projectId);
  // The status a create or connect answered, shown over the status it replaced until that is read
  // again (so the form doesn't flash back while the new one loads).
  const [fresh, setFresh] = useState<{
    status: CodeHostStatusDto;
    over: CodeHostStatusDto | undefined;
  } | null>(null);
  const status = fresh !== null && fresh.over === host.data ? fresh.status : host.data;
  const step: ConnectStep | null = status === undefined ? null : connectStep(status);
  const connectedRef = useRef<HTMLParagraphElement>(null);
  const focusConnected = useRef(false);
  const shown = host.data;
  const onDone = useCallback(
    (next: CodeHostStatusDto) => {
      focusConnected.current = true;
      setFresh({ status: next, over: shown });
    },
    [shown],
  );
  // After a create or connect, focus moves to the connection so it is read out.
  useEffect(() => {
    if (focusConnected.current && step === 'ready') {
      focusConnected.current = false;
      connectedRef.current?.focus();
    }
  }, [step]);

  return (
    <Card
      title={C.title}
      tip={C.tip}
      description={C.description}
      testId="settings-code-host"
      actions={
        step === null ? null : (
          <span data-testid="code-host-state" data-state={step === 'ready' ? 'ready' : 'problem'}>
            <Pill tone={step === 'ready' ? 'success' : 'warning'}>
              {step === 'ready' ? C.word.connected : C.word.notConnected}
            </Pill>
          </span>
        )
      }
    >
      <div className="flex flex-col gap-4" data-step={step ?? 'loading'}>
        {status === undefined ? (
          host.error !== null ? (
            <div className="flex flex-col gap-1.5" data-testid="code-host-error">
              <p role="alert" className="flex items-start gap-2 text-danger">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                {C.loadFailed}
              </p>
              <Details>
                <ErrorNotice error={host.error} />
              </Details>
            </div>
          ) : (
            <LoadingBlock label={C.checking} />
          )
        ) : step === 'ready' ? (
          <Connected status={status} focusRef={connectedRef} />
        ) : step === 'install' ? (
          <InstallStep />
        ) : step === 'login' ? (
          <LoginStep />
        ) : (
          <>
            <p className="text-ink" data-testid="code-host-message" data-problem="no-remote">
              {K.connect.message}
            </p>
            <ConnectRepository projectId={projectId} onDone={onDone} />
          </>
        )}
        <div>
          <Button size="sm" onClick={host.recheck} disabled={host.fetching}>
            {host.fetching && status !== undefined ? C.rechecking : C.recheck}
          </Button>
        </div>
      </div>
    </Card>
  );
}
