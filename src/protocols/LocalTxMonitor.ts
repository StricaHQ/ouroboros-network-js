import * as cbors from "@stricahq/cbors";
import { Socket } from "net";
import { LocalTxMonitorResponse } from "@stricahq/cardano-codec/dist/types/ouroborosTypes";
import EventEmitter from "events";
import Stream from "stream";
import PacketStreamer from "../PacketStreamer";
import localTxMonitorResponseParser from "../parser/localTxMonitor";

const LOCAL_TX_MONITOR = Buffer.from([0x00, 0x09]); // included protocol id

export declare interface LocalTxMonitor {
  on(event: "data", listener: (data: LocalTxMonitorResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

// eslint-disable-next-line no-redeclare
export class LocalTxMonitor extends EventEmitter {
  private LocalTxMonitorEncoderStream;

  constructor(socket: Socket, LocalTxMonitorDecoderStream: Stream.Readable) {
    super();
    this.LocalTxMonitorEncoderStream = new Stream.Readable({
      read() {},
    });

    const LocalTxMonitorStreamer = new PacketStreamer(LOCAL_TX_MONITOR);
    this.LocalTxMonitorEncoderStream.pipe(LocalTxMonitorStreamer);

    LocalTxMonitorStreamer.on("data", (packet: Buffer) => {
      socket.write(packet);
    });

    const localTxMonitorDecoder = new cbors.Decoder();
    LocalTxMonitorDecoderStream.pipe(localTxMonitorDecoder);

    localTxMonitorDecoder.on("data", (data: any) => {
      const response = localTxMonitorResponseParser(data.value);
      this.emit("data", response);
    });
  }

  acquireSnapshot = () => {
    const payload = [1];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.LocalTxMonitorEncoderStream.push(payloadBuffer);
  };

  requestNextTx = () => {
    const payload = [5];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.LocalTxMonitorEncoderStream.push(payloadBuffer);
  };

  done = () => {
    const payload = [0];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.LocalTxMonitorEncoderStream.push(payloadBuffer);
  };
}

export default LocalTxMonitor;
