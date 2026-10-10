/** Typed errors thrown by services. Only the error middleware maps them to HTTP (AGENTS.md §6). */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request'): HttpError =>
  new HttpError(400, code, message);
export const notFound = (message: string): HttpError => new HttpError(404, 'not_found', message);
