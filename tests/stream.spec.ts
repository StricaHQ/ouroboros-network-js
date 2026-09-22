import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { encode, CborTag } from "@stricahq/cbors";
import { CborDecoderStream, type AnnotatedItem } from "../src/CborDecoderStream";
import DeMux, { SduReadTimeoutError, type Segment } from "../src/DeMux";
import { PacketStreamer } from "../src/PacketStreamer";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const tip = [[1000, Buffer.alloc(32, 0xab)], 42];
const messages = [[1], [2, new CborTag(Buffer.from("9f1817ff", "hex"), 24), tip], [6, tip]].map(
  (value) => Buffer.from(encode(value))
);

const collect = <T>(stream: Readable) =>
  new Promise<T[]>((resolve, reject) => {
    const items: T[] = [];
    stream.on("data", (item: T) => items.push(item));
    stream.on("error", reject);
    stream.on("end", () => resolve(items));
  });

const decodeAll = (chunks: Buffer[]) =>
  collect<AnnotatedItem>(Readable.from(chunks).pipe(new CborDecoderStream()));

const demux = (chunks: Buffer[]) => collect<Segment>(Readable.from(chunks).pipe(new DeMux()));

// a mux segment as the node sends it: the M bit marks the responder side
const segment = (protocol: number, payload: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(1234, 0);
  header.writeUInt16BE(protocol | 0x8000, 4);
  header.writeUInt16BE(payload.length, 6);
  return Buffer.concat([header, payload]);
};

const split = (bytes: Buffer, size: number) => {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return chunks;
};

describe("CborDecoderStream", () => {
  it("emits one annotated item per message from a single chunk", async () => {
    const items = await decodeAll([Buffer.concat(messages)]);
    expect(items.map((item) => hex(item.bytes))).toEqual(messages.map(hex));
  });

  it("reassembles messages split into one byte chunks", async () => {
    const joined = Buffer.concat(messages);
    const chunks = Array.from(joined, (byte) => Buffer.from([byte]));
    const items = await decodeAll(chunks);
    expect(items).toHaveLength(3);
    items.forEach((item, i) => {
      expect(item.value.kind).toBe("array");
      expect(hex(item.bytes)).toBe(hex(messages[i]));
      expect(hex(item.value.bytes)).toBe(hex(messages[i]));
    });
    // the tag 24 payload is a view into the item's own buffer
    expect(hex(items[1].value.at(1)!.child!.toJS())).toBe("9f1817ff");
  });

  it("surfaces decode errors on the stream", async () => {
    await expect(decodeAll([Buffer.from([0x1c])])).rejects.toThrow();
  });

  it("fails on a truncated item at end of input", async () => {
    await expect(decodeAll([Buffer.from([0x82, 0x01])])).rejects.toThrow(/unexpected end of input/);
  });
});

describe("DeMux", () => {
  // a mix of protocols and sizes, with an empty payload and a full size one
  const payloads: Array<[number, Buffer]> = [
    [5, messages[0]],
    [9, Buffer.alloc(0)],
    [6, randomBytes(12288)],
    [5, messages[1]],
  ];
  const stream = Buffer.concat(payloads.map(([protocol, payload]) => segment(protocol, payload)));
  const expected = payloads.map(([protocol, payload]) => [protocol, hex(payload)]);
  const view = (out: Segment[]) => out.map((s) => [s.protocol, hex(s.bytes)]);

  it("splits a chunk into its segments, clearing the M bit off the protocol id", async () => {
    expect(view(await demux([stream]))).toEqual(expected);
  });

  it("emits a segment that lies inside one chunk as a view of it, not a copy", async () => {
    const out = await demux([stream]);
    out.forEach((s) => expect(s.bytes.buffer).toBe(stream.buffer));
  });

  it.each([1, 7, 8, 9, 1000, 12296])(
    "reassembles segments from chunks of %i bytes",
    async (size) => {
      expect(view(await demux(split(stream, size)))).toEqual(expected);
    }
  );

  it("fails on a truncated segment at end of input", async () => {
    // inside the first header, and inside the second segment's header
    await expect(demux([stream.subarray(0, 5)])).rejects.toThrow(/unexpected end of input/);
    await expect(demux([stream.subarray(0, 11)])).rejects.toThrow(/unexpected end of input/);
  });
});

