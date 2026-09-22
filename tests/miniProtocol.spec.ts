import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { once, type EventEmitter } from "node:events";
import { encode } from "@stricahq/cbors";
import type { Transport } from "../src/protocols/MiniProtocol";
import NodeToClientChainSync from "../src/protocols/NodeToClientChainSync";
import LocalTxMonitor from "../src/protocols/LocalTxMonitor";
import LocalTransactionSubmission from "../src/protocols/LocalTransactionSubmission";
import Handshake, { HandshakeRefusedError } from "../src/protocols/Handshake";
import { ProtocolViolationError } from "../src/stateMachine";

const hash = Buffer.alloc(32, 0xab);
const tip = [[1000, hash], 42];
const tipOut = { slot: 1000, hash: hash.toString("hex") };
const bytes = (value: unknown) => Buffer.from(encode(value));

const fakeLink = () => {
  const written: Buffer[] = [];
  const state = { ready: true, aborted: 0 };
  const transport: Transport = {
    get ready() {
      return state.ready;
    },
    write: (packet) => {
      written.push(packet);
    },
    abort: () => {
      state.aborted++;
    },
  };
  const incoming = new Readable({ read() {} });
  return {
    transport,
    incoming,
    state,
    // the payloads written, as hex: the headers carry a clock
    sent: () => written.map((packet) => packet.subarray(8).toString("hex")),
    protocolIds: () => written.map((packet) => packet.readUInt16BE(4)),
    reply: (value: unknown) => incoming.push(bytes(value)),
  };
};

const next = <T>(emitter: EventEmitter<any>, event: string) =>
  once(emitter, event).then(([value]) => value as T);

// requests reach the transport through a stream, a tick after they are made
const flushed = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("NodeToClientChainSync over a fake connection", () => {
  it("frames its requests and follows the replies", async () => {
    const link = fakeLink();
    const chainSync = new NodeToClientChainSync(link.transport, link.incoming);
    expect(chainSync.state).toBe("StIdle");
    expect(chainSync.agency).toBe("client");

    chainSync.findIntersect([]);
    expect(chainSync.state).toBe("StIntersect");
    expect(chainSync.agency).toBe("server");
    let reply = next<any>(chainSync, "data");
    link.reply([6, tip]);
    expect(await reply).toEqual({ intersectNotFound: { tip: tipOut } });
    expect(chainSync.state).toBe("StIdle");

    chainSync.requestNext();
    expect(chainSync.state).toBe("StCanAwait");
    reply = next(chainSync, "data");
    link.reply([1]);
    expect(await reply).toEqual({ await: true });
    expect(chainSync.state).toBe("StMustReply");
    reply = next(chainSync, "data");
    link.reply([3, [], tip]);
    expect(await reply).toEqual({ rollBackward: { point: {}, tip: tipOut } });
    expect(chainSync.state).toBe("StIdle");

    chainSync.done();
    expect(chainSync.state).toBe("StDone");
    expect(chainSync.agency).toBe("nobody");
    expect(link.sent()).toEqual(["82048180", "8100", "8107"]);
    expect(link.protocolIds()).toEqual([5, 5, 5]);
    expect(link.state.aborted).toBe(0);
  });

  it("throws on a request the state does not allow and sends nothing", async () => {
    const link = fakeLink();
    const chainSync = new NodeToClientChainSync(link.transport, link.incoming);
    chainSync.requestNext();
    expect(() => chainSync.requestNext()).toThrow(ProtocolViolationError);
    expect(() => chainSync.findIntersect([])).toThrow(
      "NodeToClientChainSync: MsgFindIntersect cannot be sent in state StCanAwait, the node has agency there"
    );
    expect(() => chainSync.done()).toThrow(/MsgDone cannot be sent in state StCanAwait/);
    await flushed();
    expect(link.sent()).toEqual(["8100"]);
    expect(chainSync.state).toBe("StCanAwait");
  });

  it("throws while the connection is not ready, leaving the state alone", async () => {
    const link = fakeLink();
    link.state.ready = false;
    const chainSync = new NodeToClientChainSync(link.transport, link.incoming);
    const attempt = () => chainSync.requestNext();
    expect(attempt).toThrow(ProtocolViolationError);
    expect(attempt).toThrow(
      "NodeToClientChainSync: MsgRequestNext cannot be sent while the client is not connected"
    );
    expect(chainSync.state).toBe("StIdle");
    await flushed();
    expect(link.sent()).toEqual([]);
  });

  it("reports a message the node may not send and drops the connection", async () => {
    const link = fakeLink();
    const chainSync = new NodeToClientChainSync(link.transport, link.incoming);
    chainSync.findIntersect([]);
    const failure = next<ProtocolViolationError>(chainSync, "error");
    link.reply([3, [], tip]);
    const error = await failure;
    expect(error).toBeInstanceOf(ProtocolViolationError);
    expect(error).toMatchObject({
      protocol: "NodeToClientChainSync",
      state: "StIntersect",
      side: "node",
    });
    expect(error.message).toBe(
      "NodeToClientChainSync: the node sent MsgRollBackward in state StIntersect, expected MsgIntersectFound or MsgIntersectNotFound"
    );
    expect(chainSync.state).toBe("StIntersect");
    expect(link.state.aborted).toBe(1);
  });

  it("reports a reply that does not decode and drops the connection", async () => {
    const link = fakeLink();
    const chainSync = new NodeToClientChainSync(link.transport, link.incoming);
    chainSync.requestNext();
    const failure = next<Error>(chainSync, "error");
    link.reply([2, "not a block", tip]);
    expect((await failure).message).toMatch(/tag 24/);
    expect(link.state.aborted).toBe(1);
  });
});

