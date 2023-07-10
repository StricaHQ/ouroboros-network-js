import * as cbors from "@stricahq/cbors";

const HAND_SHAKE = Buffer.from([0x00, 0x00]); // mux

const getMicroSeconds = function () {
  const hrTime = process.hrtime();
  return Math.floor(hrTime[0] * 1000000 + hrTime[1] / 1000);
};

const toBytesInt32 = function (num: number) {
  const arr = new ArrayBuffer(4);
  const view = new DataView(arr);
  view.setUint32(0, num, false);
  return arr;
};

const toBytesInt16 = function (num: number) {
  const arr = new ArrayBuffer(2);
  const view = new DataView(arr);
  view.setUint16(0, num, false);
  return arr;
};

export const createProtocolPacket = function (buffPayload: Buffer, PROTOCOL_ID: Buffer) {
  const microSeconds = getMicroSeconds();
  const buffTimestamp = Buffer.from(toBytesInt32(microSeconds));
  const buffPayloadSize = Buffer.from(toBytesInt16(buffPayload.length));

  const packet = Buffer.concat(
    [buffTimestamp, PROTOCOL_ID, buffPayloadSize, buffPayload],
    buffTimestamp.length + buffPayloadSize.length + buffPayload.length + PROTOCOL_ID.length
  );

  return packet;
};

export const makeHandshakeMsg = function (protocolId: number, networkMagic: number) {
  const map = new Map();
  map.set(protocolId, networkMagic);
  const buffPayload = cbors.Encoder.encode([0, map]);
  const packet = createProtocolPacket(buffPayload, HAND_SHAKE);
  return packet;
};
