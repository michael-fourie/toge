// What every game's room shares with the rest of the Worker: the socket slice the rooms talk through, and the
// heartbeat the Directory uses to expire dead lobbies. Gambol's LobbyRoom, TŌGE's RaceRoom and the plug-ins'
// PartyRoom all use these.

/** The slice of a WebSocket a room needs (satisfied by the Workers WebSocket). */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
}

/** How often a live lobby re-announces itself so the directory can expire dead ones. */
export const HEARTBEAT_SECONDS = 30;