describe("LocalTxMonitor over a fake connection", () => {
  it("acquires, reads, acquires again, releases and finishes", async () => {
    const link = fakeLink();
    const monitor = new LocalTxMonitor(link.transport, link.incoming);
    monitor.acquireSnapshot();
    expect(monitor.state).toBe("StAcquiring");
    let reply = next<any>(monitor, "data");
    link.reply([2, 555]);
    expect(await reply).toEqual({ acquired: 555 });
    expect(monitor.state).toBe("StAcquired");
    expect(monitor.agency).toBe("client");
    expect(() => monitor.done()).toThrow(
      "LocalTxMonitor: MsgDone cannot be sent in state StAcquired, only MsgAwaitAcquire, MsgRelease or MsgNextTx can be sent there"
    );

    monitor.requestNextTx();
    expect(monitor.state).toBe("StBusy");
    expect(() => monitor.acquireSnapshot()).toThrow(
      "LocalTxMonitor: MsgAcquire cannot be sent in state StBusy, the node has agency there"
    );
    reply = next(monitor, "data");
    link.reply([6]);
    expect(await reply).toEqual({ nextTx: null });
    expect(monitor.state).toBe("StAcquired");

    // the next snapshot is MsgAwaitAcquire, the same [1] on the wire
    monitor.acquireSnapshot();
    expect(monitor.state).toBe("StAcquiring");
    reply = next(monitor, "data");
    link.reply([2, 556]);
    expect(await reply).toEqual({ acquired: 556 });

    monitor.release();
    expect(monitor.state).toBe("StIdle");
    monitor.done();
    expect(monitor.state).toBe("StDone");
    expect(link.sent()).toEqual(["8101", "8105", "8101", "8103", "8100"]);
    expect(link.protocolIds()).toEqual([9, 9, 9, 9, 9]);
    expect(link.state.aborted).toBe(0);
  });
});

describe("LocalTransactionSubmission over a fake connection", () => {
  it("submits one transaction at a time", async () => {
    const link = fakeLink();
    const submission = new LocalTransactionSubmission(link.transport, link.incoming);
    const tx = Buffer.from("deadbeef", "hex");
    submission.submitTransaction(6, tx);
    expect(submission.state).toBe("StBusy");
    expect(() => submission.submitTransaction(6, tx)).toThrow(
      "LocalTransactionSubmission: MsgSubmitTx cannot be sent in state StBusy, the node has agency there"
    );
    let reply = next<any>(submission, "data");
    link.reply([1]);
    expect(await reply).toEqual({ success: true });
    expect(submission.state).toBe("StIdle");

    submission.submitTransaction(6, tx);
    reply = next(submission, "data");
    link.reply([2, "reason"]);
    expect(await reply).toEqual({ rejectionMessage: "reason" });

    submission.done();
    expect(submission.state).toBe("StDone");
    expect(link.sent()).toEqual(["82008206d81844deadbeef", "82008206d81844deadbeef", "8103"]);
    expect(link.protocolIds()).toEqual([6, 6, 6]);
  });
});

describe("Handshake over a fake connection", () => {
  it("proposes a version and takes the node's acceptance", async () => {
    const link = fakeLink();
    const handshake = new Handshake(link.transport, link.incoming);
    expect(handshake.state).toBe("StPropose");
    handshake.proposeVersions(32784, 764824073);
    expect(handshake.state).toBe("StConfirm");
    await flushed();
    expect(link.sent()).toEqual(["8200a1198010821a2d964a09f4"]);
    expect(link.protocolIds()).toEqual([0]);

    const reply = next<any>(handshake, "data");
    link.reply([1, 32784, [764824073, false]]);
    expect(await reply).toEqual({ accepted: { version: 32784, versionData: [764824073, false] } });
    expect(handshake.state).toBe("StDone");
    expect(() => handshake.proposeVersions(32784, 1)).toThrow(
      "Handshake: MsgProposeVersions cannot be sent in state StDone, the protocol has finished"
    );
  });

  it("hands a refusal and a query reply over as data", async () => {
    const refused = fakeLink();
    const handshake = new Handshake(refused.transport, refused.incoming);
    handshake.proposeVersions(32784, 764824073);
    let reply = next<any>(handshake, "data");
    refused.reply([2, [2, 32784, "no"]]);
    expect(await reply).toEqual({
      refused: { reason: "Refused", version: 32784, detail: "no" },
    });

    const queried = fakeLink();
    const query = new Handshake(queried.transport, queried.incoming);
    query.proposeVersions(32784, 764824073);
    reply = next(query, "data");
    queried.reply([3, new Map([[32784, [764824073, false]]])]);
    expect([...(await reply).versions.keys()]).toEqual([32784]);
    expect(refused.state.aborted + queried.state.aborted).toBe(0);
  });
});

describe("HandshakeRefusedError", () => {
  it("describes each reason", () => {
    const mismatch = new HandshakeRefusedError({
      reason: "VersionMismatch",
      versions: [32780, 32781],
    });
    expect(mismatch.message).toBe(
      "handshake refused: version mismatch, the node supports 32780, 32781"
    );
    expect(mismatch).toMatchObject({ name: "HandshakeRefusedError", versions: [32780, 32781] });
    expect(
      new HandshakeRefusedError({ reason: "HandshakeDecodeError", version: 32784, detail: "bad" })
        .message
    ).toBe("handshake refused: the node could not decode the proposal for version 32784: bad");
    expect(
      new HandshakeRefusedError({ reason: "Refused", version: 32784, detail: "no" })
    ).toMatchObject({ reason: "Refused", version: 32784, detail: "no" });
    expect(new HandshakeRefusedError({ reason: "QueryReply", versions: [32784] }).message).toBe(
      "handshake refused: the node answered with its version table (32784) instead of accepting a version"
    );
  });
});
