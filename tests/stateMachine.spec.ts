import { describe, it, expect } from "vitest";
import { StateMachine, ProtocolViolationError } from "../src/stateMachine";
import { nodeToClientChainSyncProtocol } from "../src/protocols/NodeToClientChainSync";
import { localTxMonitorProtocol } from "../src/protocols/LocalTxMonitor";

const caught = (attempt: () => void): unknown => {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
};

describe("StateMachine", () => {
  it("starts in the initial state with the client's messages allowed", () => {
    const m = new StateMachine(nodeToClientChainSyncProtocol);
    expect(m.name).toBe("NodeToClientChainSync");
    expect(m.state).toBe("StIdle");
    expect(m.agency).toBe("client");
    expect(m.allowed).toEqual(["MsgRequestNext", "MsgFindIntersect", "MsgDone"]);
  });

  it("follows the client's messages and the node's replies", () => {
    const m = new StateMachine(nodeToClientChainSyncProtocol);
    m.send("MsgRequestNext");
    expect(m.state).toBe("StCanAwait");
    expect(m.agency).toBe("server");
    expect(m.allowed).toEqual(["MsgAwaitReply", "MsgRollForward", "MsgRollBackward"]);
    expect(m.receive(1)).toBe("MsgAwaitReply");
    expect(m.state).toBe("StMustReply");
    expect(m.receive(2)).toBe("MsgRollForward");
    expect(m.state).toBe("StIdle");
    m.send("MsgFindIntersect");
    expect(m.receive(6)).toBe("MsgIntersectNotFound");
    m.send("MsgDone");
    expect(m.state).toBe("StDone");
    expect(m.agency).toBe("nobody");
    expect(m.allowed).toEqual([]);
  });

  it("refuses a request while the node has agency, leaving the state alone", () => {
    const m = new StateMachine(nodeToClientChainSyncProtocol);
    m.send("MsgRequestNext");
    const attempt = () => m.send("MsgRequestNext");
    expect(attempt).toThrow(ProtocolViolationError);
    expect(attempt).toThrow(
      "NodeToClientChainSync: MsgRequestNext cannot be sent in state StCanAwait, the node has agency there"
    );
    expect(caught(attempt)).toMatchObject({
      name: "ProtocolViolationError",
      protocol: "NodeToClientChainSync",
      state: "StCanAwait",
      side: "client",
    });
    expect(m.state).toBe("StCanAwait");
  });

  it("refuses a request the state does not allow even though the client has agency", () => {
    const m = new StateMachine(localTxMonitorProtocol);
    m.send("MsgAcquire");
    m.receive(2);
    expect(m.state).toBe("StAcquired");
    expect(() => m.send("MsgDone")).toThrow(
      "LocalTxMonitor: MsgDone cannot be sent in state StAcquired, only MsgAwaitAcquire, MsgRelease or MsgNextTx can be sent there"
    );
    expect(() => m.send("MsgAcquire")).toThrow(/only MsgAwaitAcquire/);
    m.send("MsgAwaitAcquire");
    expect(m.state).toBe("StAcquiring");
  });

  it("refuses anything once the protocol has finished", () => {
    const m = new StateMachine(nodeToClientChainSyncProtocol);
    m.send("MsgDone");
    expect(() => m.send("MsgRequestNext")).toThrow(
      "NodeToClientChainSync: MsgRequestNext cannot be sent in state StDone, the protocol has finished"
    );
    expect(() => m.receive(2)).toThrow(
      "NodeToClientChainSync: the node sent a message (tag 2) in state StDone, after the protocol has finished"
    );
  });

  it("reports a message the node may not send, leaving the state alone", () => {
    const m = new StateMachine(nodeToClientChainSyncProtocol);
    const idle = () => m.receive(2);
    expect(idle).toThrow(ProtocolViolationError);
    expect(idle).toThrow(
      "NodeToClientChainSync: the node sent a message (tag 2) in state StIdle, where the client has agency"
    );
    expect(caught(idle)).toMatchObject({
      protocol: "NodeToClientChainSync",
      state: "StIdle",
      side: "node",
    });

    m.send("MsgFindIntersect");
    expect(() => m.receive(2)).toThrow(
      "NodeToClientChainSync: the node sent MsgRollForward in state StIntersect, expected MsgIntersectFound or MsgIntersectNotFound"
    );
    expect(() => m.receive(9)).toThrow(
      "the node sent an unknown message (tag 9) in state StIntersect"
    );
    expect(() => m.receive(undefined)).toThrow(
      "the node sent an unknown message (no valid tag) in state StIntersect"
    );
    // a tag of the client's is not one of the node's messages
    expect(() => m.receive(4)).toThrow(/an unknown message \(tag 4\)/);
    expect(m.state).toBe("StIntersect");
  });
});
