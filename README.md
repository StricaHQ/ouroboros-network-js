<p align="center">
  <a href="https://strica.io/" target="_blank">
    <img src="https://docs.strica.io/images/logo.png" width="200">
  </a>
</p>

# @stricahq/ouroboros-network-js
Ouroboros network library written in typescript with nodejs streaming module. This library has been developed with extensive testing and research done by communicating with Haskell Cardano Node with edge cases and scenarios. Supports multiplexing and streaming for seamless communication between clients. Simple yet sophisticated project structure and modular design of multiplexer and de-multiplexer to support all ouroboros mini protocols without hassle.

✅ Supports communication over unix socket and TCP
✅ Built using nodejs Stream for efficient communication
✅ Stable multiplexer and de-multiplexer
✅ Modular and scalable design

## Currently Implemented Mini Protocols
- Local Chain Sync
- Local Transaction Submission
- Local Tx Monitor

Please note that this is only a networking library and is polymorphic in nature. Use [cbors](https://github.com/StricaHQ/cbors) and [Cardano Codec](https://github.com/StricaHQ/cardano-codec) for decoding and parsing the Cardano data objects returned by the mini protocols.

Please create an issue if you want to add support for another mini protocol
## Used By
- [cardanoscan.io](https://cardanoscan.io)
- [Typhon Wallet](https://typhonwallet.io)

## Installation

### yarn/npm

```sh
yarn add @stricahq/ouroboros-network-js
```

## Tests
TODO

## Examples
TODO

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