import { CborTag } from "@stricahq/cbors";
import { Readable } from "node:stream";
import type { LocalTransactionSubmissionResponse } from "@stricahq/cardano-codec/dist/types/ouroborosTypes";
import MiniProtocol, { type Transport } from "./MiniProtocol";
import localTransactionSubmissionResponse from "../parser/localTransactionSubmission";
import type { ProtocolSpec } from "../stateMachine";

const LOCAL_TX_SUBMISSION = Buffer.from([0x00, 0x06]);

export type LocalTransactionSubmissionState = "StIdle" | "StBusy" | "StDone";

export type LocalTransactionSubmissionMessage =
  "MsgSubmitTx" | "MsgAcceptTx" | "MsgRejectTx" | "MsgDone";

/** The local tx submission state machine. */
export const localTransactionSubmissionProtocol: ProtocolSpec<
  LocalTransactionSubmissionState,
  LocalTransactionSubmissionMessage
> = {
  name: "LocalTransactionSubmission",
  init: "StIdle",
  agency: { StIdle: "client", StBusy: "server", StDone: "nobody" },
  messages: {
    MsgSubmitTx: { tag: 0, from: "StIdle", to: "StBusy" },
    MsgAcceptTx: { tag: 1, from: "StBusy", to: "StIdle" },
    MsgRejectTx: { tag: 2, from: "StBusy", to: "StIdle" },
    MsgDone: { tag: 3, from: "StIdle", to: "StDone" },
  },
};

export class LocalTransactionSubmission extends MiniProtocol<
  LocalTransactionSubmissionState,
  LocalTransactionSubmissionMessage,
  LocalTransactionSubmissionResponse
> {
  constructor(transport: Transport, incoming: Readable) {
    super(
      localTransactionSubmissionProtocol,
      LOCAL_TX_SUBMISSION,
      transport,
      incoming,
      localTransactionSubmissionResponse
    );
  }

  /** `[0, [era, #6.24(tx)]]`: the transaction's CBOR, wrapped and tagged with its era. */
  submitTransaction = (era: number, transactionCbor: Uint8Array) => {
    this.send("MsgSubmitTx", [0, [era, new CborTag(transactionCbor, 24)]]);
  };

  done = () => {
    this.send("MsgDone", [3]);
  };
}

export default LocalTransactionSubmission;
