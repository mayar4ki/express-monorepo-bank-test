import { z } from 'zod';

export const DevicePingSchema = z.object({
  deviceId: z.string(),
  speedKph: z.number().nonnegative(),
  ts: z.string().datetime(),
});

export type DevicePing = z.infer<typeof DevicePingSchema>;

/**
 * A whole pings file. Owning this here keeps "what a valid pings document looks
 * like" in one place, so consumers validate a file without depending on zod.
 */
export const DevicePingsSchema = z.array(DevicePingSchema);

export type DevicePings = z.infer<typeof DevicePingsSchema>;
