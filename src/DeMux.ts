import { Transform, type TransformCallback } from "node:stream";

// mux segment (SDU) header: 4 byte timestamp, 2 byte mini protocol id with the
// M bit on top, 2 byte payload length
const HEADER_LENGTH = 8;

/** Default `sduTimeout`, 30 seconds: the same limit the node's own mux applies. */
export const DEFAULT_SDU_TIMEOUT = 30_000;

// the longest delay a node timer takes
const MAX_TIMEOUT = 2 ** 31 - 1;

const EMPTY = Buffer.alloc(0);

export type Segment = {
  protocol: number;
  bytes: Buffer;
};

export type DeMuxOptions = {
  /**
   * Milliseconds the rest of a segment may take to arrive once its first bytes
   * have, `DEFAULT_SDU_TIMEOUT` unless given. `0` or `Infinity` turns the limit
   * off.
   */
  sduTimeout?: number;
};

/**
 * The connection stalled in the middle of a mux segment: the rest of it did not
 * arrive within `sduTimeout`.
 */
export class SduReadTimeoutError extends Error {
  constructor(sduTimeout: number, received: number) {
    super(
      `mux SDU read timeout: a segment did not arrive whole within ${sduTimeout}ms (${received} bytes so far)`
    );
    this.name = "SduReadTimeoutError";
  }
}

/**
 * Object mode Transform that splits the byte stream from the node back into
 * mux segments, emitting one `{ protocol, bytes }` per segment. Chunk
 * boundaries can fall anywhere, including inside a header.
 *
 * A segment that lies whole inside a chunk is emitted as a view of that chunk;
 * only one straddling chunks is copied into a buffer of its own.
 *
 * The wait for a segment to start is unbounded, an idle connection is
 * legitimate. Once one has started, the rest of it has to arrive within
 * `sduTimeout`, or the stream fails with an `SduReadTimeoutError`.
 */
class DeMux extends Transform {
  // the start of a segment that is not whole yet
  private carry: Buffer = EMPTY;
  // milliseconds, 0 for no limit
  private sduTimeout: number;
  // runs while `carry` holds the start of a segment
  private clock: NodeJS.Timeout | null = null;

  constructor(options: DeMuxOptions = {}) {
    super({
      writableObjectMode: false,
      readableObjectMode: true,
    });
    const sduTimeout = options.sduTimeout ?? DEFAULT_SDU_TIMEOUT;
    this.sduTimeout =
      Number.isFinite(sduTimeout) && sduTimeout > 0 ? Math.min(sduTimeout, MAX_TIMEOUT) : 0;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, cb: TransformCallback) {
    let offset = this.carry.length > 0 ? this.completeCarried(chunk) : 0;
    if (this.carry.length > 0) return cb(); // the whole chunk went into it and it is still short

    while (chunk.length - offset >= HEADER_LENGTH) {
      const length = HEADER_LENGTH + chunk.readUInt16BE(offset + 6);
      if (chunk.length - offset < length) break;
      this.pushSegment(chunk.subarray(offset, offset + length));
      offset += length;
    }

    if (offset < chunk.length) {
      this.carry = chunk.subarray(offset);
      this.startClock();
    }
    return cb();
  }

  // completes the carried segment from the front of the chunk and returns how
  // much of the chunk that took. The header has to be whole before the payload
  // length is known.
  private completeCarried(chunk: Buffer): number {
    let offset = 0;
    if (this.carry.length < HEADER_LENGTH) {
      offset = this.fill(chunk, offset, HEADER_LENGTH);
      if (this.carry.length < HEADER_LENGTH) return offset;
    }
    const length = HEADER_LENGTH + this.carry.readUInt16BE(6);
    offset = this.fill(chunk, offset, length);
    if (this.carry.length === length) {
      this.stopClock();
      this.pushSegment(this.carry);
      this.carry = EMPTY;
    }
    return offset;
  }

  // moves bytes from the chunk into the carry until it is `target` long or the
  // chunk runs out, returning the new chunk offset
  private fill(chunk: Buffer, offset: number, target: number): number {
    const take = Math.min(target - this.carry.length, chunk.length - offset);
    if (take === 0) return offset;
    this.carry = Buffer.concat([this.carry, chunk.subarray(offset, offset + take)]);
    return offset + take;
  }

  private pushSegment(segment: Buffer) {
    const item: Segment = {
      protocol: segment.readUInt16BE(4) & 0x7fff, // clear the M bit
      bytes: segment.subarray(HEADER_LENGTH),
    };
    this.push(item);
  }

  // gives the segment now starting in `carry` its `sduTimeout` to arrive whole.
  // Further bytes of it do not extend that, only its completion stops the clock.
  private startClock() {
    if (this.sduTimeout === 0) return;
    this.clock = setTimeout(() => {
      this.clock = null;
      this.destroy(new SduReadTimeoutError(this.sduTimeout, this.carry.length));
    }, this.sduTimeout);
    // a pending segment must not keep a process alive on its own
    this.clock.unref();
  }

  private stopClock() {
    if (this.clock === null) return;
    clearTimeout(this.clock);
    this.clock = null;
  }

  _flush(cb: TransformCallback) {
    this.stopClock();
    cb(this.carry.length > 0 ? new Error("unexpected end of input") : null);
  }

  _destroy(error: Error | null, cb: (error: Error | null) => void) {
    this.stopClock();
    cb(error);
  }
}

export default DeMux;