describe("PacketStreamer", () => {
  const CHAIN_SYNC = Buffer.from([0x00, 0x05]);
  const frame = (message: Buffer) =>
    collect<Buffer>(Readable.from([message]).pipe(new PacketStreamer(CHAIN_SYNC)));
  const header = (packet: Buffer) => ({
    protocol: packet.readUInt16BE(4),
    length: packet.readUInt16BE(6),
  });

  it("puts the 8 byte header in front of a message that fits one segment", async () => {
    const packets = await frame(messages[1]);
    expect(packets).toHaveLength(1);
    expect(header(packets[0])).toEqual({ protocol: 5, length: messages[1].length });
    expect(hex(packets[0].subarray(8))).toBe(hex(messages[1]));
  });

  it("cuts a longer message into segments of at most 12288 bytes", async () => {
    const message = randomBytes(30000);
    const packets = await frame(message);
    expect(packets.map((p) => header(p).length)).toEqual([12288, 12288, 5424]);
    expect(hex(Buffer.concat(packets.map((p) => p.subarray(8))))).toBe(hex(message));
  });

  it("round trips through the DeMux", async () => {
    const message = randomBytes(30000);
    const out = await collect<Segment>(
      Readable.from([message]).pipe(new PacketStreamer(CHAIN_SYNC)).pipe(new DeMux())
    );
    expect(out.map((s) => s.protocol)).toEqual([5, 5, 5]);
    expect(hex(Buffer.concat(out.map((s) => s.bytes)))).toBe(hex(message));
  });
});

