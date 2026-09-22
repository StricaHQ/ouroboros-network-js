// mux segment (SDU) header: 4 byte timestamp, 2 byte mini protocol id, 2 byte payload length
const HEADER_LENGTH = 8;

// the mux timestamp: the low 32 bits of a monotonic microsecond clock
const timestamp = () => Number((process.hrtime.bigint() / 1000n) & 0xffffffffn);

export const createProtocolPacket = function (payload: Uint8Array, PROTOCOL_ID: Buffer) {
  const packet = Buffer.allocUnsafe(HEADER_LENGTH + payload.length);
  packet.writeUInt32BE(timestamp(), 0);
  packet.writeUInt16BE(PROTOCOL_ID.readUInt16BE(0), 4);
  packet.writeUInt16BE(payload.length, 6);
  packet.set(payload, HEADER_LENGTH);
  return packet;
};

/**
 * `MsgProposeVersions` offering one node to client version:
 * `[0, {version: [networkMagic, query]}]`, never querying.
 */
export const versionProposal = (version: number, networkMagic: number) => [
  0,
  new Map([[version, [networkMagic, false]]]),
];
