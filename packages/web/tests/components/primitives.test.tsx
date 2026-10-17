import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BrandMark } from '../../src/components/BrandMark';
import { Button, buttonClass } from '../../src/components/Button';
import { Dialog } from '../../src/components/Dialog';
import { InfoIcon, TicketIcon } from '../../src/components/icons';
import { fieldClass, inputClass } from '../../src/components/Input';
import { Menu, MenuItem, MenuSeparator } from '../../src/components/Menu';
import { Badge } from '../../src/components/Pill';
import { Popover } from '../../src/components/Popover';
import { QueryView } from '../../src/components/QueryView';
import { Segmented } from '../../src/components/Segmented';
import { LoadingBlock, Skeleton, SkeletonText } from '../../src/components/Skeleton';
import { Tab, TabList, TabPanel, Tabs } from '../../src/components/Tabs';

describe('icons', () => {
  it('are decorative lucide strokes at 1.75px that add no text', () => {
    const { container } = render(
      <p>
        Tickets <TicketIcon /> <InfoIcon size={14} className="text-dim" />
      </p>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('stroke-width')).toBe('1.75');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
    }
    expect(svgs[0]?.getAttribute('width')).toBe('18');
    expect(svgs[1]?.getAttribute('width')).toBe('14');
    expect(svgs[1]?.getAttribute('class')).toContain('text-dim');
    expect(container.textContent).toBe('Tickets  ');
  });
});

