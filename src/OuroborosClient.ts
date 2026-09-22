import { Socket } from "node:net";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import DeMux, { type Segment } from "./DeMux";
import type { Transport } from "./protocols/MiniProtocol";
import Handshake, { HandshakeRefusedError } from "./protocols/Handshake";
import NodeToClientChainSync from "./protocols/NodeToClientChainSync";
import LocalTxMonitor from "./protocols/LocalTxMonitor";
import LocalTransactionSubmission from "./protocols/LocalTransactionSubmission";
import type { Options } from "./types";

type OuroborosClientEvents = {
  connect: [];
  error: [Error];
  disconnect: [];
};

type Status = "idle" | "connecting" | "connected" | "closed";

export class OuroborosClient extends EventEmitter<OuroborosClientEvents> {
  private options: Options;
  private socket: Socket;
  private status: Status = "idle";
  private handshake: Handshake;
  NodeToClientChainSync;
  LocalTxMonitor;
  LocalTransactionSubmission;

  constructor(options: Options) {
    super();
    this.options = options;
    this.socket = new Socket({});

    const incoming = new Map<number, Readable>();
    const inbound = (protocol: number) => {
      const stream = new Readable({ read() {} });
      incoming.set(protocol, stream);
      return stream;
    };

    const link = (ready: () => boolean): Transport => ({
      get ready() {
        return ready();
      },
      write: (packet) => {
        this.socket.write(packet);
      },
      abort: () => this.close(),
    });

    const deMultiPlexer = new DeMux({ sduTimeout: this.options.sduTimeout });
    this.socket.pipe(deMultiPlexer);
    deMultiPlexer.on("error", (error: Error) => this.close(error));
    deMultiPlexer.on("data", (segment: Segment) => {
      const stream = incoming.get(segment.protocol);
      if (stream === undefined) {
        return this.close(
          new Error(`mux: a segment for mini protocol ${segment.protocol}, which is not in use`)
        );
      }
      stream.push(segment.bytes);
    });

    this.socket.on("error", (error) => {
      this.emit("error", error);
    });

    this.socket.on("close", () => {
      this.status = "closed";
      deMultiPlexer.destroy(); // drops a pending segment and its clock
      this.emit("disconnect");
    });

    this.socket.on("connect", () => {
      this.handshake.proposeVersions(this.options.protocolId, this.options.protocolMagic);
    });

    // the handshake runs as soon as the socket is up, the others once it is accepted
    this.handshake = new Handshake(
      link(() => true),
      inbound(0)
    );
    this.handshake.on("data", (reply) => {
      if (this.status !== "connecting") return; // disconnected while waiting for the answer
      if ("accepted" in reply) {
        this.status = "connected";
        this.emit("connect");
      } else if ("refused" in reply) {
        this.close(new HandshakeRefusedError(reply.refused));
      } else {
        const versions = [...reply.versions.keys()];
        this.close(new HandshakeRefusedError({ reason: "QueryReply", versions }));
      }
    });
    // the protocol drops the connection itself after a fault of the node's
    this.handshake.on("error", (error) => {
      this.emit("error", error);
    });

    const ready = () => this.status === "connected";
    this.NodeToClientChainSync = new NodeToClientChainSync(link(ready), inbound(5));
    this.LocalTransactionSubmission = new LocalTransactionSubmission(link(ready), inbound(6));
    this.LocalTxMonitor = new LocalTxMonitor(link(ready), inbound(9));
  }

  connect(unixSocket: string): void;
  connect(port: number): void;
  connect(port: number, host: string): void;
  connect(a: unknown, b?: unknown) {
    if (this.status === "closed") {
      throw new Error(
        "connect() on a closed client: an OuroborosClient connects once, create a new one to connect again"
      );
    }
    if (this.status !== "idle") {
      throw new Error(`connect() while already ${this.status}`);
    }
    if (a && !b) {
      this.status = "connecting";
      this.socket.connect(a as number);
    } else if (typeof a === "number" && typeof b === "string") {
      this.status = "connecting";
      this.socket.connect(a, b);
    } else {
      throw new Error("Invalid arguments");
    }
  }

  disconnect() {
    this.status = "closed";
    this.socket.end();
  }

  private close(error?: Error) {
    this.status = "closed";
    this.socket.destroy();
    if (error !== undefined) this.emit("error", error);
  }
}

export default OuroborosClient;
