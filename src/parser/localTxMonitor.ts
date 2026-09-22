import type { CborNode } from "@stricahq/cbors";
import type { LocalTxMonitorResponse } from "../types";
import { unwrapCborInCbor } from "../utils/utils";

export const localTxMonitorResponse = (payload: CborNode): LocalTxMonitorResponse => {
  switch (payload.at(0)?.toJS()) {
    case 2:
      return {
        acquired: payload.at(1)?.toJS(),
      };
    case 6: {
      // [6] once the snapshot is exhausted, otherwise [6, [era, #6.24(tx)]]
      const tx = payload.at(1);
      return {
        nextTx: tx === undefined ? null : unwrapCborInCbor(tx.at(1)),
      };
    }
    default:
      throw new Error("Protocol is not implemented");
  }
};

export default localTxMonitorResponse;