// a small seeded PRNG (mulberry32), so a failing run can be replayed from its seed
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("mux round trip", () => {
  const protocols = [5, 6, 9];

  // frames one protocol's messages the way the client sends them, M bit set as the node would
  const frame = async (protocol: number, messages: Buffer[]) => {
    const packets = await collect<Buffer>(
      Readable.from(messages).pipe(new PacketStreamer(Buffer.from([0, protocol])))
    );
    packets.forEach((packet) => packet.writeUInt16BE(protocol | 0x8000, 4));
    return packets;
  };

  // the client's wiring: the DeMux fans segments out to one CborDecoderStream per protocol
  const receive = async (chunks: Buffer[]) => {
    const inputs = new Map(protocols.map((p) => [p, new Readable({ read() {} })]));
    const outputs = protocols.map((p) =>
      collect<AnnotatedItem>(inputs.get(p)!.pipe(new CborDecoderStream()))
    );
    const demux = Readable.from(chunks).pipe(new DeMux());
    demux.on("data", (s: Segment) => inputs.get(s.protocol)!.push(s.bytes));
    await once(demux, "end");
    inputs.forEach((input) => input.push(null));
    return Promise.all(outputs);
  };

  it.each([1, 2, 3, 4, 5])(
    "delivers messages of any size through any chunking, seed %i",
    async (seed) => {
      const random = prng(seed);
      const pick = (n: number) => Math.floor(random() * n);
      const shuffle = <T>(items: T[]) => {
        for (let i = items.length - 1; i > 0; i--) {
          const j = pick(i + 1);
          [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
      };

      // byte string lengths whose message (5 bytes of heads on top) is exactly one segment,
      // one segment and a byte, and exactly two segments, plus an empty one and random ones
      const sizes = [0, 12283, 12284, 24571, pick(200), pick(40000), pick(40000)];
      const sent = new Map(
        protocols.map((p) => [
          p,
          shuffle([...sizes]).map((size) => Buffer.from(encode([p, randomBytes(size)]))),
        ])
      );

      // interleave the protocols' segments as a mux would, each protocol staying in order
      const queues = new Map<number, Buffer[]>();
      for (const p of protocols) queues.set(p, await frame(p, sent.get(p)!));
      const packets: Buffer[] = [];
      while (queues.size > 0) {
        const live = [...queues.keys()];
        const p = live[pick(live.length)];
        packets.push(queues.get(p)!.shift()!);
        if (queues.get(p)!.length === 0) queues.delete(p);
      }
      const bytes = Buffer.concat(packets);

      // chunks mostly large, some a few bytes long, so boundaries land inside headers too
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < bytes.length;) {
        const size = 1 + (random() < 0.3 ? pick(16) : pick(20000));
        chunks.push(bytes.subarray(offset, offset + size));
        offset += size;
      }

      const received = await receive(chunks);
      protocols.forEach((p, i) => {
        expect(received[i].map((item) => hex(item.bytes))).toEqual(sent.get(p)!.map(hex));
        received[i].forEach((item) => expect(item.value.at(0)!.toJS()).toBe(p));
      });
    }
  );
});

describe("DeMux SDU read timeout", () => {
  const whole = segment(5, randomBytes(100));
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // a demux fed by hand from a source that never ends, as the socket's never does
  const open = (sduTimeout: number) => {
    const source = new Readable({ read() {} });
    const demux = source.pipe(new DeMux({ sduTimeout }));
    const segments: Segment[] = [];
    const errors: Error[] = [];
    demux.on("data", (s: Segment) => segments.push(s));
    demux.on("error", (error: Error) => errors.push(error));
    const failure = new Promise<Error>((resolve) => demux.once("error", resolve));
    return { source, demux, segments, errors, failure };
  };

  it("fails once a started segment has not arrived whole within the limit", async () => {
    const { source, demux, failure } = open(40);
    source.push(whole.subarray(0, 30)); // the header and a bit of the payload
    const error = await failure;
    expect(error).toBeInstanceOf(SduReadTimeoutError);
    expect(error.message).toMatch(/within 40ms \(30 bytes so far\)/);
    expect(demux.destroyed).toBe(true);
  });

  it("fails on a segment stalled inside its header", async () => {
    const { source, failure } = open(40);
    source.push(whole.subarray(0, 3));
    expect(await failure).toBeInstanceOf(SduReadTimeoutError);
  });

  it("is a budget for the whole segment, bytes trickling in do not extend it", async () => {
    const { source, segments, failure } = open(60);
    // a byte every 10ms would take a second to complete the segment
    let sent = 0;
    const trickle = setInterval(() => {
      source.push(whole.subarray(sent, sent + 1));
      sent += 1;
    }, 10);
    try {
      expect(await failure).toBeInstanceOf(SduReadTimeoutError);
    } finally {
      clearInterval(trickle);
    }
    expect(segments).toHaveLength(0);
  });

  it("does not run between segments, an idle connection is fine", async () => {
    const { source, segments, errors } = open(40);
    source.push(whole);
    await sleep(120);
    expect(segments).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("stops when the segment completes and starts afresh for the next one", async () => {
    const { source, segments, errors } = open(300);
    const next = segment(9, randomBytes(50));
    source.push(whole.subarray(0, 40));
    await sleep(100);
    // one chunk completes the first segment and starts the next: the first
    // one's clock stops, the next one gets its own 300ms from now
    source.push(Buffer.concat([whole.subarray(40), next.subarray(0, 20)]));
    await sleep(250); // 350ms after the first one started, 250 after the next
    expect(errors).toEqual([]);
    source.push(next.subarray(20));
    await sleep(350);
    expect(errors).toEqual([]);
    expect(segments.map((s) => s.protocol)).toEqual([5, 9]);
  });

  it("is off with a timeout of 0", async () => {
    const { source, segments, errors } = open(0);
    source.push(whole.subarray(0, 30));
    await sleep(100);
    source.push(whole.subarray(30));
    await sleep(10);
    expect(errors).toEqual([]);
    expect(segments).toHaveLength(1);
  });
});
