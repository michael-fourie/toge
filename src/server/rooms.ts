// What a race room shares with the rest of the Worker: the socket slice it talks through, and the heartbeat the
// Directory uses to expire dead lobbies.

/** The slice of a WebSocket a room needs (satisfied by the Workers WebSocket). */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
}

/** How often a live lobby re-announces itself so the directory can expire dead ones. */
export const HEARTBEAT_SECONDS = 30;

/**
 * Runs one tick of a room's game loop and logs an error instead of letting it escape the timer as an uncaught
 * exception. Logged with the room code and stack, it shows up in Workers Logs (wrangler.jsonc `observability`),
 * so a dropped or frozen game can be traced to the line that broke.
 */
export function guarded(fn: () => void, where: string, log: (...a: unknown[]) => void = console.error) {
  try {
    fn();
  } catch (e) {
    log(`tick failed in ${where}:`, e instanceof Error ? (e.stack ?? e.message) : e);
  }
}
