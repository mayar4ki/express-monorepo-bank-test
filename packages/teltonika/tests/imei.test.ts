import { describe, expect, it } from 'vitest';

import { isValidImei, tryParseImeiFrame } from '../src/imei.js';
import { encodeImeiFrame } from '../src/testing.js';

const IMEI = '356938035643809';

describe('isValidImei', () => {
  it('accepts 15 digits', () => {
    expect(isValidImei(IMEI)).toBe(true);
  });

  it.each(['', '12345', '3569380356438090', '35693803564380X', ' 356938035643809'])(
    'rejects %o',
    (value) => {
      expect(isValidImei(value)).toBe(false);
    },
  );
});

describe('tryParseImeiFrame', () => {
  it('reads a complete handshake frame', () => {
    expect(tryParseImeiFrame(encodeImeiFrame(IMEI))).toEqual({
      status: 'ok',
      imei: IMEI,
      bytesConsumed: 17,
    });
  });

  it('leaves trailing bytes for the caller', () => {
    const buf = Buffer.concat([encodeImeiFrame(IMEI), Buffer.from('extra', 'ascii')]);
    const result = tryParseImeiFrame(buf);

    expect(result).toMatchObject({ status: 'ok', bytesConsumed: 17 });
  });

  it.each([0, 1, 2, 10, 16])('asks for more when only %i byte(s) arrived', (length) => {
    const partial = encodeImeiFrame(IMEI).subarray(0, length);
    expect(tryParseImeiFrame(partial)).toEqual({ status: 'need-more' });
  });

  it('rejects a declared length other than 15', () => {
    const result = tryParseImeiFrame(encodeImeiFrame('1234567890'));
    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('rejects 15 non-digit bytes', () => {
    const result = tryParseImeiFrame(encodeImeiFrame('abcdefghijklmno'));
    expect(result).toMatchObject({ status: 'invalid' });
  });
});
