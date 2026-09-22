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
