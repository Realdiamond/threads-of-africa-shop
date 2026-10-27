// Reads a request body but stops as soon as it grows past the limit, even if the sender never
// said how big it would be. Returns null when it is too large.
export async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
