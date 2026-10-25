/** the readable part of an error that crossed from the main process */
export function friendlyError(error: unknown, fallback = "Something went wrong."): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "") || fallback;
}
