import {
  NodeToClientChainSyncResponse,
  Point,
  Tip,
} from "@stricahq/cardano-codec/dist/types/ouroborosTypes";

const intersectFound = function (msg: any) {
  let point: Point = {};
  if (msg.point.length > 0) {
    point = {
      slot: msg.point[0],
      hash: msg.point[1].toString("hex"),
    };
  }
  const tip: Tip = {
    hash: msg.tip[0][1].toString("hex"),
    slot: msg.tip[0][0],
  };

  return {
    intersectFound: {
      point,
      tip,
    },
  };
};

const intersectNotFound = function (msg: any) {
  const tip: Tip = {
    hash: msg.tip[0][1].toString("hex"),
    slot: msg.tip[0][0],
  };
  return {
    intersectNotFound: {
      tip,
    },
  };
};

const rollForward = function (msg: any): NodeToClientChainSyncResponse {
  const blockCbor: Buffer = msg.block.value;

  const tip: Tip = {
    hash: msg.tip[0][1].toString("hex"),
    slot: msg.tip[0][0],
  };

  return {
    rollForward: {
      block: blockCbor,
      tip,
    },
  };
};

const rollBackward = function (msg: any) {
  let point: Point = {};
  if (msg.point.length > 0) {
    point = { slot: msg.point[0], hash: msg.point[1].toString("hex") };
  }
  const tip: Tip = {
    hash: msg.tip[0][1].toString("hex"),
    slot: msg.tip[0][0],
  };

  return {
    rollBackward: {
      point,
      tip,
    },
  };
};

export const chainSyncResponse = (payload: any): NodeToClientChainSyncResponse => {
  let result: NodeToClientChainSyncResponse;
  switch (payload[0]) {
    case 1:
      result = {
        await: true,
      };
      break;
    case 2:
      result = rollForward({
        block: payload[1],
        tip: payload[2],
      });
      break;
    case 3:
      result = rollBackward({
        point: payload[1],
        tip: payload[2],
      });
      break;
    case 5:
      result = intersectFound({
        point: payload[1],
        tip: payload[2],
      });
      break;
    case 6:
      result = intersectNotFound({
        tip: payload[1],
      });
      break;
    default:
      throw new Error("Protocol is not implemented");
  }
  return result;
};

export default chainSyncResponse;
