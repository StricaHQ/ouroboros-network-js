import type { CborNode } from "@stricahq/cbors";
import type { LocalTransactionSubmissionResponse } from "../types";

export const localTransactionSubmissionResponse = (
  payload: CborNode
): LocalTransactionSubmissionResponse => {
  switch (payload.at(0)?.toJS()) {
    case 1:
      return {
        success: true,
      };
    case 2:
      // the rejection reason is era specific, so it is handed over as the plain decoded value
      return {
        rejectionMessage: payload.at(1)?.toJS(),
      };
    default:
      throw new Error("unknown response");
  }
};

export default localTransactionSubmissionResponse;
