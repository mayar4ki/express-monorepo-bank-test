import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { Db } from '@bank/db';
import type { TokenVerifier } from '../../src/middleware/auth.js';
import type { TransfersQueue } from '@bank/queue';

// CORS headers are set by middleware before any route touches the database
// or the queue, so stubs are enough to exercise them.
const stubDb = {} as Db;
const stubQueue = {} as TransfersQueue;
const stubVerifier = {} as TokenVerifier;

describe('CORS', () => {
  it('allows preflight requests from an allowlisted origin', async () => {
    const { app } = createApp({
      db: stubDb,
      transfersQueue: stubQueue,
      verifier: stubVerifier,
      corsAllowedOrigins: ['https://ops.example.com'],
    });

    const res = await request(app)
      .options('/accounts')
      .set('Origin', 'https://ops.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://ops.example.com');
  });

  it('does not allow origins outside the allowlist', async () => {
    const { app } = createApp({
      db: stubDb,
      transfersQueue: stubQueue,
      verifier: stubVerifier,
      corsAllowedOrigins: ['https://ops.example.com'],
    });

    const res = await request(app)
      .options('/accounts')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('denies all cross-origin access by default', async () => {
    const { app } = createApp({ db: stubDb, transfersQueue: stubQueue, verifier: stubVerifier });

    const res = await request(app)
      .options('/accounts')
      .set('Origin', 'https://ops.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
