import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { capabilities, health } from '../fixtures/dto';
import { fakeServer } from '../helpers';

function renderApp(fetch: FetchLike) {
  const store = new QueryStore(createApiClient(fetch));
  return render(<App store={store} eventSource={null} />);
}

describe('app shell', () => {
  it('shows the persistent DEMO DATA banner when the server is in demo mode', async () => {
    const server = fakeServer({
      '/api/health': health({ mode: 'demo' }),
      '/api/capabilities': capabilities({ mode: 'demo' }),
    });
    renderApp(server.fetch);
    const banner = await screen.findByTestId('demo-banner');
    expect(banner.textContent).toContain('DEMO DATA');
  });

  it('shows no demo banner in live mode', async () => {
    renderApp(fakeServer({}).fetch);
    await screen.findByText(/server 0\.0\.0-test · live mode/);
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });

  it('explains how to start the server when the API is unreachable, with no numbers', async () => {
    renderApp(() => Promise.reject(new TypeError('Failed to fetch')));
    const main = await screen.findByRole('main');
    const alert = await within(main).findByRole('alert');
    expect(alert.textContent).toContain('Server not reachable at /api');
    expect(alert.textContent).toContain('pnpm dev');
    expect(main.textContent).not.toMatch(/\d{2,}/);
  });

  it('shows a contract violation instead of rendering a malformed response', async () => {
    const server = fakeServer({ '/api/capabilities': { mode: 'demo', providers: 'nope' } });
    renderApp(server.fetch);
    const alerts = await screen.findAllByRole('alert');
    const alert = alerts.find((a) => a.textContent.includes('/api/capabilities'));
    expect(alert?.getAttribute('data-error-kind')).toBe('parse');
    expect(alert?.textContent).toContain('providers');
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });
});
