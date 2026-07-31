/**
 * CRC-16/IBM (a.k.a. CRC-16/ARC): reflected polynomial 0xA001, zero init,
 * no final xor. Teltonika appends this over the AVL data field, zero-padded
 * to four bytes.
 */
export function crc16ibm(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
