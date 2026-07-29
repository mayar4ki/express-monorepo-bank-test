import { z } from 'zod';

export const registerBody = z
  .object({
    email: z.email().max(320).meta({ example: 'jane.doe@bank.local' }),
    password: z.string().min(8).max(200).meta({ description: 'Minimum 8 characters' }),
    name: z.string().trim().min(1).max(200).meta({ example: 'Jane Doe' }),
  })
  .meta({ id: 'Register' });

export const loginBody = z
  .object({
    email: z.email().max(320).meta({ example: 'admin@bank.local' }),
    password: z.string().min(1).max(200),
  })
  .meta({ id: 'Login' });

export const userResponse = z
  .object({
    id: z.uuid(),
    email: z.string().meta({ example: 'jane.doe@bank.local' }),
    name: z.string().meta({ example: 'Jane Doe' }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User' });

export const tokenResponse = z
  .object({
    token: z.string().meta({ description: 'JWT to send as `Authorization: Bearer <token>`' }),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().meta({ description: 'Token lifetime in seconds', example: 3600 }),
  })
  .meta({ id: 'Token' });

export const meResponse = z
  .object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
  })
  .meta({ id: 'Me' });

export const authHeaders = z.object({
  authorization: z
    .string()
    .regex(/^Bearer .+$/, 'Expected: Bearer <token>')
    .meta({ description: 'Bearer token issued by POST /auth/login' }),
});

export const jwksResponse = z
  .object({
    keys: z.array(z.record(z.string(), z.unknown())),
  })
  .meta({ id: 'Jwks' });
