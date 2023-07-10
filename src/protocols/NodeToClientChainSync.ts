import * as cbors from "@stricahq/cbors";
import { Socket } from "net";
import {
  NodeToClientChainSyncResponse,
  Tip,
} from "@stricahq/cardano-codec/dist/types/ouroborosTypes";
import EventEmitter from "events";
import Stream from "stream";
import PacketStreamer from "../PacketStreamer";
import chainSyncResponseParser from "../parser/chainSync";

const CHAIN_SYNC = Buffer.from([0x00, 0x05]); // included protocol id

export declare interface NodeToClientChainSync {
  on(event: "data", listener: (data: NodeToClientChainSyncResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

// eslint-disable-next-line no-redeclare
export class NodeToClientChainSync extends EventEmitter {
  private NodeToClientChainSyncEncoderStream;

  constructor(socket: Socket, NodeToClientChainSyncDecoderStream: Stream.Readable) {
    super();
    this.NodeToClientChainSyncEncoderStream = new Stream.Readable({
      read() {},
    });

    const NodeToClientChainSyncStreamer = new PacketStreamer(CHAIN_SYNC);
    this.NodeToClientChainSyncEncoderStream.pipe(NodeToClientChainSyncStreamer);

    NodeToClientChainSyncStreamer.on("data", (packet: Buffer) => {
      socket.write(packet);
    });

    const nodeToClientChainSyncDecoder = new cbors.Decoder();
    NodeToClientChainSyncDecoderStream.pipe(nodeToClientChainSyncDecoder);

    nodeToClientChainSyncDecoder.on("data", (data: any) => {
      const response = chainSyncResponseParser(data.value);
      this.emit("data", response);
    });
  }

  findIntersect = (points: Array<Tip>) => {
    const intersectPoints =
      points.length > 0
        ? points.map((point): [number, Buffer] => [point.slot, Buffer.from(point.hash, "hex")])
        : [[]];
    const payload = [4, intersectPoints];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.NodeToClientChainSyncEncoderStream.push(payloadBuffer);
  };

  requestNext = () => {
    const payload = [0];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.NodeToClientChainSyncEncoderStream.push(payloadBuffer);
  };

  done = () => {
    const payload = [7];
    const payloadBuffer = cbors.Encoder.encode(payload);
    this.NodeToClientChainSyncEncoderStream.push(payloadBuffer);
  };
}

export default NodeToClientChainSync;
