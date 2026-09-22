import { Readable } from "node:stream";
import type { LocalTxMonitorResponse } from "../types";
import MiniProtocol, { type Transport } from "./MiniProtocol";
import localTxMonitorResponseParser from "../parser/localTxMonitor";
import type { ProtocolSpec } from "../stateMachine";

const LOCAL_TX_MONITOR = Buffer.from([0x00, 0x09]);

export type LocalTxMonitorState = "StIdle" | "StAcquiring" | "StAcquired" | "StBusy" | "StDone";

export type LocalTxMonitorMessage =
  | "MsgDone"
  | "MsgAcquire"
  | "MsgAcquired"
  | "MsgAwaitAcquire"
  | "MsgRelease"
  | "MsgNextTx"
  | "MsgReplyNextTx";

/**
 * The local tx monitor state machine. `StBusy` covers `MsgNextTx` only: the
 * other queries (`MsgHasTx`, `MsgGetSizes`, `MsgGetMeasures`) are not implemented.
 */
export const localTxMonitorProtocol: ProtocolSpec<LocalTxMonitorState, LocalTxMonitorMessage> = {
  name: "LocalTxMonitor",
  init: "StIdle",
  agency: {
    StIdle: "client",
    StAcquiring: "server",
    StAcquired: "client",
    StBusy: "server",
    StDone: "nobody",
  },
  messages: {
    MsgDone: { tag: 0, from: "StIdle", to: "StDone" },
    MsgAcquire: { tag: 1, from: "StIdle", to: "StAcquiring" },
    MsgAwaitAcquire: { tag: 1, from: "StAcquired", to: "StAcquiring" },
    MsgAcquired: { tag: 2, from: "StAcquiring", to: "StAcquired" },
    MsgRelease: { tag: 3, from: "StAcquired", to: "StIdle" },
    MsgNextTx: { tag: 5, from: "StAcquired", to: "StBusy" },
    MsgReplyNextTx: { tag: 6, from: "StBusy", to: "StAcquired" },
  },
};

export class LocalTxMonitor extends MiniProtocol<
  LocalTxMonitorState,
  LocalTxMonitorMessage,
  LocalTxMonitorResponse
> {
  constructor(transport: Transport, incoming: Readable) {
    super(
      localTxMonitorProtocol,
      LOCAL_TX_MONITOR,
      transport,
      incoming,
      localTxMonitorResponseParser
    );
  }

  /** `MsgAcquire`, or `MsgAwaitAcquire` for the next snapshot while one is held: both are `[1]`. */
  acquireSnapshot = () => {
    this.send(this.state === "StAcquired" ? "MsgAwaitAcquire" : "MsgAcquire", [1]);
  };

  requestNextTx = () => {
    this.send("MsgNextTx", [5]);
  };

  release = () => {
    this.send("MsgRelease", [3]);
  };

  done = () => {
    this.send("MsgDone", [0]);
  };
}

export default LocalTxMonitor;
