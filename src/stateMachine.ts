/**
 * Runtime counterpart of the typed protocol state machines in the Haskell
 * ouroboros-network implementation. A mini protocol is a set of states, each
 * with one side that may send next (its agency), and a set of messages that
 * each move the protocol from one state to another. Keeping track of that lets
 * a request the state does not allow be refused before it is sent, and a
 * message the node may not send be reported.
 */

/** Who may send the next message in a state. */
export type Agency = "client" | "server" | "nobody";

/** A message: its CBOR tag, the states it may be sent from and the state it leads to. */
export type Transition<S extends string> = {
  tag: number;
  from: S | readonly S[];
  to: S;
};

export type ProtocolSpec<S extends string, M extends string> = {
  /** the protocol's name as it appears in errors */
  name: string;
  init: S;
  agency: Record<S, Agency>;
  messages: Record<M, Transition<S>>;
};

/**
 * A message was sent, or arrived, in a state that does not allow it. `side`
 * says who broke the rules: `client` for a request this process made, thrown
 * from the request method before anything is sent, or `node` for a message the
 * node sent, reported as an `error` event after which the connection is closed.
 */
export class ProtocolViolationError extends Error {
  /** the mini protocol, e.g. `NodeToClientChainSync` */
  readonly protocol: string;
  /** the protocol's state at the time, e.g. `StCanAwait` */
  readonly state: string;
  readonly side: "client" | "node";

  constructor(protocol: string, state: string, side: "client" | "node", detail: string) {
    super(`${protocol}: ${detail}`);
    this.name = "ProtocolViolationError";
    this.protocol = protocol;
    this.state = state;
    this.side = side;
  }
}

// "MsgA, MsgB or MsgC"
const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];

const describeTag = (tag: unknown) => (typeof tag === "number" ? `tag ${tag}` : "no valid tag");

export class StateMachine<S extends string, M extends string> {
  readonly name: string;
  private readonly agencies: Record<S, Agency>;
  private readonly messages: Map<M, { tag: number; from: ReadonlySet<S>; to: S }>;
  private current: S;

  constructor(spec: ProtocolSpec<S, M>) {
    this.name = spec.name;
    this.agencies = spec.agency;
    this.current = spec.init;
    this.messages = new Map(
      (Object.keys(spec.messages) as M[]).map((name) => {
        const { tag, from, to } = spec.messages[name];
        return [name, { tag, from: new Set(typeof from === "string" ? [from] : from), to }];
      })
    );
  }

  get state(): S {
    return this.current;
  }

  get agency(): Agency {
    return this.agencies[this.current];
  }

  /** The messages that may be sent next, by whichever side has agency. */
  get allowed(): M[] {
    return [...this.messages].filter(([, t]) => t.from.has(this.current)).map(([name]) => name);
  }

  /**
   * Moves along `name`, a message of the client's, or throws when the client
   * may not send it in the current state.
   */
  send(name: M): void {
    const transition = this.messages.get(name);
    if (transition === undefined || !transition.from.has(this.current)) {
      throw new ProtocolViolationError(
        this.name,
        this.current,
        "client",
        `${name} cannot be sent in state ${this.current}, ${this.reason()}`
      );
    }
    this.current = transition.to;
  }

  /**
   * Moves along the node's message with this tag and returns its name, or
   * throws when the node may not send it in the current state.
   */
  receive(tag: unknown): M {
    if (this.agency !== "server") {
      const why =
        this.agency === "client"
          ? "where the client has agency"
          : "after the protocol has finished";
      throw new ProtocolViolationError(
        this.name,
        this.current,
        "node",
        `the node sent a message (${describeTag(tag)}) in state ${this.current}, ${why}`
      );
    }
    const name = this.allowed.find((candidate) => this.messages.get(candidate)!.tag === tag);
    if (name === undefined) {
      const sent = this.serverMessage(tag) ?? `an unknown message (${describeTag(tag)})`;
      throw new ProtocolViolationError(
        this.name,
        this.current,
        "node",
        `the node sent ${sent} in state ${this.current}, expected ${list(this.allowed)}`
      );
    }
    this.current = this.messages.get(name)!.to;
    return name;
  }

  // why the client may not send now
  private reason(): string {
    switch (this.agency) {
      case "server":
        return "the node has agency there";
      case "nobody":
        return "the protocol has finished";
      default:
        return `only ${list(this.allowed)} can be sent there`;
    }
  }

  // the name of the node's message with this tag, whatever the state
  private serverMessage(tag: unknown): M | undefined {
    for (const [name, t] of this.messages) {
      if (t.tag === tag && [...t.from].every((s) => this.agencies[s] === "server")) return name;
    }
    return undefined;
  }
}

export default StateMachine;
