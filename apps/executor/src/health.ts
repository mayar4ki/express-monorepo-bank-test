import http from 'node:http';

import type { Redis } from '@bank/queue';

/**
 * Minimal health endpoint so orchestrators (compose healthcheck, k8s
 * probes) can watch the worker. 200 = redis reachable and worker running.
 */
export function startHealthServer(opts: {
  port: number;
  redis: Redis;
  isRunning: () => boolean;
}): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    void opts.redis
      .ping()
      .then(() => {
        if (opts.isRunning()) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'stopping' }));
        }
      })
      .catch(() => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'redis-unreachable' }));
      });
  });
  server.listen(opts.port);
  return server;
}
