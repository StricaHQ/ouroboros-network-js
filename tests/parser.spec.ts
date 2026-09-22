import { describe, it, expect } from "vitest";
import { encode, decodeAnnotated, CborTag } from "@stricahq/cbors";
import chainSyncResponse from "../src/parser/chainSync";
import localTxMonitorResponse from "../src/parser/localTxMonitor";
import localTransactionSubmissionResponse from "../src/parser/localTransactionSubmission";
import handshakeResponse from "../src/parser/handshake";

// the same annotation tree the CborDecoderStream hands to the parsers
const tree = (value: unknown) => decodeAnnotated(encode(value));

const hash = Buffer.alloc(32, 0xab);
const tip = [[1000, hash], 42];
const tipOut = { slot: 1000, hash: hash.toString("hex") };

describe("chain sync responses", () => {
  it("await", () => {
    expect(chainSyncResponse(tree([1]))).toEqual({ await: true });
  });

  it("rollForward keeps the exact block bytes, non canonical encoding included", () => {
    const block = Buffer.from("9f1817ff", "hex"); // [_ 23], with 23 written as 18 17
    const res = chainSyncResponse(tree([2, new CborTag(block, 24), tip]));
    expect(Buffer.isBuffer(res.rollForward?.block)).toBe(true);
    expect(res.rollForward?.block.toString("hex")).toBe("9f1817ff");
    expect(res.rollForward?.tip).toEqual(tipOut);
  });

  it("rollBackward to origin", () => {
    expect(chainSyncResponse(tree([3, [], tip]))).toEqual({
      rollBackward: { point: {}, tip: tipOut },
    });
  });

  it("intersectFound", () => {
    expect(chainSyncResponse(tree([5, [777, hash], tip]))).toEqual({
      intersectFound: { point: { slot: 777, hash: hash.toString("hex") }, tip: tipOut },
    });
  });

  it("intersectNotFound", () => {
    expect(chainSyncResponse(tree([6, tip]))).toEqual({ intersectNotFound: { tip: tipOut } });
  });

  it("rejects unknown and malformed messages", () => {
    expect(() => chainSyncResponse(tree([9]))).toThrow(/not implemented/);
    expect(() => chainSyncResponse(tree([2, Buffer.from("00", "hex"), tip]))).toThrow(/tag 24/);
    expect(() => chainSyncResponse(tree([6, [[], 0]]))).toThrow(/Invalid tip/);
  });
});

describe("local tx monitor responses", () => {
  it("acquired", () => {
    expect(localTxMonitorResponse(tree([2, 555]))).toEqual({ acquired: 555 });
  });

  it("nextTx is null once the snapshot is exhausted", () => {
    expect(localTxMonitorResponse(tree([6]))).toEqual({ nextTx: null });
  });

  it("nextTx unwraps the tag 24 transaction bytes", () => {
    const tx = Buffer.from("84a0a0f5f6", "hex");
    const res = localTxMonitorResponse(tree([6, [6, new CborTag(tx, 24)]]));
    expect(Buffer.isBuffer(res.nextTx)).toBe(true);
    expect(res.nextTx?.toString("hex")).toBe("84a0a0f5f6");
  });

  it("rejects unknown messages, tag 1 among them: MsgAcquire is the client's", () => {
    expect(() => localTxMonitorResponse(tree([9]))).toThrow(/not implemented/);
    expect(() => localTxMonitorResponse(tree([1]))).toThrow(/not implemented/);
  });
});

describe("local transaction submission responses", () => {
  it("accepted", () => {
    expect(localTransactionSubmissionResponse(tree([1]))).toEqual({ success: true });
  });

  it("rejected hands over the plain decoded reason", () => {
    const reason = new Map([[1, [Buffer.from("aa", "hex"), 7n ** 30n]]]);
    const res = localTransactionSubmissionResponse(tree([2, reason]));
    expect(res.rejectionMessage).toBeInstanceOf(Map);
    const [bytes, big] = res.rejectionMessage.get(1);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).toString("hex")).toBe("aa");
    expect(big).toBe(7n ** 30n);
  });

  it("rejects unknown messages", () => {
    expect(() => localTransactionSubmissionResponse(tree([3]))).toThrow(/unknown response/);
  });
});

describe("handshake responses", () => {
  it("accept", () => {
    expect(handshakeResponse(tree([1, 32784, [764824073, false]]))).toEqual({
      accepted: { version: 32784, versionData: [764824073, false] },
    });
  });

  it("refuse, with each reason", () => {
    expect(handshakeResponse(tree([2, [0, [32780, 32781]]]))).toEqual({
      refused: { reason: "VersionMismatch", versions: [32780, 32781] },
    });
    expect(handshakeResponse(tree([2, [1, 32784, "bad"]]))).toEqual({
      refused: { reason: "HandshakeDecodeError", version: 32784, detail: "bad" },
    });
    expect(handshakeResponse(tree([2, [2, 32784, "no"]]))).toEqual({
      refused: { reason: "Refused", version: 32784, detail: "no" },
    });
  });

  it("query reply", () => {
    const res = handshakeResponse(tree([3, new Map([[32784, [764824073, false]]])]));
    expect("versions" in res && [...res.versions.keys()]).toEqual([32784]);
  });

  it("rejects unknown and malformed messages", () => {
    expect(() => handshakeResponse(tree([0, new Map()]))).toThrow(/not implemented/);
    expect(() => handshakeResponse(tree([1, "v"]))).toThrow(/Invalid version/);
    expect(() => handshakeResponse(tree([2, [7]]))).toThrow(/Invalid refuse reason/);
    expect(() => handshakeResponse(tree([2, 5]))).toThrow(/Invalid refuse reason/);
    expect(() => handshakeResponse(tree([2, [0, 5]]))).toThrow(/Invalid refuse reason/);
    expect(() => handshakeResponse(tree([3, []]))).toThrow(/Invalid version table/);
  });
});
