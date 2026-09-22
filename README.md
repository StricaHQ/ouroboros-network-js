<p align="center">
  <a href="https://strica.io/" target="_blank">
    <img src="https://docs.strica.io/images/logo.png" width="200">
  </a>
</p>

# @stricahq/ouroboros-network-js

[![npm](https://img.shields.io/npm/v/@stricahq/ouroboros-network-js.svg)](https://www.npmjs.com/package/@stricahq/ouroboros-network-js)
[![downloads](https://img.shields.io/npm/dm/@stricahq/ouroboros-network-js.svg)](https://www.npmjs.com/package/@stricahq/ouroboros-network-js)
[![node](https://img.shields.io/node/v/@stricahq/ouroboros-network-js.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@stricahq/ouroboros-network-js.svg)](./LICENSE)

Cardano node-to-client networking for Node.js, written in TypeScript. Point it at a local `cardano-node` socket and it does the handshake, runs the mux and gives you the mini protocols as event emitters. That's enough to follow the chain, watch the mempool and submit transactions from JavaScript, with nothing between you and the node.

- Works over a unix socket or TCP
- All mini protocols run over one connection, streaming in both directions
- Blocks and transactions come back as the raw CBOR bytes the node sent, so you can hash or decode them yourself

Supported protocol ID: `32784` (node-to-client version 16)

Mini protocols implemented so far:

- Local chain sync
- Local transaction submission
- Local tx monitor

This is only a networking library. It frames, multiplexes and decodes the protocol messages and leaves the Cardano data inside them alone. Use [cardano-codec](https://github.com/StricaHQ/cardano-codec) or [cbors](https://github.com/StricaHQ/cbors) to decode the blocks and transactions you get back.

Please create an issue if you want to add support for another mini protocol.

## Used By

- [cardanoscan.io](https://cardanoscan.io)
- [Typhon Wallet](https://typhonwallet.io)

## Installation

```sh
yarn add @stricahq/ouroboros-network-js
```

Needs Node.js 22.12 or newer. The package is ESM only, but Node 22.12+ can `require()` it from CommonJS as well.

## Quick start

Following the chain from origin:

```ts
import { OuroborosClient } from "@stricahq/ouroboros-network-js";

const client = new OuroborosClient({
  protocolId: 32784,
  protocolMagic: 764824073, // mainnet
});
const chainSync = client.NodeToClientChainSync;

client.on("error", (error) => console.error(error));
client.on("disconnect", () => console.log("disconnected"));
chainSync.on("error", (error) => console.error(error));

chainSync.on("data", (message) => {
  if (message.rollForward) {
    const { block, tip } = message.rollForward; // block: the block's CBOR as a Buffer
  }
  if (message.rollBackward) {
    const { point } = message.rollBackward; // roll your state back to this point
  }
  if (message.intersectNotFound) {
    return chainSync.done();
  }
  if (message.await) {
    return; // at the tip, the node replies on its own when the next block arrives
  }
  chainSync.requestNext();
});

client.on("connect", () => {
  chainSync.findIntersect([]); // [] means origin, otherwise pass the points you have
});

client.connect("/path/to/node.socket");
```

After `findIntersect` the node answers with `intersectFound`, and the first `requestNext()` after that gets a `rollBackward` to that point before any blocks. Once you see `{ await: true }` you're at the tip. The node answers that request when the next block arrives, and calling `requestNext()` again before then throws, since it's the node's turn.

## Client

```ts
new OuroborosClient({ protocolId, protocolMagic, sduTimeout });
```

| Option          | Description                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `protocolId`    | The node-to-client version to propose in the handshake. Use `32784`.                                                             |
| `protocolMagic` | Network magic. `764824073` for mainnet, `1` for preprod, `2` for preview.                                                        |
| `sduTimeout`    | How long a mux segment gets to arrive whole once it has started, in milliseconds. `30000` by default, see [Timeouts](#timeouts). |

`connect(path)` opens the node's unix socket. `connect(port)` and `connect(port, host)` go over TCP. `disconnect()` closes the connection.

A client connects once. Calling `connect()` a second time throws, even after the connection has closed, so make a new client if you need to reconnect.

| Event        | When                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| `connect`    | The handshake went through and the mini protocols can be used. Requests before this throw. |
| `error`      | Something went wrong with the connection, see below.                                       |
| `disconnect` | The connection is closed, by either side.                                                  |

Every error closes the connection, so `error` is always followed by `disconnect`. The error tells you what happened:

- a plain socket error, say the socket path doesn't exist or the node went away
- `HandshakeRefusedError` when the node didn't accept the proposed version. `reason` says why, and on a `VersionMismatch` `versions` lists what the node does support
- `ProtocolViolationError` when the node's handshake reply came out of turn, or a plain `Error` when it didn't decode
- `SduReadTimeoutError` when a mux segment stalled halfway, see [Timeouts](#timeouts)
- a plain `Error` when the node sent a segment for a mini protocol the client doesn't run

## Mini protocols

The mini protocols hang off the client as `client.NodeToClientChainSync`, `client.LocalTxMonitor` and `client.LocalTransactionSubmission`. Each one is an event emitter with the request methods listed below. Whatever the node sends back comes out as a `data` event, decoded into the shapes in the tables. Points and tips are `{ slot, hash }` with the hash in hex, and the origin is the empty point `{}`.

### States and agency

Every mini protocol is a state machine. In each state one side gets to send (it has _agency_) and each message moves the protocol on to the next state. You can read `state` and `agency` off a protocol at any time. `agency` is `client`, `server`, or `nobody` once the protocol is done. The state names are the ones from the Ouroboros network specification, listed per protocol below.

The client checks both sides against it:

- A request the current state doesn't allow throws a `ProtocolViolationError` and nothing goes out. That includes a request while it's the node's turn, `done()` while you still hold a mempool snapshot, and any request before `connect` or after `disconnect`.
- A message the node isn't allowed to send in the current state, or one that doesn't decode, comes out as an `error` event on the mini protocol and the client drops the connection. Make sure something is listening for it, otherwise the unhandled `error` event throws like it would on any Node emitter.

`ProtocolViolationError` carries the `protocol`, the `state` at the time and which `side` broke the rules, `client` or `node`.

```ts
import { ProtocolViolationError } from "@stricahq/ouroboros-network-js";

try {
  chainSync.requestNext();
} catch (error) {
  if (error instanceof ProtocolViolationError) {
    // "NodeToClientChainSync: MsgRequestNext cannot be sent in state StCanAwait, the node has agency there"
    console.error(error.message, chainSync.state, chainSync.agency);
  }
}
```

### Chain sync

`client.NodeToClientChainSync`

| Method                  | Sends                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| `findIntersect(points)` | The points to try, newest first. An empty array asks for the origin. |
| `requestNext()`         | A request for the next block, or a rollback.                         |
| `done()`                | The end of the protocol.                                             |

| Reply                                | Meaning                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `{ intersectFound: { point, tip } }` | The first of your points that's on the node's chain, plus the node's tip.                                         |
| `{ intersectNotFound: { tip } }`     | None of your points are on the node's chain.                                                                      |
| `{ rollForward: { block, tip } }`    | The next block. `block` is a `Buffer` with the block's CBOR, exactly as the node encoded it.                      |
| `{ rollBackward: { point, tip } }`   | Roll back to `point`. You get one right after an intersection is found, and whenever the node's chain switches.   |
| `{ await: true }`                    | You've reached the tip. The node answers the pending request when the next block shows up, so don't send another. |

| State         | Turn   | Next                                                                                      |
| ------------- | ------ | ----------------------------------------------------------------------------------------- |
| `StIdle`      | client | `requestNext()` to `StCanAwait`, `findIntersect()` to `StIntersect`, `done()` to `StDone` |
| `StCanAwait`  | node   | `{ await }` to `StMustReply`, `{ rollForward }` or `{ rollBackward }` to `StIdle`         |
| `StMustReply` | node   | `{ rollForward }` or `{ rollBackward }` to `StIdle`                                       |
| `StIntersect` | node   | `{ intersectFound }` or `{ intersectNotFound }` to `StIdle`                               |
| `StDone`      | nobody | –                                                                                         |

### Local tx monitor

`client.LocalTxMonitor`

| Method              | Sends                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acquireSnapshot()` | A request for a snapshot of the mempool, answered with `{ acquired: slot }`. Call it again while you hold a snapshot to ask for the next one, which the node answers once the mempool has changed. |
| `requestNextTx()`   | A request for the next transaction in the snapshot. Answered with `{ nextTx: Buffer }` holding the transaction's CBOR, or `{ nextTx: null }` once there are no more.                               |
| `release()`         | Lets go of the snapshot. Has to happen before `done()` while you hold one.                                                                                                                         |
| `done()`            | The end of the protocol.                                                                                                                                                                           |

| State         | Turn   | Next                                                                                         |
| ------------- | ------ | -------------------------------------------------------------------------------------------- |
| `StIdle`      | client | `acquireSnapshot()` to `StAcquiring`, `done()` to `StDone`                                   |
| `StAcquiring` | node   | `{ acquired }` to `StAcquired`                                                               |
| `StAcquired`  | client | `requestNextTx()` to `StBusy`, `acquireSnapshot()` to `StAcquiring`, `release()` to `StIdle` |
| `StBusy`      | node   | `{ nextTx }` to `StAcquired`                                                                 |
| `StDone`      | nobody | –                                                                                            |

### Local transaction submission

`client.LocalTransactionSubmission`

| Method                           | Sends                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submitTransaction(era, txCbor)` | The transaction's CBOR bytes tagged with its era index (`6` for Conway). Answered with `{ success: true }` or `{ rejectionMessage }`, the node's reason decoded from CBOR. Its shape depends on the era. |
| `done()`                         | The end of the protocol.                                                                                                                                                                                 |

| State    | Turn   | Next                                                    |
| -------- | ------ | ------------------------------------------------------- |
| `StIdle` | client | `submitTransaction()` to `StBusy`, `done()` to `StDone` |
| `StBusy` | node   | `{ success }` or `{ rejectionMessage }` to `StIdle`     |
| `StDone` | nobody | –                                                       |

## Timeouts

There's no limit on how long the client waits for the next message. An idle connection is normal. Chain sync at the tip can sit there for minutes without a byte. What is limited is a message that has already started arriving. Once the first bytes of a mux segment are in, the rest has to follow within `sduTimeout` milliseconds, `30000` by default. If it doesn't, the client emits an `error` with an `SduReadTimeoutError`, closes the socket and emits `disconnect`.

```ts
const client = new OuroborosClient({
  protocolId: 32784,
  protocolMagic: 764824073,
  sduTimeout: 10_000, // 0 turns the limit off
});
```

## Tests

```sh
yarn test
```

The tests run against a scripted fake node on a loopback socket, so you don't need a Cardano node around.

## API Doc

Find the API documentation [here](https://docs.strica.io/lib/ouroboros-network-js)

# License

Copyright 2023 Strica

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
