// Which ?status= keys of the admin pages report a failure (shown red), the rest a success (green).

const ERROR = /failed$|invalid|^not-|-not-|^no-|^bad-|^too-|^quiet$|already|expired/;

export function statusTone(key: string): "success" | "error" {
  return ERROR.test(key) ? "error" : "success";
}