describe('Button and fields', () => {
  it('keeps buttonClass, variants and sizes on tokens', () => {
    render(
      <Button variant="primary" size="sm">
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.className).toContain('bg-accent-fill');
    expect(buttonClass('danger')).toContain('text-danger');
    expect(buttonClass()).toContain('h-8');
  });

  it('shares one field style for native inputs', () => {
    expect(inputClass('max-w-48')).toBe(`w-full ${fieldClass} max-w-48`);
    expect(fieldClass).toContain('focus:border-accent');
    expect(fieldClass).not.toMatch(/\bw-full\b/);
  });

  it('Badge is a word without a dot', () => {
    const { container } = render(<Badge mono>WEB-12</Badge>);
    expect(container.textContent).toBe('WEB-12');
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });

  it('BrandMark is decorative', () => {
    const { container } = render(<BrandMark />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.firstElementChild?.getAttribute('style')).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});

function TabsHarness({ onChange }: { onChange?: (v: string) => void }) {
  const [tab, setTab] = useState<'chat' | 'files' | 'info'>('chat');
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        onChange?.(v);
        setTab(v);
      }}
    >
      <TabList label="Sections">
        <Tab value="chat">Chat</Tab>
        <Tab value="files">Files</Tab>
        <Tab value="info">Info</Tab>
      </TabList>
      <TabPanel value="chat">Chat panel</TabPanel>
      <TabPanel value="files">Files panel</TabPanel>
      <TabPanel value="info">Info panel</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('is a labelled tablist whose selected tab controls the visible panel', () => {
    render(<TabsHarness />);
    const list = screen.getByRole('tablist', { name: 'Sections' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Chat', 'Files', 'Info']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toBe('Chat panel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('selects on click (with or without a mousedown) and only reports real changes', () => {
    const onChange = vi.fn();
    render(<TabsHarness onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Files panel');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Info' }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Info panel');
    expect(onChange.mock.calls).toEqual([['files'], ['info']]);
  });

  it('moves and selects with the arrow keys and End', async () => {
    render(<TabsHarness />);
    const chat = screen.getByRole('tab', { name: 'Chat' });
    act(() => chat.focus());
    fireEvent.keyDown(chat, { key: 'ArrowRight' });
    const files = screen.getByRole('tab', { name: 'Files' });
    // Radix moves roving focus on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(files));
    expect(files.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(files, { key: 'End' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Info' })),
    );
    expect(screen.getByRole('tabpanel').textContent).toBe('Info panel');
  });
});

function DialogHarness({ withDescription = true }: { withDescription?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New ticket
      </button>
      {open ? (
        <Dialog
          title="New ticket"
          {...(withDescription ? { description: 'Add it to the backlog.' } : {})}
          onClose={() => setOpen(false)}
          testId="new-ticket"
          closeLabel="Close"
        >
          <input aria-label="Title" />
          <input aria-label="Labels" data-autofocus />
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </Dialog>
      ) : null}
    </>
  );
}

describe('Dialog', () => {
  it('is a labelled modal dialog that focuses [data-autofocus] and returns focus on close', async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'New ticket' });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'New ticket' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-testid')).toBe('new-ticket');
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Add it to the backlog.');
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Labels' })),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix returns focus just after the dialog unmounts.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('closes on Escape and from the close button', async () => {
    render(<DialogHarness withDescription={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps Tab inside the dialog', async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    const dialog = await screen.findByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    act(() => cancel.focus());
    fireEvent.keyDown(cancel, { key: 'Tab' });
    // Radix wraps focus from the last control back to the first.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});

function MenuHarness({ onPick }: { onPick: (v: string) => void }) {
  return (
    <Menu
      label="Move WEB-1"
      align="end"
      trigger={
        <button type="button" aria-label="Move WEB-1">
          Move
        </button>
      }
    >
      <MenuItem onSelect={() => onPick('READY')}>Move to Ready</MenuItem>
      <MenuItem onSelect={() => onPick('PLANNING')}>Start planning</MenuItem>
      <MenuSeparator />
      <MenuItem tone="danger" onSelect={() => onPick('CANCELLED')}>
        Cancel ticket
      </MenuItem>
    </Menu>
  );
}

describe('Menu', () => {
  it('opens with ArrowDown on the first item, moves with arrows, picks with Enter', async () => {
    const onPick = vi.fn();
    render(<MenuHarness onPick={onPick} />);
    const trigger = screen.getByRole('button', { name: 'Move WEB-1' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu', { name: 'Move WEB-1' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Move to Ready',
      'Start planning',
      'Cancel ticket',
    ]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('PLANNING');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens on pointer down and on a plain click, and Escape closes it', async () => {
    const onPick = vi.fn();
    render(<MenuHarness onPick={onPick} />);
    const trigger = screen.getByRole('button', { name: 'Move WEB-1' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(trigger);
    fireEvent.click(within(await screen.findByRole('menu')).getByText('Cancel ticket'));
    expect(onPick).toHaveBeenCalledWith('CANCELLED');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('Popover', () => {
  it('toggles a labelled panel from its trigger; Escape closes it', async () => {
    render(
      <Popover label="Filters" trigger={<button type="button">Filter</button>}>
        <a href="#/x">Only running</a>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'Filter' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(within(panel).getByRole('link', { name: 'Only running' })).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Segmented', () => {
  it('is a labelled group of pressed/unpressed buttons', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Range"
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ]}
        value="day"
        onChange={onChange}
        hideLabel
      />,
    );
    const group = screen.getByRole('group', { name: 'Range' });
    const [day, week] = within(group).getAllByRole('button');
    expect(day?.getAttribute('aria-pressed')).toBe('true');
    expect(week?.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(week as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('week');
  });
});

describe('Skeleton', () => {
  it('is decorative; LoadingBlock keeps the loading words for screen readers', () => {
    const { container } = render(
      <>
        <Skeleton className="h-4 w-20" />
        <SkeletonText lines={2} />
      </>,
    );
    expect(container.textContent).toBe('');
    for (const el of container.children) expect(el.getAttribute('aria-hidden')).toBe('true');
    render(<LoadingBlock label="Loading the board…" />);
    expect(screen.getByText('Loading the board…').className).toContain('sr-only');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('QueryView shows a skeleton with the loading words while there is no data', () => {
    const { container } = render(
      <QueryView query={{ data: undefined, error: null, fetching: true }} loading="Loading runs…">
        {() => <p>never</p>}
      </QueryView>,
    );
    expect(container.textContent).toBe('Loading runs…');
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
  });
});
