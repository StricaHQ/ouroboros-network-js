import type { CborNode } from "@stricahq/cbors";
import type { NodeToClientChainSyncResponse, Point, Tip } from "../types";
import { toHex, unwrapCborInCbor } from "../utils/utils";

// point = [] (origin) / [slot, hash]
const toPoint = (node: CborNode | undefined): Point => {
  if (node?.kind !== "array") {
    throw new Error("Invalid point");
  }
  if (node.items?.length === 0) {
    return {};
  }
  const slot = node.at(0);
  const hash = node.at(1);
  if (slot === undefined || hash === undefined) {
    throw new Error("Invalid point");
  }
  return {
    slot: slot.toJS(),
    hash: toHex(hash.toJS()),
  };
};

// tip = [point, blockNo]
const toTip = (node: CborNode | undefined): Tip => {
  const { slot, hash } = toPoint(node?.at(0));
  if (slot === undefined || hash === undefined) {
    throw new Error("Invalid tip");
  }
  return { slot, hash };
};

export const chainSyncResponse = (payload: CborNode): NodeToClientChainSyncResponse => {
  switch (payload.at(0)?.toJS()) {
    case 1:
      return {
        await: true,
      };
    case 2:
      return {
        rollForward: {
          block: unwrapCborInCbor(payload.at(1)),
          tip: toTip(payload.at(2)),
        },
      };
    case 3:
      return {
        rollBackward: {
          point: toPoint(payload.at(1)),
          tip: toTip(payload.at(2)),
        },
      };
    case 5:
      return {
        intersectFound: {
          point: toPoint(payload.at(1)),
          tip: toTip(payload.at(2)),
        },
      };
    case 6:
      return {
        intersectNotFound: {
          tip: toTip(payload.at(1)),
        },
      };
    default:
      throw new Error("Protocol is not implemented");
  }
};

export default chainSyncResponse;
