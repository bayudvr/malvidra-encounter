// Leave room for multipart headers under Vercel's 4.5 MB request limit.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const IMAGE_UPLOAD_HINT = "JPG, PNG, WebP or GIF · up to 4 MB";

export function imageFileError(file: Pick<File, "size" | "type">): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "Choose a JPG, PNG, WebP or GIF image.";
  if (file.size === 0) return "This image is empty. Choose another file.";
  if (file.size > MAX_IMAGE_BYTES) return "Image must be 4 MB or smaller.";
  return null;
}

export function matchesImageType(bytes: Uint8Array, type: string): boolean {
  const startsWith = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  switch (type) {
    case "image/jpeg": return startsWith([0xff, 0xd8, 0xff]);
    case "image/png": return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif": return startsWith([0x47, 0x49, 0x46, 0x38]) &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
    case "image/webp": return startsWith([0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    default: return false;
  }
}
