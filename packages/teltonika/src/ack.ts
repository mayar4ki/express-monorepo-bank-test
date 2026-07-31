/**
 * Handshake reply: 0x01 accepts the device and lets it start streaming,
 * 0x00 rejects it (the device then closes and retries later).
 */
export function buildImeiAck(accepted: boolean): Buffer {
  return Buffer.from([accepted ? 0x01 : 0x00]);
}

/**
 * Data reply: the number of AVL records we took responsibility for. The
 * device only clears its flash buffer for acknowledged records, so acking 0
 * makes it resend the whole packet.
 */
export function buildRecordAck(recordCount: number): Buffer {
  const ack = Buffer.alloc(4);
  ack.writeUInt32BE(recordCount, 0);
  return ack;
}
