import { Transform, type TransformCallback } from "node:stream";
import { IncrementalDecoder, type CborNode } from "@stricahq/cbors";

/**
 * A completed top-level CBOR item: `value` is its annotation tree, `bytes` the
 * item's own buffer. The tree's nodes are zero-copy views into that buffer and
 * stay valid after the stream has moved on.
 */
export type AnnotatedItem = {
  value: CborNode;
  bytes: Uint8Array;
};

/**
 * Object mode Transform that decodes the byte stream of one mini protocol into
 * one `AnnotatedItem` per completed message. Chunk boundaries can fall
 * anywhere, including in the middle of a message.
 */
export class CborDecoderStream extends Transform {
  private decoder = IncrementalDecoder.annotated();

  constructor() {
    super({
      writableObjectMode: false,
      readableObjectMode: true,
    });
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, cb: TransformCallback) {
    try {
      for (const item of this.decoder.push(chunk)) {
        this.push(item);
      }
      cb();
    } catch (error) {
      cb(error as Error);
    }
  }

  _flush(cb: TransformCallback) {
    try {
      this.decoder.end();
      cb();
    } catch (error) {
      cb(error as Error);
    }
  }
}

export default CborDecoderStream;
