import { describe, it, expect } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { once, type EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { encode, CborTag } from "@stricahq/cbors";
import {
  OuroborosClient,
  SduReadTimeoutError,
  HandshakeRefusedError,
  ProtocolViolationError,
} from "../src/index";

const MAGIC = 764824073;
const hash = Buffer.alloc(32, 0xab);
const tip = [[1000, hash], 42];
const tipOut = { slot: 1000, hash: hash.toString("hex") };
const block = randomBytes(30000);
const tx = Buffer.from("deadbeef", "hex");
const reason = new Map([[1, [Buffer.from("aa", "hex")]]]);

const bytes = (value: unknown) => Buffer.from(encode(value));

// a node to client mux segment as the node sends it: the M bit marks the responder side
const segment = (protocol: number, payload: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(1234, 0);
  header.writeUInt16BE(protocol | 0x8000, 4);
  header.writeUInt16BE(payload.length, 6);
  return Buffer.concat([header, payload]);
};

const rollForward = bytes([2, new CborTag(block, 24), tip]);
const awaitReply = bytes([1]);

const script: Array<{ protocol: number; request: string; replies: Buffer[] }> = [
  {
    protocol: 0,
    request: "8200a1198010821a2d964a09f4",
    replies: [segment(0, bytes([1, 32784, [MAGIC, false]]))],
  },
  {
    protocol: 5,
    request: `820481821a075bcd155820${hash.toString("hex")}`,
    replies: [segment(5, bytes([5, [123456789, hash], tip]))],
  },
  {
    protocol: 5,
    request: "8100",
    // MsgAwaitReply packed in front of a roll forward that spreads over three segments
    replies: [
      segment(5, Buffer.concat([awaitReply, rollForward.subarray(0, 12286)])),
      segment(5, rollForward.subarray(12286, 24574)),
      segment(5, rollForward.subarray(24574)),
    ],
  },
  { protocol: 9, request: "8101", replies: [segment(9, bytes([2, 555]))] },
  { protocol: 9, request: "8105", replies: [segment(9, bytes([6, [6, new CborTag(tx, 24)]]))] },
  { protocol: 9, request: "8105", replies: [segment(9, bytes([6]))] },
  { protocol: 6, request: "82008206d81844deadbeef", replies: [segment(6, bytes([1]))] },
  { protocol: 6, request: "82008206d81844deadbeef", replies: [segment(6, bytes([2, reason]))] },
  { protocol: 5, request: "8107", replies: [] },
  { protocol: 9, request: "8103", replies: [] },
  { protocol: 9, request: "8100", replies: [] },
  { protocol: 6, request: "8103", replies: [] },
];

const fakeNode = (steps = script) => {
  const received: Array<[number, string]> = [];
  const server = createServer((conn: Socket) => {
    let pending = Buffer.alloc(0);
    conn.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 8 && pending.length >= 8 + pending.readUInt16BE(6)) {
        const length = pending.readUInt16BE(6);
        const protocol = pending.readUInt16BE(4);
        const payload = pending.subarray(8, 8 + length);
        pending = pending.subarray(8 + length);
        received.push([protocol, payload.toString("hex")]);
        const step = steps[received.length - 1];
        step?.replies.forEach((reply) => conn.write(reply));
      }
    });
    conn.on("end", () => conn.end());
  });
  return { server, received };
};

// queues events so none are lost between awaits, even when several arrive in one tick
const inbox = <T>(emitter: EventEmitter<any>, event: string) => {
  const queue: T[] = [];
  const waiting: Array<(value: T) => void> = [];
  emitter.on(event, (value: T) => {
    const resolve = waiting.shift();
    if (resolve) resolve(value);
    else queue.push(value);
  });
  return {
    next: () =>
      queue.length > 0
        ? Promise.resolve(queue.shift() as T)
        : new Promise<T>((resolve) => waiting.push(resolve)),
  };
};

