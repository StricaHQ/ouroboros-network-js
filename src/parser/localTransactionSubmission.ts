import { LocalTransactionSubmissionResponse } from "@stricahq/cardano-codec/dist/types/ouroborosTypes";

export const localTransactionSubmissionResponse = (payload: any) => {
  const result: LocalTransactionSubmissionResponse = {};

  switch (payload[0]) {
    case 1: {
      result.success = true;
      break;
    }
    case 2: {
      result.rejectionMessage = payload[1];
      break;
    }
    default: {
      throw new Error("unknown response");
    }
  }

  return result;
};

export default localTransactionSubmissionResponse;
