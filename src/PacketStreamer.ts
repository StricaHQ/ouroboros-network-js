import Stream from "stream";
import BufferList from "@stricahq/buffer-list";
import { createProtocolPacket } from "./protocol";

export class PacketStreamer extends Stream.Transform {
  private bl: any;

  private needed: number = 0;

  private fresh: boolean = true;

  private _parser = this.parse();

  private protocol = Buffer.alloc(0);

  constructor(protocol: Buffer) {
    super();
    this.protocol = protocol;
    this.bl = new BufferList({ flexible: true });
  }

  _transform(fresh: any, encoding: any, cb: any) {
    this.bl.push(fresh);

    while (this.bl.length > 0) {
      let ret: null | IteratorResult<number, Buffer> = null;
      let chunk;

      if (this.needed === 0) {
        chunk = undefined;
      } else {
        chunk = this.bl.read(this.needed);
      }

      try {
        ret = this._parser.next(chunk);
      } catch (e) {
        return cb(e);
      }

      if (this.needed > 0) {
        this.fresh = false;
      }

      if (ret.done) {
        this.push(ret.value);
        this.restart();
      } else {
        this.needed = ret.value || Infinity;
      }
    }

    return cb();
  }

  private *parse(): Generator<number, any, Buffer> {
    // 8 byte header created by packet
    const payload = yield 12288;
    const packet = createProtocolPacket(payload, this.protocol);
    return packet;
  }

  private restart() {
    this.needed = 0;
    this._parser = this.parse();
    this.fresh = true;
  }

  _flush(cb: any) {
    cb(this.fresh ? null : new Error("unexpected end of input"));
  }
}

export default PacketStreamer;
