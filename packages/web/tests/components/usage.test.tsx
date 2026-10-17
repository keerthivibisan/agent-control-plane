import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProvenanceBadge } from '../../src/components/ProvenanceBadge';
import { TokenCount } from '../../src/components/TokenCount';

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

describe('ProvenanceBadge', () => {
  it('styles estimated values differently from observed ones (italic, dashed), with tokens only', () => {
    const estimated = render(<ProvenanceBadge provenance="estimated" />).container
      .firstElementChild;
    const observed = render(<ProvenanceBadge provenance="observed" />).container.firstElementChild;
    expect(estimated?.getAttribute('data-provenance')).toBe('estimated');
    expect(estimated?.textContent).toBe('estimated');
    expect(estimated?.className).toContain('italic');
    expect(estimated?.className).toContain('border-dashed');
    expect(estimated?.className).not.toBe(observed?.className);
    // No raw Tailwind palette colors: every color comes from a theme token.
    for (const el of [estimated, observed]) {
      expect(el?.className).not.toMatch(/\b(emerald|sky|amber|red)-\d/);
    }
  });
});