const listen = (server: Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

describe("OuroborosClient against a scripted node", () => {
  it("handshakes, runs the three mini protocols over the mux and disconnects", async () => {
    const { server, received } = fakeNode();
    const port = await listen(server);

    const client = new OuroborosClient({ protocolId: 32784, protocolMagic: MAGIC });
    const errors: Error[] = [];
    client.on("error", (error) => errors.push(error));
    client.NodeToClientChainSync.on("error", (error) => errors.push(error));
    client.LocalTxMonitor.on("error", (error) => errors.push(error));
    client.LocalTransactionSubmission.on("error", (error) => errors.push(error));

    const chainSync = inbox<any>(client.NodeToClientChainSync, "data");
    const txMonitor = inbox<any>(client.LocalTxMonitor, "data");
    const txSubmission = inbox<any>(client.LocalTransactionSubmission, "data");

    const connected = once(client, "connect");
    client.connect(port, "127.0.0.1");
    await connected;

    client.NodeToClientChainSync.findIntersect([{ slot: 123456789, hash: hash.toString("hex") }]);
    expect(client.NodeToClientChainSync.state).toBe("StIntersect");
    expect(client.NodeToClientChainSync.agency).toBe("server");
    expect(await chainSync.next()).toEqual({
      intersectFound: { point: { slot: 123456789, hash: hash.toString("hex") }, tip: tipOut },
    });
    expect(client.NodeToClientChainSync.state).toBe("StIdle");

    client.NodeToClientChainSync.requestNext();
    expect(await chainSync.next()).toEqual({ await: true });
    const forward = await chainSync.next();
    expect(Buffer.isBuffer(forward.rollForward.block)).toBe(true);
    expect(forward.rollForward.block.equals(block)).toBe(true);
    expect(forward.rollForward.tip).toEqual(tipOut);
    expect(client.NodeToClientChainSync.state).toBe("StIdle");

    client.LocalTxMonitor.acquireSnapshot();
    expect(await txMonitor.next()).toEqual({ acquired: 555 });
    expect(client.LocalTxMonitor.state).toBe("StAcquired");
    client.LocalTxMonitor.requestNextTx();
    const next = await txMonitor.next();
    expect(next.nextTx.equals(tx)).toBe(true);
    client.LocalTxMonitor.requestNextTx();
    expect(await txMonitor.next()).toEqual({ nextTx: null });

    client.LocalTransactionSubmission.submitTransaction(6, tx);
    expect(await txSubmission.next()).toEqual({ success: true });
    client.LocalTransactionSubmission.submitTransaction(6, tx);
    const rejected = await txSubmission.next();
    expect(rejected.rejectionMessage).toBeInstanceOf(Map);
    expect(Buffer.from(rejected.rejectionMessage.get(1)[0]).toString("hex")).toBe("aa");

    client.NodeToClientChainSync.done();
    client.LocalTxMonitor.release();
    client.LocalTxMonitor.done();
    client.LocalTransactionSubmission.done();
    expect(client.NodeToClientChainSync.state).toBe("StDone");
    expect(client.LocalTxMonitor.state).toBe("StDone");
    expect(client.LocalTransactionSubmission.state).toBe("StDone");

    const disconnected = once(client, "disconnect");
    client.disconnect();
    await disconnected;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(errors).toEqual([]);
    expect(received).toEqual(script.map((step) => [step.protocol, step.request]));
  });

  it("drops the connection when a segment stalls for longer than sduTimeout", async () => {
    // the node's intersect reply cut short, then silence
    const stalled = script[1].replies[0].subarray(0, 20);
    const { server, received } = fakeNode([script[0], { ...script[1], replies: [stalled] }]);
    const port = await listen(server);
    const closed = new Promise<void>((resolve) =>
      server.on("connection", (conn) => conn.on("close", () => resolve()))
    );

    const client = new OuroborosClient({ protocolId: 32784, protocolMagic: MAGIC, sduTimeout: 50 });
    const failure = once(client, "error");
    // not events.once: that would reject on the error the test is waiting for
    const disconnected = new Promise<void>((resolve) => client.once("disconnect", resolve));
    const connected = once(client, "connect");
    client.connect(port, "127.0.0.1");
    await connected;

    client.NodeToClientChainSync.findIntersect([{ slot: 123456789, hash: hash.toString("hex") }]);
    const [error] = await failure;
    expect(error).toBeInstanceOf(SduReadTimeoutError);
    await disconnected;
    await closed;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(received).toEqual([
      [0, script[0].request],
      [5, script[1].request],
    ]);
  });

  it("refuses requests before the handshake and after disconnect, and connects once", async () => {
    const { server } = fakeNode([script[0]]);
    const port = await listen(server);

    const client = new OuroborosClient({ protocolId: 32784, protocolMagic: MAGIC });
    const chainSync = client.NodeToClientChainSync;
    expect(() => chainSync.requestNext()).toThrow(ProtocolViolationError);
    expect(() => chainSync.requestNext()).toThrow(
      "NodeToClientChainSync: MsgRequestNext cannot be sent while the client is not connected"
    );
    expect(chainSync.state).toBe("StIdle");

    const connected = once(client, "connect");
    client.connect(port, "127.0.0.1");
    expect(() => client.connect(port, "127.0.0.1")).toThrow(/already connecting/);
    expect(() => chainSync.requestNext()).toThrow(/not connected/);
    await connected;
    expect(() => client.connect(port, "127.0.0.1")).toThrow(/already connected/);

    const disconnected = once(client, "disconnect");
    client.disconnect();
    expect(() => chainSync.requestNext()).toThrow(/not connected/);
    await disconnected;
    expect(() => client.connect(port, "127.0.0.1")).toThrow(/closed client/);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports a refused handshake and closes", async () => {
    const refusal = { ...script[0], replies: [segment(0, bytes([2, [0, [32780, 32781]]]))] };
    const { server } = fakeNode([refusal]);
    const port = await listen(server);
    const closed = new Promise<void>((resolve) =>
      server.on("connection", (conn) => conn.on("close", () => resolve()))
    );

    const client = new OuroborosClient({ protocolId: 32784, protocolMagic: MAGIC });
    let connects = 0;
    client.on("connect", () => connects++);
    const failure = once(client, "error");
    const disconnected = new Promise<void>((resolve) => client.once("disconnect", resolve));
    client.connect(port, "127.0.0.1");
    const [error] = await failure;
    expect(error).toBeInstanceOf(HandshakeRefusedError);
    expect(error).toMatchObject({ reason: "VersionMismatch", versions: [32780, 32781] });
    expect(error.message).toBe(
      "handshake refused: version mismatch, the node supports 32780, 32781"
    );
    await disconnected;
    await closed;
    expect(connects).toBe(0);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("drops the connection when the node breaks a mini protocol", async () => {
    // a roll backward answering the intersect request
    const wrong = { ...script[1], replies: [segment(5, bytes([3, [], tip]))] };
    const { server, received } = fakeNode([script[0], wrong]);
    const port = await listen(server);
    const closed = new Promise<void>((resolve) =>
      server.on("connection", (conn) => conn.on("close", () => resolve()))
    );

    const client = new OuroborosClient({ protocolId: 32784, protocolMagic: MAGIC });
    const chainSync = client.NodeToClientChainSync;
    const failure = once(chainSync, "error");
    const disconnected = new Promise<void>((resolve) => client.once("disconnect", resolve));
    const connected = once(client, "connect");
    client.connect(port, "127.0.0.1");
    await connected;

    chainSync.findIntersect([{ slot: 123456789, hash: hash.toString("hex") }]);
    const [error] = await failure;
    expect(error).toBeInstanceOf(ProtocolViolationError);
    expect(error).toMatchObject({
      protocol: "NodeToClientChainSync",
      state: "StIntersect",
      side: "node",
    });
    expect(chainSync.state).toBe("StIntersect");
    await disconnected;
    await closed;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(received).toEqual([
      [0, script[0].request],
      [5, script[1].request],
    ]);
  });
});
