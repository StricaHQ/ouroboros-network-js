import { describe, it, expect, vi } from "vitest";
import { createProtocolPacket } from "../src/protocol";

describe("mux packets", () => {
  it("stamps the packet with the low 32 bits of the microsecond clock", () => {
    // 5_000_000_123 microseconds is past 2^32, the field wraps instead of throwing
    const clock = vi.spyOn(process.hrtime, "bigint").mockReturnValue(5_000_000_123_456n);
    try {
      const packet = createProtocolPacket(Buffer.alloc(0), Buffer.from([0x00, 0x05]));
      expect(packet.readUInt32BE(0)).toBe(5_000_000_123 % 2 ** 32);
    } finally {
      clock.mockRestore();
    }
  });
});
