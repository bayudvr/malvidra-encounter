import { createClient } from "@/lib/supabase/server";
import { imageFileError, matchesImageType, MAX_IMAGE_BYTES } from "@/lib/image-upload";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Upload from this site only." }, { status: 403 });
  }

  const { roomId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)) {
    return Response.json({ error: "Invalid room." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Sign in again to upload an image." }, { status: 401 });
  }

  const { data: membership, error: memberError } = await supabase
    .from("room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError) {
    return Response.json({ error: "Could not verify room access. Try again." }, { status: 503 });
  }
  if (membership?.role !== "dm") {
    return Response.json({ error: "Only this room's DM can upload images." }, { status: 403 });
  }

  const clientId = process.env.IMGUR_CLIENT_ID?.trim();
  if (!clientId) {
    return Response.json({ error: "Image uploads are not configured yet. You can still paste an image URL." }, { status: 503 });
  }
  if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES + 64 * 1024) {
    return Response.json({ error: "Image must be 4 MB or smaller." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  const validationError = imageFileError(file);
  if (validationError) {
    return Response.json({ error: validationError }, { status: file.size > MAX_IMAGE_BYTES ? 413 : 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesImageType(bytes, file.type)) {
    return Response.json({ error: "The file does not match its image format. Choose another image." }, { status: 400 });
  }

  try {
    const body = new FormData();
    body.set("image", Buffer.from(bytes).toString("base64"));
    body.set("type", "base64");
    const response = await fetch("https://api.imgur.com/3/image", {
      method: "POST",
      headers: { Authorization: `Client-ID ${clientId}` },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) {
      return Response.json({ error: "Imgur's upload limit was reached. Try again later or paste an image URL." }, { status: 429 });
    }
    if (!response.ok) {
      return Response.json({ error: "Imgur could not upload this image. Try again or paste an image URL." }, { status: 502 });
    }

    const result = await response.json();
    const link = result?.data?.link;
    if (!result?.success || typeof link !== "string" ||
        !/^https:\/\/i\.imgur\.com\/[a-zA-Z0-9]+\.(?:jpe?g|png|webp|gif)$/i.test(link)) {
      return Response.json({ error: "Imgur did not return a usable image URL. Try another image." }, { status: 502 });
    }
    // Keep credentials and Imgur management data out of the browser and database.
    return Response.json({ url: link });
  } catch {
    return Response.json({ error: "Could not reach Imgur. Try again or paste an image URL." }, { status: 502 });
  }
}
