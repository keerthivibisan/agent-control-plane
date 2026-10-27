import { MAX_ATTACHMENTS_PER_TICKET } from '@acp/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { attachment } from '../../e2e/activity-fixtures';
import { CSRF } from '../../e2e/review-loop-fixtures';
import { NewTicketDialog } from '../../src/features/board/NewTicketDialog';
import { ATTACHMENT_COPY } from '../../src/features/activity/copy';
import { BOARD_COPY } from '../../src/lib/copy';
import type { FetchLike } from '../../src/lib/api';
import { PROJECT_ID, harnessTicket, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * Files picked in New ticket (ADR-0026 §4): staged and checked in the browser, uploaded one by one
 * once the ticket exists. Fake clients only.
 */

const P = `/api/projects/${PROJECT_ID}`;
const TICKET = harnessTicket();
const UPLOAD_PATH = `/api/tickets/${TICKET.id}/attachments`;
const D = BOARD_COPY.dialog;
const A = ATTACHMENT_COPY;

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/**
 * A fake API that also records the raw (file) bodies. `failNames` are refused with a 500;
 * `hold` makes the first upload wait until `release` is called.
 */
function server({ failNames = [] as string[], hold = false } = {}) {
  const base = fakeServer({
    '/api/control/token': { token: CSRF },
    [`${P}/setup`]: setup({}),
    [`POST ${P}/tickets`]: TICKET,
  });
  const order: Seen[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetch: FetchLike = async (input, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && input === UPLOAD_PATH) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const name = decodeURIComponent(headers['X-Attachment-Name'] ?? '');
      order.push({ method, path: input, body: init?.body });
      if (hold) await gate;
      if (failNames.includes(name)) {
        return jsonResponse(500, { error: { code: 'internal', message: 'boom', requestId: 'r' } });
      }
      return jsonResponse(201, attachment({ id: `att-${name}`, name, mimeType: 'text/plain' }));
    }
    if (method === 'POST' && input === `${P}/tickets`)
      order.push({ method, path: input, body: null });
    return base.fetch(input, init);
  };
  return {
    fetch,
    calls: base.calls,
    uploads: order.filter((o) => o.path === UPLOAD_PATH),
    order,
    release,
  };
}

function open(s: ReturnType<typeof server>, onCreated = vi.fn()) {
  renderWithApi(
    <NewTicketDialog projectId={PROJECT_ID} onClose={() => undefined} onCreated={onCreated} />,
    s,
  );
  const dialog = screen.getByRole('dialog', { name: 'New ticket' });
  fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'With files' } });
  return { dialog, onCreated, input: within(dialog).getByTestId('attachment-input') };
}

const pdf = () => new File(['%PDF-1.4'], 'spec.pdf', { type: 'application/pdf' });
const png = () => new File(['png-bytes'], 'shot.png', { type: 'image/png' });
const create = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: D.create }));

