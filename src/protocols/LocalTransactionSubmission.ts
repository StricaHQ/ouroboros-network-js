// [0, [eraNumber, 24 tag txCborHex]]

import * as cbors from "@stricahq/cbors";
import { Socket } from "net";
import { LocalTransactionSubmissionResponse } from "@stricahq/cardano-codec/dist/types/ouroborosTypes";
import EventEmitter from "events";
import Stream from "stream";
import PacketStreamer from "../PacketStreamer";
import localTransactionSubmissionResponse from "../parser/localTransactionSubmission";

const LOCAL_TX_SUBMISSION = Buffer.from([0x00, 0x06]); // included protocol id

export declare interface LocalTransactionSubmission {
  on(event: "data", listener: (data: LocalTransactionSubmissionResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

// eslint-disable-next-line no-redeclare
export class LocalTransactionSubmission extends EventEmitter {
  private LocalTransactionSubmissionEncoderStream;

  constructor(socket: Socket, LocalTransactionSubmissionDecoderStream: Stream.Readable) {
    super();
    this.LocalTransactionSubmissionEncoderStream = new Stream.Readable({
      read() {},
    });

    const LocalTransactionSubmissionStreamer = new PacketStreamer(LOCAL_TX_SUBMISSION);
    this.LocalTransactionSubmissionEncoderStream.pipe(LocalTransactionSubmissionStreamer);

    LocalTransactionSubmissionStreamer.on("data", (packet: Buffer) => {
      socket.write(packet);
    });

    const localTransactionSubmissionDecoder = new cbors.Decoder();
    LocalTransactionSubmissionDecoderStream.pipe(localTransactionSubmissionDecoder);

    localTransactionSubmissionDecoder.on("data", (data: any) => {
      const response = localTransactionSubmissionResponse(data.value);
      this.emit("data", response);
    });
  }

  submitTransaction = (era: number, transactionCbor: Buffer) => {
    const payload = [0, [era, new cbors.CborTag(transactionCbor, 24)]];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.LocalTransactionSubmissionEncoderStream.push(payloadBuffer);
  };

  done = () => {
    const payload = [3];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.LocalTransactionSubmissionEncoderStream.push(payloadBuffer);
  };
}

export default LocalTransactionSubmission;
