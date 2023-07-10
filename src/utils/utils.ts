export default {
  getCborSpanBuffer(cborBuff: Buffer, chunk: any): Buffer {
    const span = chunk.getByteSpan();
    return cborBuff.subarray(span[0], span[1]);
  },
};
