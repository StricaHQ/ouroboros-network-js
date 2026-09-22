export type Options = {
  protocolId: number;
  protocolMagic: number;
  /**
   * Milliseconds the rest of a mux segment may take to arrive once its first
   * bytes have. The wait for the next segment is unbounded, but a segment that
   * stalls part way is fatal: the client emits an `error` carrying an
   * `SduReadTimeoutError` and closes the socket. Defaults to 30000, `0` turns
   * the limit off.
   */
  sduTimeout?: number;
};

/** A point on the chain, `hash` in hex. The origin is the empty point. */
export type Point = {
  slot?: number;
  hash?: string;
};

/** The node's tip, the point of its newest block. */
export type Tip = {
  slot: number;
  hash: string;
};

export type IntersectFound = {
  point: Point;
  tip: Tip;
};

export type IntersectNotFound = {
  tip: Tip;
};

export type RollForward = {
  /** the block's CBOR, exactly as the node encoded it */
  block: Buffer;
  tip: Tip;
};

export type RollBackward = {
  point: Point;
  tip: Tip;
};

/** A chain sync reply. Exactly one of the fields is set. */
export type NodeToClientChainSyncResponse = {
  rollForward?: RollForward;
  rollBackward?: RollBackward;
  intersectFound?: IntersectFound;
  intersectNotFound?: IntersectNotFound;
  /** the request is answered once the next block arrives */
  await?: true;
};

/** A local tx monitor reply. Exactly one of the fields is set. */
export type LocalTxMonitorResponse = {
  /** the slot of the mempool snapshot just acquired */
  acquired?: number;
  /** the next transaction's CBOR, or `null` once the snapshot is exhausted */
  nextTx?: Buffer | null;
};

/** A local tx submission reply. Exactly one of the fields is set. */
export type LocalTransactionSubmissionResponse = {
  success?: boolean;
  /** the node's reason, decoded from CBOR. Its shape depends on the era */
  rejectionMessage?: unknown;
};
