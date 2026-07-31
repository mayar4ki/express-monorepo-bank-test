/**
 * Ground-truth bytes captured from real Teltonika output. These pin the parser
 * (and the test encoder in `src/testing.ts`) to what devices actually send —
 * everything else in the suite is generated, so a wrong digit here is the only
 * transcription risk left, and the assertions below spell out every decoded
 * field so a bad byte cannot pass unnoticed.
 */

/**
 * Codec 8, one record, no GPS fix, five IO elements across all four widths.
 * Its trailing CRC (0x0000c7cf) is the value the device sent and it matches
 * our CRC-16/IBM implementation exactly — this is the anchor for the whole
 * codec, so do not regenerate it.
 */
export const CODEC8_SINGLE_RECORD_HEX =
  '000000000000003608010000016B40D8EA30010000000000000000000000000000000105021503010101425E0F01F10000601A014E0000000000000000010000C7CF';

/**
 * Codec 8 Extended, one record, no GPS fix, five IO elements and an empty
 * variable-length section. The data field is real device output — its declared
 * length (74) and its total-IO count (5) both agree with the bytes, which is
 * what makes it trustworthy — but the CRC is recomputed by
 * {@link withRecomputedCrc} because the captured trailing CRC could not be
 * confirmed. Treat the data field as ground truth and the CRC as derived.
 */
export const CODEC8E_SINGLE_RECORD_DATA_HEX =
  '8E010000016B412CEE000100000000000000000000000000000000010005000100010100010011001D00010010015E2C880002000B000000003544C87A000E000000001DD7E06A000001';
