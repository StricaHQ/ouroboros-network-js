import { Socket } from "net";
import StateMachine from "javascript-state-machine";
import EventEmitter from "events";
import stream from "stream";
import { makeHandshakeMsg } from "./protocol";
import DeMux from "./DeMux";
import NodeToClientChainSync from "./protocols/NodeToClientChainSync";
import LocalTxMonitor from "./protocols/LocalTxMonitor";
import LocalTransactionSubmission from "./protocols/LocalTransactionSubmission";
import { Options } from "./types";

export declare interface OuroborosClient {
  on(event: "connect", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "disconnect", listener: () => void): this;
}
// eslint-disable-next-line no-redeclare
export class OuroborosClient extends EventEmitter {
  private options: Options;
  private socket: Socket;
  private fsm;
  NodeToClientChainSync;
  LocalTxMonitor;
  LocalTransactionSubmission;

  constructor(options: Options) {
    super();
    this.options = options;
    this.socket = new Socket({});
    const socketStream = new stream.Readable({
      read() {},
    });
    const NodeToClientChainSyncDecoderStream = new stream.Readable({
      read() {},
    });

    const LocalTxMonitorDecoderStream = new stream.Readable({
      read() {},
    });

    const LocalTransactionSubmissionDecoderStream = new stream.Readable({
      read() {},
    });

    const deMultiPlexer = new DeMux();

    this.fsm = new StateMachine({
      init: "OFF",
      transitions: [
        { name: "connect", from: "OFF", to: "ON" },
        { name: "disconnect", from: ["ON", "OFF", "Idle"], to: "OFF" },
        { name: "query", from: ["ON", "Idle"], to: "Idle" },
      ],
    });

    this.socket.on("error", (error) => {
      this.emit("error", error);
    });

    this.socket.on("end", () => {
      this.fsm.disconnect();
      this.emit("disconnect");
    });

    this.socket.on("connect", () => {
      const packet = makeHandshakeMsg(this.options.protocolId, this.options.protocolMagic);
      this.socket.write(packet);
    });

    this.socket.on("data", (data) => {
      if (this.fsm.is("OFF")) {
        this.fsm.connect();
        this.emit("connect");
      } else {
        socketStream.push(data);
      }
    });

    socketStream.pipe(deMultiPlexer);
    deMultiPlexer.on("data", (data: { protocol: number; bytes: Buffer }) => {
      switch (data.protocol) {
        case 5: {
          NodeToClientChainSyncDecoderStream.push(data.bytes);
          break;
        }
        case 6: {
          LocalTransactionSubmissionDecoderStream.push(data.bytes);
          break;
        }
        case 9: {
          LocalTxMonitorDecoderStream.push(data.bytes);
          return;
        }
        default: {
          throw new Error("Protocol not supported");
        }
      }
    });

    this.NodeToClientChainSync = new NodeToClientChainSync(
      this.socket,
      NodeToClientChainSyncDecoderStream
    );

    this.LocalTxMonitor = new LocalTxMonitor(this.socket, LocalTxMonitorDecoderStream);

    this.LocalTransactionSubmission = new LocalTransactionSubmission(
      this.socket,
      LocalTransactionSubmissionDecoderStream
    );
  }

  connect(unixSocket: string): void;
  // eslint-disable-next-line no-dupe-class-members
  connect(port: number): void;
  // eslint-disable-next-line no-dupe-class-members
  connect(port: number, host: string): void;
  // eslint-disable-next-line no-dupe-class-members
  connect(a: unknown, b?: unknown) {
    if (a && !b) {
      this.socket.connect(a as number);
    } else if (typeof a === "number" && typeof b === "string") {
      this.socket.connect(a, b);
    } else {
      throw new Error("Invalid arguments");
    }
  }

  disconnect() {
    this.socket.end();
  }
}

export default OuroborosClient;
