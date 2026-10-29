import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  RUN_ID,
  TICKET_ID,
  followUpScenario,
  type FollowUpFixture,
} from '../../e2e/ticket-fixtures';
import { MissingFolderNotice } from '../../src/features/project-setup/MissingFolderNotice';
import { ProjectSettings } from '../../src/features/project-setup/ProjectSettings';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { ApiError } from '../../src/lib/api';
import { project } from '../fixtures/dto';
import { PROJECT_ID, candidates, harness, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

const P = `/api/projects/${PROJECT_ID}`;

const refusal = (status: number, code: string, message: string) =>
  jsonResponse(status, { error: { code, message, requestId: 'req-1' } });

function server(routes: RouteTable = {}) {
  let current = project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' });
  return fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: () => jsonResponse(200, current),
    [`${P}/setup`]: setup(),
    [`${P}/harness`]: harness('none'),
    [`${P}/context-candidates`]: candidates(),
    [`PATCH ${P}`]: (body: unknown) => {
      current = { ...current, ...(body as object) };
      return jsonResponse(200, current);
    },
    ...routes,
  });
}

const folderBox = () => screen.findByLabelText<HTMLInputElement>('Folder');
const patches = (s: ReturnType<typeof server>) => s.calls.filter((c) => c.method === 'PATCH');

afterEach(() => {
  window.location.hash = '';
});

describe('Settings: change the project folder', () => {
  it('saves a new absolute path with PATCH and shows the refreshed project', async () => {
    const s = server();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const box = await folderBox();
    const save = screen.getByRole('button', { name: 'Save folder' });
    expect(box.value).toBe('/work/web-app');
    expect(save).toHaveProperty('disabled', true);

    fireEvent.change(box, { target: { value: ' /work/moved ' } });
    fireEvent.click(save);
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0]?.path).toBe(P);
    expect(patches(s)[0]?.body).toEqual({ rootPath: '/work/moved' });
    expect((await screen.findByText('Folder updated.')).getAttribute('role')).toBe('status');
    // The project query was refetched, so the field now shows the stored path.
    await waitFor(() =>
      expect(s.calls.filter((c) => c.path === P && c.method === 'GET')).toHaveLength(2),
    );
    expect((await folderBox()).value).toBe('/work/moved');
  });

  it('refuses an empty or relative path without calling the server', async () => {
    const s = server();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const box = await folderBox();
    fireEvent.change(box, { target: { value: 'relative/dir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByText(/starting with \/ \(for example/)).toBeTruthy();
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByText('Enter the folder path.')).toBeTruthy();
    expect(patches(s)).toHaveLength(0);
  });

  it('explains invalid_root and conflict in plain words', async () => {
    const s = server({
      [`PATCH ${P}`]: (body: unknown) =>
        (body as { rootPath: string }).rootPath === '/taken'
          ? refusal(409, 'conflict', 'Another project has this root path')
          : refusal(400, 'invalid_root', 'Root path does not exist'),
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const box = await folderBox();
    fireEvent.change(box, { target: { value: '/gone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(
      await screen.findByText('Folder not found. Point the project at its new location.'),
    ).toBeTruthy();
    fireEvent.change(box, { target: { value: '/taken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByText('Another project already uses this folder.')).toBeTruthy();
  });

  it('keeps the folder editable and says so when the setup cannot be read for a missing folder', async () => {
    const s = server({
      [`${P}/setup`]: () => refusal(400, 'invalid_root', 'Root path does not exist'),
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const notice = await screen.findByTestId('missing-folder');
    expect(notice.textContent).toContain('The project folder was not found');
    expect(notice.textContent).toContain('Point the project at its new location');
    expect((await folderBox()).value).toBe('/work/web-app');
    expect(screen.getByRole('button', { name: 'Save folder' })).toBeTruthy();
    expect(within(screen.getByTestId('settings-project')).queryByLabelText('Board key')).toBeNull();
  });
});

describe('MissingFolderNotice', () => {
  const http = (code: string) =>
    new ApiError({ kind: 'http', path: '/x', status: 400, code, message: 'm', requestId: null });

  it('shows for invalid_root only, with a link to Settings when the project is known', () => {
    const { container, rerender } = renderWithApi(
      <MissingFolderNotice error={http('invalid_root')} projectId={PROJECT_ID} />,
      server(),
    );
    expect(screen.getByRole('link', { name: 'Update the folder' }).getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/settings`,
    );
    rerender(<MissingFolderNotice error={http('conflict')} />);
    expect(container.querySelector('[data-testid="missing-folder"]')).toBeNull();
    rerender(<MissingFolderNotice error={null} />);
    expect(container.querySelector('[data-testid="missing-folder"]')).toBeNull();
  });
});

describe('ticket page: a missing folder is not silent', () => {
  beforeAll(() => {
    if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
      class Matrix {
        m22 = 1;
      }
      Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
    }
    for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
    }
    Object.assign(SVGElement.prototype, { getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) });
  });

  it('adds the notice under the chat error when the lead cannot be messaged', async () => {
    const available: FollowUpFixture = { state: 'available', reason: null };
    const sc = followUpScenario(available);
    const s = fakeServer({
      ...sc.routes,
      [`POST /api/runs/${RUN_ID}/chat`]: () =>
        refusal(400, 'invalid_root', 'Root path does not exist'),
    });
    window.location.hash = '#?tab=agents';
    renderWithApi(<TicketPage id={TICKET_ID} />, s);
    const panel = await screen.findByTestId('side-panel');
    const box = within(panel).getByRole('textbox', { name: 'Message to the lead agent' });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Send' }));
    const notice = await within(panel).findByTestId('missing-folder');
    expect(notice.textContent).toContain('Point the project at its new location');
  });
});
