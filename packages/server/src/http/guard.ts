import type { RequestHandler } from 'express';

/**
 * The server only serves the local user, so it refuses anything a web page on another origin could
 * send: DNS-rebinding requests (non-loopback Host), cross-origin requests (an Origin that is neither
 * this server nor the local web dev server), and CORS preflights. Same-origin and non-browser
 * clients (no Origin header, e.g. curl or Claude Code hooks) pass. No CORS headers are ever added.
 */
export function localOnlyGuard(allowedOriginPorts: readonly number[]): RequestHandler {
  const ports = new Set(allowedOriginPorts.map(String));
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

  const split = (hostPort: string): { host: string; port: string } => {
    const i = hostPort.lastIndexOf(':');
    const hasPort = i > hostPort.lastIndexOf(']');
    return hasPort
      ? { host: hostPort.slice(0, i), port: hostPort.slice(i + 1) }
      : { host: hostPort, port: '80' };
  };

  return (req, res, next) => {
    const reject = (reason: string) => {
      res.status(403).json({
        error: {
          code: 'forbidden_origin',
          message: reason,
          requestId: String(res.locals['requestId'] ?? 'unknown'),
        },
      });
    };
    const hostHeader = req.headers.host;
    if (hostHeader === undefined || !loopback.has(split(hostHeader).host)) {
      return reject('Unexpected Host header');
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let ok: boolean;
      try {
        const u = new URL(origin);
        const { host, port } = split(u.host);
        ok =
          u.protocol === 'http:' &&
          (u.host === hostHeader || (loopback.has(host) && ports.has(port)));
      } catch {
        ok = false;
      }
      if (!ok) return reject('Cross-origin requests are not allowed');
    }
    if (req.method === 'OPTIONS') return reject('CORS preflight is not supported');
    next();
  };
}
