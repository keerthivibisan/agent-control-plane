import { SessionStatusSchema } from '@acp/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Card } from '../../src/components/Card';
import { DataTable } from '../../src/components/DataTable';
import { Details } from '../../src/components/Details';
import { EmptyState } from '../../src/components/EmptyState';
import { EstimatedCost } from '../../src/components/EstimatedCost';
import { InfoTip } from '../../src/components/InfoTip';
import { PageHeader } from '../../src/components/PageHeader';
import { RelativeTime } from '../../src/components/RelativeTime';
import { ShortId } from '../../src/components/ShortId';
import { StatCard } from '../../src/components/StatCard';
import { StatusBadge } from '../../src/components/StatusBadge';
import { TokenBreakdown } from '../../src/components/TokenBreakdown';
import { TokenValue } from '../../src/components/TokenValue';
import { STATUS_COPY } from '../../src/lib/copy';
import { partialUsage, T0, T1, usage } from '../fixtures/dto';

describe('InfoTip', () => {
  it('is a labelled button whose tip shows on hover and on focus, and Escape hides it', () => {
    render(<InfoTip label="Input tokens" tip="Text sent to the model." />);
    const button = screen.getByRole('button', { name: 'About Input tokens' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Text sent to the model.');
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(button);
    const tip = screen.getByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('adds no text to its surroundings while closed or open (portaled bubble)', () => {
    const { container } = render(
      <p>
        Term <InfoTip label="Term" tip="Long explanation" />
      </p>,
    );
    fireEvent.focus(screen.getByRole('button'));
    expect(container.textContent).toBe('Term ');
  });
});

describe('Card / StatCard / PageHeader / EmptyState / Details', () => {
  it('Card with a title is a region named by the title only', () => {
    render(
      <Card title="Running now" tip="Sessions with recent activity" description="Right now.">
        body
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'Running now' });
    expect(within(region).getByText('Right now.')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'About Running now' })).toBeTruthy();
  });

  it('StatCard shows the value, label, sublabel and keeps the tip outside the link', () => {
    render(
      <StatCard
        label="Projects"
        value="2 projects"
        sublabel="1 unadded folder"
        href="#/projects"
        tip="Folders you added."
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('#/projects');
    expect(link.textContent).toBe('Projects2 projects1 unadded folder');
    expect(within(link).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'About Projects' })).toBeTruthy();
  });

  it('PageHeader renders an h1 and the one-line description', () => {
    render(
      <PageHeader title="Tokens" description="Tokens used per day." actions={<button>x</button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Tokens' })).toBeTruthy();
    expect(screen.getByText('Tokens used per day.')).toBeTruthy();
  });

  it('EmptyState shows title, text and action', () => {
    render(
      <EmptyState
        title="No sessions yet"
        text="They appear here."
        action={<a href="#/setup">Add</a>}
      />,
    );
    expect(screen.getByText('No sessions yet')).toBeTruthy();
    expect(screen.getByText('They appear here.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add' })).toBeTruthy();
  });

  it('Details is collapsed by default and says "Technical details"', () => {
    const { container } = render(<Details>raw</Details>);
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(container.querySelector('summary')?.textContent).toBe('Technical details');
    expect(
      render(
        <Details defaultOpen summary="Raw event">
          x
        </Details>,
      ).container.querySelector('details')?.open,
    ).toBe(true);
  });
});

describe('StatusBadge', () => {
  it('shows the DESIGN.md word for every status and never "completed"', () => {
    for (const status of SessionStatusSchema.options) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const badge = container.querySelector(`[data-status="${status}"]`);
      expect(badge?.textContent).toBe(STATUS_COPY[status].word);
      expect(container.textContent.toLowerCase()).not.toContain('complete');
      unmount();
    }
  });

  it('puts the status tip and the evidence in its info tip', () => {
    render(
      <StatusBadge
        status={{
          value: 'ended',
          provenance: 'derived',
          basis: { lastEventAt: T0, endedAt: T1, evaluatedAt: T1 },
        }}
      />,
    );
    const button = screen.getByRole('button', { name: 'About status Ended' });
    fireEvent.focus(button);
    const tip = screen.getByRole('tooltip').textContent;
    expect(tip).toContain(STATUS_COPY.ended.tip);
    expect(tip).toContain('Last activity:');
    expect(tip).toContain('Ended:');
  });

  it('can drop the tip for dense lists', () => {
    render(<StatusBadge status="active" withTip={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('TokenValue', () => {
  it('shows the number with its unit', () => {
    const { container } = render(<TokenValue value={1540} type="output" />);
    expect(container.textContent).toBe('1,540 output tokens');
    expect(render(<TokenValue value={1} type="input" />).container.textContent).toBe(
      '1 input token',
    );
    expect(render(<TokenValue value={12} />).container.textContent).toBe('12 tokens');
  });

  it('reads "Not reported" for null, never 0', () => {
    const { container } = render(<TokenValue value={null} type="cacheRead" />);
    expect(container.textContent).toBe('Not reported');
    expect(container.querySelector('[data-state="unavailable"]')).not.toBeNull();
  });

  it('keeps 0 as a real 0 when it was reported', () => {
    expect(render(<TokenValue value={0} type="output" />).container.textContent).toBe(
      '0 output tokens',
    );
  });

  it('compact form has the exact value in a focusable tooltip', () => {
    const { container } = render(<TokenValue value={12400} type="input" compact />);
    expect(container.textContent).toBe('12.4K input tokens');
    const trigger = container.firstElementChild as HTMLElement;
    expect(trigger.tabIndex).toBe(0);
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('12,400 input tokens');
  });
});

describe('TokenBreakdown', () => {
  it('shows the four token types side by side and no total', () => {
    const { container } = render(<TokenBreakdown usage={usage()} />);
    const list = container.querySelector('dl[aria-label="Tokens by type"]') as HTMLElement;
    expect(within(list).getByText('Input tokens')).toBeTruthy();
    expect(within(list).getByText('Output tokens')).toBeTruthy();
    expect(within(list).getByText('Cache write tokens')).toBeTruthy();
    expect(within(list).getByText('Cache read tokens')).toBeTruthy();
    const cells = [...container.querySelectorAll('dd[data-category]')].map((d) => d.textContent);
    expect(cells).toEqual(['1,200', '3,400', '500', '98,000']);
    // 1200 + 3400 + 500 + 98000: a summed total must never appear.
    expect(container.textContent).not.toContain('103,100');
    expect(container.textContent.toLowerCase()).not.toContain('total');
  });

  it('reads "Not reported" for a missing type and explains a partial one in plain words', () => {
    const { container } = render(<TokenBreakdown usage={partialUsage} />);
    expect(container.querySelector('dd[data-category="cacheCreation"]')?.textContent).toBe(
      'Not reported',
    );
    expect(container.querySelector('dd[data-partial="cacheRead"]')?.textContent).toBe(
      "Partial: 1 of 3 records didn't report this, so the real number may be higher.",
    );
    expect(container.querySelector('dd[data-partial="cacheCreation"]')).toBeNull();
  });

  it('accepts bare token counts', () => {
    const { container } = render(
      <TokenBreakdown usage={{ input: 1, output: null, cacheCreation: 0, cacheRead: 2 }} />,
    );
    const cells = [...container.querySelectorAll('dd[data-category]')].map((d) => d.textContent);
    expect(cells).toEqual(['1', 'Not reported', '0', '2']);
  });
});

describe('EstimatedCost', () => {
  it('always says "Estimated cost" and explains it', () => {
    const { container } = render(<EstimatedCost cost={{ provenance: 'estimated', value: 1.5 }} />);
    expect(container.textContent).toBe('Estimated cost~$1.50');
    expect(container.querySelector('[data-provenance="estimated"]')).not.toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'About Estimated cost' }));
    expect(screen.getByRole('tooltip').textContent).toMatch(/reported by Claude Code/);
  });

  it('reads "Not reported" when no cost was reported, never $0', () => {
    const { container } = render(
      <EstimatedCost cost={{ provenance: 'unavailable', value: null }} />,
    );
    expect(container.textContent).toBe('Estimated costNot reported');
    expect(container.textContent).not.toContain('$');
  });

  it('can hide the label but keeps the tip', () => {
    const { container } = render(
      <EstimatedCost cost={{ provenance: 'estimated', value: 0.25 }} showLabel={false} />,
    );
    expect(container.textContent).toBe('~$0.25');
    expect(screen.getByRole('button', { name: 'About Estimated cost' })).toBeTruthy();
  });
});

describe('ShortId', () => {
  it('shows 8 characters and copies the full id', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    render(<ShortId id="0123456789abcdef" label="session id" writeText={writeText} />);
    expect(screen.getByText('01234567')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy session id' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('0123456789abcdef');
    expect(screen.getByRole('status').textContent).toBe('Copied');
  });

  it('says so when copying fails', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    render(<ShortId id="0123456789abcdef" writeText={writeText} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy id' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe("Couldn't copy");
  });
});

describe('RelativeTime', () => {
  const now = () => new Date('2026-10-10T08:08:00.000Z');

  it('shows relative words with the exact time in a tooltip', () => {
    const { container } = render(<RelativeTime iso={T1} now={now} />);
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('3 min ago');
    expect(time?.getAttribute('datetime')).toBe(T1);
    fireEvent.focus(container.firstElementChild as HTMLElement);
    expect(screen.getByRole('tooltip').textContent).toMatch(/2026/);
  });

  it('reads the fallback for a missing time', () => {
    expect(render(<RelativeTime iso={null} now={now} />).container.textContent).toBe(
      'Not reported',
    );
    expect(
      render(<RelativeTime iso={null} fallback="No activity yet" now={now} />).container
        .textContent,
    ).toBe('No activity yet');
  });
});

describe('DataTable', () => {
  const rows = [
    { id: 'a', name: 'Alpha', n: 1 },
    { id: 'b', name: 'Beta', n: 2 },
  ];
  const columns = [
    { key: 'name', label: 'Name', cell: (r: (typeof rows)[number]) => r.name },
    { key: 'n', label: 'Count', align: 'right' as const, cell: (r: (typeof rows)[number]) => r.n },
  ];

  it('renders one row per item with data attributes and per-cell labels for narrow screens', () => {
    const { container } = render(
      <DataTable
        label="Things"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowAttributes={(r) => ({ 'data-thing': r.id })}
        selectedKey="b"
      />,
    );
    const table = screen.getByRole('table', { name: 'Things' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Count']);
    expect(container.querySelectorAll('tbody tr[data-thing]')).toHaveLength(2);
    expect(container.querySelector('tr[data-thing="b"]')?.getAttribute('data-selected')).toBe(
      'true',
    );
    expect(container.querySelector('td[data-label="Count"]')?.textContent).toBe('1');
  });

  it('shows the empty state instead of an empty table', () => {
    render(
      <DataTable
        label="Things"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<EmptyState title="Nothing yet" />}
      />,
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });
});
