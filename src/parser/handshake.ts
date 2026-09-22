import type { CborNode } from "@stricahq/cbors";

/** Why the node did not accept the proposed version. */
export type RefuseReason =
  | { reason: "VersionMismatch"; versions: number[] }
  | { reason: "HandshakeDecodeError"; version: number; detail: string }
  | { reason: "Refused"; version: number; detail: string };

export type HandshakeResponse =
  | { accepted: { version: number; versionData: unknown } }
  | { refused: RefuseReason }
  /** the node's version table, answering a version query */
  | { versions: Map<number, unknown> };

const toVersion = (node: CborNode | undefined): number => {
  const version = node?.toJS();
  if (typeof version !== "number") {
    throw new Error("Invalid version number");
  }
  return version;
};

// refuseReason = [0, [versionNumber...]] / [1, versionNumber, tstr] / [2, versionNumber, tstr]
const toRefuseReason = (node: CborNode | undefined): RefuseReason => {
  if (node?.kind !== "array") {
    throw new Error("Invalid refuse reason");
  }
  switch (node.at(0)?.toJS()) {
    case 0: {
      const versions = node.at(1)?.toJS();
      if (!Array.isArray(versions)) {
        throw new Error("Invalid refuse reason");
      }
      return { reason: "VersionMismatch", versions };
    }
    case 1:
      return {
        reason: "HandshakeDecodeError",
        version: toVersion(node.at(1)),
        detail: String(node.at(2)?.toJS() ?? ""),
      };
    case 2:
      return {
        reason: "Refused",
        version: toVersion(node.at(1)),
        detail: String(node.at(2)?.toJS() ?? ""),
      };
    default:
      throw new Error("Invalid refuse reason");
  }
};

export const handshakeResponse = (payload: CborNode): HandshakeResponse => {
  switch (payload.at(0)?.toJS()) {
    case 1:
      return {
        accepted: { version: toVersion(payload.at(1)), versionData: payload.at(2)?.toJS() },
      };
    case 2:
      return { refused: toRefuseReason(payload.at(1)) };
    case 3: {
      const versions = payload.at(1)?.toJS();
      if (!(versions instanceof Map)) {
        throw new Error("Invalid version table");
      }
      return { versions };
    }
    default:
      throw new Error("Protocol is not implemented");
  }
};

export default handshakeResponse;
