import { z } from 'zod';

/** Path-parameter id: a UUID. */
export const idSchema = z
  .uuid()
  .meta({ description: 'UUID identifier', example: '00000000-0000-4000-8000-000000000001' });

export const errorEnvelope = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'ACCOUNT_NOT_FOUND' }),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .meta({ id: 'ErrorEnvelope' });
