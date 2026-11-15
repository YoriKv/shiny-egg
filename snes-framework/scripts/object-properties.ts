// Codec for the standard-object property table in Bank12.asm: 256 bytes, one
// per standard-object ID. The low two bits select which size bytes an object
// record carries (see the table's header comment in Bank12.asm). The table is
// a plain `db` run inside its `;@editable` region.

import { findRegionDataBytes } from './asm/data-words.ts';
import { findRegion } from './asm/markers.ts';
import type { ObjectPropertiesModel } from './types.ts';

export const OBJECT_PROPERTIES_BANK_FILE = 'yi/Banks/Bank12.asm';
export const OBJECT_PROPERTIES_REGION = 'object-properties';
export const OBJECT_PROPERTIES_LABEL = 'DATA_object_property_table';
export const OBJECT_PROPERTIES_SIZE = 256;

/** The table's bytes from Bank12.asm text, or null when the text lacks the
 *  region. Throws when the region holds the wrong number of bytes. */
export function objectPropertiesFromAsm(text: string): Uint8Array | null {
  if (!findRegion(text, OBJECT_PROPERTIES_REGION)) return null;
  const bytes = findRegionDataBytes(text, OBJECT_PROPERTIES_REGION, OBJECT_PROPERTIES_LABEL);
  if (bytes.length !== OBJECT_PROPERTIES_SIZE) {
    throw new Error(
      `${OBJECT_PROPERTIES_LABEL} has ${bytes.length} bytes; expected ${OBJECT_PROPERTIES_SIZE}.`
    );
  }
  return Uint8Array.from(bytes, (b) => b.value);
}

/** The table's cart bytes for a model. Throws unless it is 256 byte values. */
export function objectPropertiesBytes(model: ObjectPropertiesModel): Uint8Array {
  const values = model?.bytes;
  if (!Array.isArray(values) || values.length !== OBJECT_PROPERTIES_SIZE) {
    throw new RangeError(`Expected ${OBJECT_PROPERTIES_SIZE} object property bytes.`);
  }
  values.forEach((v, id) => {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) {
      throw new RangeError(`Object 0x${id.toString(16)}: property ${v} is outside 0x00-0xFF.`);
    }
  });
  return Uint8Array.from(values);
}
