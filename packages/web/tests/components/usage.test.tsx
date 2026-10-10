import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EstimatedCost } from '../../src/components/EstimatedCost';
import { ProvenanceBadge } from '../../src/components/ProvenanceBadge';
import { TokenCount } from '../../src/components/TokenCount';
import { UsageComparison, UsageTotals } from '../../src/components/UsageTotals';
import { partialUsage, usage } from '../fixtures/dto';

describe('TokenCount', () => {
  it('renders null as "unavailable", never 0', () => {
    const { container } = render(
      <TokenCount value={null} unavailableRecords={3} recordCount={3} />,
    );
    expect(container.textContent).toBe('unavailable');
    expect(container.textContent).not.toContain('0');
  });

  it('marks a sum as partial when some records lacked the category', () => {
    const { container } = render(
      <TokenCount value={5000} unavailableRecords={1} recordCount={3} />,
    );
    const el = container.querySelector('[data-state]');
    expect(el?.getAttribute('data-state')).toBe('partial');
    expect(container.textContent).toContain('5,000');
    expect(container.textContent).toContain('partial');
    expect(el?.getAttribute('title')).toContain('1 of 3 records');
  });

  it('renders a real zero as 0 (observed zero is not unavailable)', () => {
    const { container } = render(<TokenCount value={0} />);
    expect(container.textContent).toBe('0');
  });
});

describe('UsageTotals', () => {
  it('shows each category with its own unavailable/partial state', () => {
    render(<UsageTotals usage={partialUsage} title="Direct usage" />);
    const section = screen.getByRole('region', { name: 'Direct usage' });
    const cell = (k: string) => section.querySelector(`[data-category="${k}"]`)?.textContent;
    expect(cell('input')).toBe('10');
    expect(cell('cacheCreation')).toBe('unavailable');
    expect(cell('cacheRead')).toContain('partial');
    expect(section.textContent).toContain('derived');
  });

  it('shows direct and aggregate separately and never adds them', () => {
    const direct = usage({
      tokens: { input: 100, output: 200, cacheCreation: null, cacheRead: 300 },
      recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 4, cacheRead: 0 },
    });
    const aggregate = usage({
      tokens: { input: 1000, output: 2000, cacheCreation: 50, cacheRead: 3000 },
      recordCount: 12,
      recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 4, cacheRead: 0 },
    });
    render(<UsageComparison direct={direct} aggregate={aggregate} />);
    const d = within(screen.getByTestId('usage-direct'));
    const a = within(screen.getByTestId('usage-aggregate'));
    expect(d.getByText('Direct usage')).toBeTruthy();
    expect(a.getByText('Aggregate usage')).toBeTruthy();
    expect(
      screen.getByTestId('usage-direct').querySelector('[data-category="input"]')?.textContent,
    ).toBe('100');
    expect(
      screen.getByTestId('usage-aggregate').querySelector('[data-category="input"]')?.textContent,
    ).toBe('1,000');
    // The sum (1,100) must not appear anywhere.
    expect(document.body.textContent).not.toContain('1,100');
    expect(
      screen.getByTestId('usage-direct').querySelector('[data-category="cacheCreation"]')
        ?.textContent,
    ).toBe('unavailable');
    expect(
      screen.getByTestId('usage-aggregate').querySelector('[data-category="cacheCreation"]')
        ?.textContent,
    ).toContain('partial');
  });
});

describe('estimated values', () => {
  it('labels provider-reported cost as estimated and styles it differently', () => {
    const { container } = render(<EstimatedCost cost={{ provenance: 'estimated', value: 1.5 }} />);
    expect(container.textContent).toContain('estimated (provider-reported)');
    expect(container.textContent).toContain('$1.50');
    expect(container.querySelector('.italic')).not.toBeNull();
    const observed = render(<ProvenanceBadge provenance="observed" />).container.firstElementChild;
    const estimated = container.querySelector('[data-provenance="estimated"]');
    expect(estimated?.className).not.toBe(observed?.className);
  });

  it('shows missing cost as unavailable, never $0', () => {
    const { container } = render(
      <EstimatedCost cost={{ provenance: 'unavailable', value: null }} />,
    );
    expect(container.textContent).toContain('cost unavailable');
    expect(container.textContent).not.toContain('$0');
  });
});
