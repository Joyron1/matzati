// An upload to a Supabase signed upload URL with real progress (owner request 2026-10-24: a bar
// while a video goes up). supabase-js's uploadToSignedUrl uses fetch, which reports no upload
// progress, so this is the same request through XMLHttpRequest: PUT
// <url>/storage/v1/object/upload/sign/<bucket>/<path>?token=<token> with the file as the body, its
// content type, x-upsert false, and the public anon key (as supabase-js sends it). The token is
// the server's one-time signed upload token (lib/meta/reels-server.ts signedReelUpload).

export function uploadToSignedUrl(
  bucket: string,
  signed: { path: string; token: string },
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const url = new URL(`${base}/storage/v1/object/upload/sign/${bucket}/${signed.path}`);
  url.searchParams.set("token", signed.token);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url.toString());
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("apikey", anon);
    xhr.setRequestHeader("authorization", `Bearer ${anon}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? (onProgress(1), resolve())
        : reject(new Error(`upload ${xhr.status}`));
    xhr.onerror = () => reject(new Error("upload network error"));
    xhr.ontimeout = () => reject(new Error("upload timeout"));
    xhr.timeout = 10 * 60_000;
    xhr.send(body);
  });
}
