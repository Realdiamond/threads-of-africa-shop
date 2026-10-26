const MAX_SIDE = 1600;

// Shrinks a photo in the browser before it is uploaded: phone photos are often 4-8 MB, which
// would make the shop slow. Output is a JPEG at most 1600px on the long side.
export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file could not be read as a photo. Use a JPEG, PNG or WebP image.");
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not process that photo.");
  // JPEG has no transparency; paint white first so transparent PNGs do not turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new Error("Your browser could not process that photo.");
  // Keep the original when it is already smaller and a supported type.
  const keepOriginal =
    file.size <= blob.size &&
    ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
    scale === 1;
  return keepOriginal ? file : blob;
}

export async function uploadImage(blob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", blob, filename);
  const response = await fetch("/api/admin/upload", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
  if (response.status === 401) {
    window.location.assign("/admin/login");
    throw new Error("Please sign in again.");
  }
  if (!response.ok || !body.url)
    throw new Error(body.message ?? "The upload failed. Please try again.");
  return body.url;
}
