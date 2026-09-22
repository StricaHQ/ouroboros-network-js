import { Transform, type TransformCallback } from "node:stream";
import { createProtocolPacket } from "./protocol";

// the most payload one mux segment carries, the node's maximum SDU size
const MAX_PAYLOAD_LENGTH = 12288;

/**
 * Transform that frames the outgoing messages of one mini protocol into mux
 * segments: every chunk written is cut into payloads of at most
 * `MAX_PAYLOAD_LENGTH` bytes and each gets the 8 byte header in front.
 */
export class PacketStreamer extends Transform {
  private protocol: Buffer;

  constructor(protocol: Buffer) {
    super();
    this.protocol = protocol;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, cb: TransformCallback) {
    for (let offset = 0; offset < chunk.length; offset += MAX_PAYLOAD_LENGTH) {
      const payload = chunk.subarray(offset, offset + MAX_PAYLOAD_LENGTH);
      this.push(createProtocolPacket(payload, this.protocol));
    }
    cb();
  }
}

export default PacketStreamer;
