import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectSettings } from '../../src/features/project-setup/ProjectSettings';
import { CSRF } from '../fixtures/control';
import { project } from '../fixtures/dto';
import { PROJECT_ID, candidates, harness, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/* RL-D (ADR-0021): Settings shows the approvals read-only and never sends them. */

const P = `/api/projects/${PROJECT_ID}`;

function server(initial: ReturnType<typeof setup>) {
  return fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' }),
    [`${P}/setup`]: () => jsonResponse(200, initial),
    [`${P}/harness`]: harness('none'),
    [`${P}/context-candidates`]: candidates(),
    [`PUT ${P}/setup`]: (body: unknown) => jsonResponse(200, setup(body as object)),
  });
}

describe('Settings: the approvals summary', () => {
  it('a setup from before ADR-0021 reads as its mapped mode, linking to Workflow', async () => {
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, server(setup()));
    const row = await screen.findByTestId('settings-approvals');
    // The fixture pre-approves only checks, which maps to Manual (never widened).
    expect(row.textContent).toContain('Approvals: Manual.');
    expect(within(row).getByRole('link', { name: 'Change on Workflow' }).getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/workflow`,
    );
  });

  it('Auto counts its commands; a Settings save leaves the approvals alone', async () => {
    const s = server(
      setup({
        approvals: {
          mode: 'auto',
          commands: [
            { argv: ['npm', 'test'], match: 'exact' },
            { argv: ['mvn'], match: 'prefix' },
          ],
        },
      }),
    );
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const row = await screen.findByTestId('settings-approvals');
    expect(row.textContent).toContain('Approvals: Auto. 2 allowed commands.');
    const card = screen.getByTestId('settings-project');
    fireEvent.change(within(card).getByLabelText('Default model'), {
      target: { value: 'claude-sonnet-4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = s.calls.find((c) => c.method === 'PUT');
    expect(put?.body).not.toHaveProperty('approvals');
  });
});
