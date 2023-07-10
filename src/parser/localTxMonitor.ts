import { LocalTxMonitorResponse } from "@stricahq/cardano-codec/dist/types/ouroborosTypes";

export const localTxMonitorResponse = (payload: any): LocalTxMonitorResponse => {
  let result: LocalTxMonitorResponse;
  switch (payload[0]) {
    case 1:
      result = {
        await: true,
      };
      break;
    case 2:
      result = {
        acquired: payload[1],
      };
      break;
    case 6:
      result = {
        nextTx: payload[1] ? payload[1][1].value : null,
      };
      break;
    default:
      throw new Error("Protocol is not implemented");
  }
  return result;
};

export default localTxMonitorResponse;
