import { Readable } from "node:stream";
import MiniProtocol, { type Transport } from "./MiniProtocol";
import handshakeResponse, { type HandshakeResponse, type RefuseReason } from "../parser/handshake";
import { versionProposal } from "../protocol";
import type { ProtocolSpec } from "../stateMachine";

const HANDSHAKE = Buffer.from([0x00, 0x00]);

export type HandshakeState = "StPropose" | "StConfirm" | "StDone";

export type HandshakeMessage =
  "MsgProposeVersions" | "MsgAcceptVersion" | "MsgRefuse" | "MsgQueryReply";

/** The handshake state machine. */
export const handshakeProtocol: ProtocolSpec<HandshakeState, HandshakeMessage> = {
  name: "Handshake",
  init: "StPropose",
  agency: { StPropose: "client", StConfirm: "server", StDone: "nobody" },
  messages: {
    MsgProposeVersions: { tag: 0, from: "StPropose", to: "StConfirm" },
    MsgAcceptVersion: { tag: 1, from: "StConfirm", to: "StDone" },
    MsgRefuse: { tag: 2, from: "StConfirm", to: "StDone" },
    MsgQueryReply: { tag: 3, from: "StConfirm", to: "StDone" },
  },
};

type Refusal = RefuseReason | { reason: "QueryReply"; versions: number[] };

const describe = (refusal: Refusal): string => {
  switch (refusal.reason) {
    case "VersionMismatch":
      return `version mismatch, the node supports ${refusal.versions.join(", ") || "none of the proposed versions"}`;
    case "HandshakeDecodeError":
      return `the node could not decode the proposal for version ${refusal.version}: ${refusal.detail}`;
    case "Refused":
      return `the node refused version ${refusal.version}: ${refusal.detail}`;
    case "QueryReply":
      return `the node answered with its version table (${refusal.versions.join(", ")}) instead of accepting a version`;
  }
};

/**
 * The node did not accept the proposed version. `reason` is the node's, or
 * `QueryReply` for a node that answered with its version table instead.
 */
export class HandshakeRefusedError extends Error {
  readonly reason: Refusal["reason"];
  /** VersionMismatch and QueryReply: the versions the node supports */
  readonly versions?: number[];
  /** HandshakeDecodeError and Refused: the version concerned */
  readonly version?: number;
  /** HandshakeDecodeError and Refused: the node's explanation */
  readonly detail?: string;

  constructor(refusal: Refusal) {
    super(`handshake refused: ${describe(refusal)}`);
    this.name = "HandshakeRefusedError";
    this.reason = refusal.reason;
    if ("versions" in refusal) {
      this.versions = refusal.versions;
    } else {
      this.version = refusal.version;
      this.detail = refusal.detail;
    }
  }
}

/** The handshake, run on mini protocol 0 before any other can be used. */
export class Handshake extends MiniProtocol<HandshakeState, HandshakeMessage, HandshakeResponse> {
  constructor(transport: Transport, incoming: Readable) {
    super(handshakeProtocol, HANDSHAKE, transport, incoming, handshakeResponse);
  }

  /** Proposes one node to client version with the network magic, not querying. */
  proposeVersions = (version: number, networkMagic: number) => {
    this.send("MsgProposeVersions", versionProposal(version, networkMagic));
  };
}

export default Handshake;
