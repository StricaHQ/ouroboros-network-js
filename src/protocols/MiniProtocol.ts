import { encode, type CborNode } from "@stricahq/cbors";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import PacketStreamer from "../PacketStreamer";
import CborDecoderStream, { type AnnotatedItem } from "../CborDecoderStream";
import {
  StateMachine,
  ProtocolViolationError,
  type Agency,
  type ProtocolSpec,
} from "../stateMachine";

/** What a mini protocol needs from the connection it runs over. */
export type Transport = {
  /** Whether messages may be sent: the handshake is done and the socket open. */
  readonly ready: boolean;
  /** Writes one mux segment to the socket. */
  write(packet: Buffer): void;
  /** Drops the connection after a fault on the node's side. */
  abort(): void;
};

export type MiniProtocolEvents<R> = {
  data: [R];
  error: [Error];
};

/**
 * One mini protocol over the mux. Outgoing messages are framed into segments
 * and written to the transport, incoming segment payloads are decoded into
 * messages and handed to `parse`, and the protocol's state machine is kept
 * along the way: a request the state does not allow is refused before it is
 * sent, and a message the node may not send, or one that does not parse, is
 * reported as an `error` event and drops the connection.
 */
export abstract class MiniProtocol<S extends string, M extends string, R> extends EventEmitter<
  MiniProtocolEvents<R>
> {
  private readonly machine: StateMachine<S, M>;
  private readonly transport: Transport;
  private readonly outgoing: Readable;

  constructor(
    spec: ProtocolSpec<S, M>,
    protocol: Buffer,
    transport: Transport,
    incoming: Readable,
    parse: (message: CborNode) => R
  ) {
    super();
    this.machine = new StateMachine(spec);
    this.transport = transport;

    this.outgoing = new Readable({ read() {} });
    const streamer = new PacketStreamer(protocol);
    this.outgoing.pipe(streamer);
    streamer.on("data", (packet: Buffer) => transport.write(packet));

    const decoder = new CborDecoderStream();
    incoming.pipe(decoder);
    decoder.on("data", ({ value }: AnnotatedItem) => {
      let message: R;
      try {
        this.machine.receive(value.kind === "array" ? value.at(0)?.toJS() : undefined);
        message = parse(value);
      } catch (error) {
        return this.fail(error as Error);
      }
      this.emit("data", message);
    });
    decoder.on("error", (error: Error) => this.fail(error));
  }

  /** The protocol's current state. */
  get state(): S {
    return this.machine.state;
  }

  /** Whose turn it is to send in the current state. */
  get agency(): Agency {
    return this.machine.agency;
  }

  /** Sends `payload` as the message `name`, once the state allows it. */
  protected send(name: M, payload: unknown): void {
    if (!this.transport.ready) {
      throw new ProtocolViolationError(
        this.machine.name,
        this.state,
        "client",
        `${name} cannot be sent while the client is not connected`
      );
    }
    this.machine.send(name);
    this.outgoing.push(encode(payload));
  }

  private fail(error: Error): void {
    this.emit("error", error);
    this.transport.abort();
  }
}

export default MiniProtocol;
