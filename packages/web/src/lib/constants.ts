/** Every API path starts here. In dev, Vite proxies it to the server; in production the server serves both. */
export const API_BASE = '/api';

/**
 * Header the Vite dev proxy adds when the server is down (vite.config.ts), so the client can tell
 * "server not running" apart from a real server error.
 */
export const PROXY_ERROR_HEADER = 'x-acp-proxy-error';

/** Shown wherever the API cannot be reached. */
export const UNREACHABLE_HINT = 'start it with `pnpm dev`';
