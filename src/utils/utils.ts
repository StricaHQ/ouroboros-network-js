import type { CborNode } from "@stricahq/cbors";

/** Wraps a `Uint8Array` as a `Buffer` over the same memory, without copying. */
export const toBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const toHex = (bytes: Uint8Array): string => toBuffer(bytes).toString("hex");

/**
 * Unwraps `#6.24(bytes .cbor item)`, the CBOR-in-CBOR wrapping the node uses
 * for blocks and transactions, returning the inner item's bytes exactly as
 * received so they can be hashed or decoded without a re-encode.
 */
export const unwrapCborInCbor = (node: CborNode | undefined): Buffer => {
  if (node?.kind !== "tag" || node.tag !== 24 || node.child?.kind !== "bytes") {
    throw new Error("Expected a CBOR-in-CBOR (tag 24) wrapped item");
  }
  return toBuffer(node.child.toJS());
};
