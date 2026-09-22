import { Readable } from "node:stream";
import type { NodeToClientChainSyncResponse, Tip } from "../types";
import MiniProtocol, { type Transport } from "./MiniProtocol";
import chainSyncResponseParser from "../parser/chainSync";
import type { ProtocolSpec } from "../stateMachine";

const CHAIN_SYNC = Buffer.from([0x00, 0x05]);

export type NodeToClientChainSyncState =
  "StIdle" | "StCanAwait" | "StMustReply" | "StIntersect" | "StDone";

export type NodeToClientChainSyncMessage =
  | "MsgRequestNext"
  | "MsgAwaitReply"
  | "MsgRollForward"
  | "MsgRollBackward"
  | "MsgFindIntersect"
  | "MsgIntersectFound"
  | "MsgIntersectNotFound"
  | "MsgDone";

/** The chain sync state machine. */
export const nodeToClientChainSyncProtocol: ProtocolSpec<
  NodeToClientChainSyncState,
  NodeToClientChainSyncMessage
> = {
  name: "NodeToClientChainSync",
  init: "StIdle",
  agency: {
    StIdle: "client",
    StCanAwait: "server",
    StMustReply: "server",
    StIntersect: "server",
    StDone: "nobody",
  },
  messages: {
    MsgRequestNext: { tag: 0, from: "StIdle", to: "StCanAwait" },
    MsgAwaitReply: { tag: 1, from: "StCanAwait", to: "StMustReply" },
    MsgRollForward: { tag: 2, from: ["StCanAwait", "StMustReply"], to: "StIdle" },
    MsgRollBackward: { tag: 3, from: ["StCanAwait", "StMustReply"], to: "StIdle" },
    MsgFindIntersect: { tag: 4, from: "StIdle", to: "StIntersect" },
    MsgIntersectFound: { tag: 5, from: "StIntersect", to: "StIdle" },
    MsgIntersectNotFound: { tag: 6, from: "StIntersect", to: "StIdle" },
    MsgDone: { tag: 7, from: "StIdle", to: "StDone" },
  },
};

export class NodeToClientChainSync extends MiniProtocol<
  NodeToClientChainSyncState,
  NodeToClientChainSyncMessage,
  NodeToClientChainSyncResponse
> {
  constructor(transport: Transport, incoming: Readable) {
    super(nodeToClientChainSyncProtocol, CHAIN_SYNC, transport, incoming, chainSyncResponseParser);
  }

  findIntersect = (points: Array<Tip>) => {
    const intersectPoints =
      points.length > 0
        ? points.map((point): [number, Buffer] => [point.slot, Buffer.from(point.hash, "hex")])
        : [[]];
    this.send("MsgFindIntersect", [4, intersectPoints]);
  };

  requestNext = () => {
    this.send("MsgRequestNext", [0]);
  };

  done = () => {
    this.send("MsgDone", [7]);
  };
}

export default NodeToClientChainSync;