describe('New ticket: staging files', () => {
  it('stages a PDF and a PNG from the browse input, with name, size and remove', () => {
    const { dialog, input } = open(server());
    expect(within(dialog).getByRole('button', { name: A.attach })).toBeTruthy();
    expect(input.getAttribute('multiple')).not.toBeNull();
    fireEvent.change(input, { target: { files: [pdf(), png()] } });
    const rows = within(dialog).getAllByTestId('upload');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['staged', 'staged']);
    expect(rows[0]?.textContent).toContain('spec.pdf');
    expect(rows[0]?.textContent).toContain('8 B');
    expect(rows[1]?.textContent).toContain('shot.png');
    expect(within(dialog).getByRole('button', { name: A.remove('spec.pdf') })).toBeTruthy();
  });

  it('stages files dropped on the zone', () => {
    const { dialog } = open(server());
    fireEvent.drop(within(dialog).getByTestId('new-ticket-drop'), {
      dataTransfer: { types: ['Files'], files: [pdf()] },
    });
    expect(within(dialog).getAllByTestId('upload')).toHaveLength(1);
  });

  it('refuses a wrong type, an empty file and an oversized one, and never uploads them', async () => {
    const s = server();
    const { dialog, input, onCreated } = open(s);
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(input, {
      target: {
        files: [
          new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
          new File([], 'empty.txt', { type: 'text/plain' }),
          big,
        ],
      },
    });
    const rows = within(dialog).getAllByTestId('upload');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['failed', 'failed', 'failed']);
    expect(rows[0]?.textContent).toContain(A.refused.type('logo.svg'));
    expect(rows[1]?.textContent).toContain(A.refused.empty('empty.txt'));
    expect(rows[2]?.textContent).toContain(A.refused.tooBig('huge.png'));
    create(dialog);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(s.uploads).toHaveLength(0);
  });

  it('counts staged files against the ticket limit', () => {
    const { dialog, input } = open(server());
    const many = Array.from(
      { length: MAX_ATTACHMENTS_PER_TICKET + 1 },
      (_, i) => new File(['a'], `n${i}.txt`, { type: 'text/plain' }),
    );
    fireEvent.change(input, { target: { files: many } });
    const rows = within(dialog).getAllByTestId('upload');
    expect(rows.filter((r) => r.getAttribute('data-status') === 'staged')).toHaveLength(
      MAX_ATTACHMENTS_PER_TICKET,
    );
    const failed = rows.filter((r) => r.getAttribute('data-status') === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.textContent).toContain(A.refused.tooMany);
  });

  it('removes a staged file so it is not uploaded', async () => {
    const s = server();
    const { dialog, input, onCreated } = open(s);
    fireEvent.change(input, { target: { files: [pdf(), png()] } });
    fireEvent.click(within(dialog).getByRole('button', { name: A.remove('spec.pdf') }));
    expect(within(dialog).getAllByTestId('upload')).toHaveLength(1);
    create(dialog);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(s.uploads).toHaveLength(1);
  });
});

describe('New ticket: uploading after the ticket exists', () => {
  it('creates the ticket, then uploads each file in order, then calls onCreated', async () => {
    const s = server();
    const { dialog, input, onCreated } = open(s);
    const files = [pdf(), png()];
    fireEvent.change(input, { target: { files } });
    create(dialog);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(TICKET));
    expect(s.order.map((o) => o.path)).toEqual([`${P}/tickets`, UPLOAD_PATH, UPLOAD_PATH]);
    expect(s.uploads.map((u) => u.body)).toEqual(files);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog busy and Create disabled while files upload', async () => {
    const s = server({ hold: true });
    const { dialog, input, onCreated } = open(s);
    fireEvent.change(input, { target: { files: [pdf()] } });
    create(dialog);
    const button = await within(dialog).findByRole('button', { name: D.attachmentsUploading });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByRole('button', { name: D.cancel }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(within(dialog).getByTestId('upload').getAttribute('data-status')).toBe('uploading');
    expect(onCreated).not.toHaveBeenCalled();
    s.release();
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('reports files that could not be attached and lets the owner continue', async () => {
    const s = server({ failNames: ['shot.png'] });
    const { dialog, input, onCreated } = open(s);
    fireEvent.change(input, { target: { files: [pdf(), png()] } });
    create(dialog);
    const note = await within(dialog).findByTestId('attachments-partial');
    expect(note.textContent).toContain(D.attachmentsPartial(1));
    expect(note.textContent).toContain('shot.png');
    expect(note.textContent).not.toContain('spec.pdf');
    expect(s.uploads).toHaveLength(2);
    expect(onCreated).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('button', { name: D.create })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: D.openTicket }));
    expect(onCreated).toHaveBeenCalledWith(TICKET);
    // The ticket was created once only.
    expect(s.order.filter((o) => o.path === `${P}/tickets`)).toHaveLength(1);
  });
});
