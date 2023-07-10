/* eslint-disable no-bitwise */
/* eslint-disable no-underscore-dangle */
import { Stream } from "stream";
import BufferList from "@stricahq/buffer-list";

class DeMux extends Stream.Transform {
  private bl: any;

  private needed: number = 0;

  private fresh: boolean = true;

  private _parser = this.parse();

  private protocol = 0;

  constructor() {
    super({
      writableObjectMode: false,
      readableObjectMode: true,
    });
    this.bl = new BufferList({ flexible: false });
  }

  _transform(fresh: any, encoding: any, cb: any) {
    this.bl.push(fresh);

    while (this.bl.length >= this.needed) {
      let ret = null;
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
        this.push({
          protocol: this.protocol,
          bytes: ret.value,
        });
        this.restart();
      } else {
        this.needed = ret.value || Infinity;
      }
    }

    return cb();
  }

  private *parse(): Generator<number, any, Buffer> {
    yield 4; // timestamp
    let protocolIdBuffer = (yield 2).readUInt16BE();
    const mask = 1 << 15;
    protocolIdBuffer &= ~mask; // clear the M bit
    this.protocol = protocolIdBuffer;

    const payloadLength = (yield 2).readUInt16BE();
    const payload = yield payloadLength;
    return payload;
  }

  private restart() {
    this.needed = 0;
    this._parser = this.parse();
    this.protocol = 0;
    this.fresh = true;
  }

  _flush(cb: any) {
    cb(this.fresh ? null : new Error("unexpected end of input"));
  }
}

export default DeMux;
