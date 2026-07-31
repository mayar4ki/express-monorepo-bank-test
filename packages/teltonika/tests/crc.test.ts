import { describe, expect, it } from 'vitest';

import { crc16ibm } from '../src/crc.js';
import { CODEC8_SINGLE_RECORD_HEX } from './fixtures.js';

describe('crc16ibm', () => {
  it('matches the CRC a real device sent with its packet', () => {
    const frame = Buffer.from(CODEC8_SINGLE_RECORD_HEX, 'hex');
    const dataLength = frame.readUInt32BE(4);
    const dataField = frame.subarray(8, 8 + dataLength);

    expect(crc16ibm(dataField)).toBe(frame.readUInt32BE(8 + dataLength));
    expect(crc16ibm(dataField)).toBe(0xc7cf);
  });

  it('matches the published CRC-16/ARC check value', () => {
    expect(crc16ibm(Buffer.from('123456789', 'ascii'))).toBe(0xbb3d);
  });

  it('is zero for empty input', () => {
    expect(crc16ibm(Buffer.alloc(0))).toBe(0);
  });

  it('changes when any byte changes', () => {
    const base = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const flipped = Buffer.from([0x01, 0x02, 0x03, 0x05]);
    expect(crc16ibm(base)).not.toBe(crc16ibm(flipped));
  });

  it('stays within 16 bits for long input', () => {
    expect(crc16ibm(Buffer.alloc(4096, 0xff))).toBeLessThanOrEqual(0xffff);
  });
});
