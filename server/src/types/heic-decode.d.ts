// heic-decode 2.x ships no types.
declare module "heic-decode" {
  function decode(input: { buffer: Uint8Array | ArrayBufferLike }): Promise<{
    width: number;
    height: number;
    /** RGBA, 8 bits per channel, already rotated/mirrored as the file says. */
    data: Uint8ClampedArray;
  }>;
  export default decode;
}
