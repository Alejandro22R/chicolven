import type { WebSocket } from 'ws';
import type { ScreenStatus, WsServerMessage } from '@chicolven/shared/types';

interface PlayerConn {
  socket: WebSocket;
  screenId: number;
  alive: boolean;
  /** Admin preview thumbnails get updates but do not count as a connected TV. */
  preview: boolean;
}

/**
 * Live channel to the TVs (players) and admin panels. Players are told to refetch their
 * content when something changes; admins get the connection status of each screen.
 */
export class Hub {
  private players = new Set<PlayerConn>();
  private admins = new Set<WebSocket>();
  private lastSeen = new Map<number, string>();
  private debounce: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout;

  constructor(private debounceMs = 250) {
    // Drop connections that stopped answering pings (TV turned off, WiFi lost).
    this.heartbeat = setInterval(() => {
      for (const conn of this.players) {
        if (!conn.alive) {
          conn.socket.terminate();
          continue;
        }
        conn.alive = false;
        conn.socket.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  addPlayer(socket: WebSocket, screenId: number, preview = false): void {
    const conn: PlayerConn = { socket, screenId, alive: true, preview };
    const touch = () => {
      if (!preview) this.touch(screenId);
    };
    this.players.add(conn);
    touch();
    socket.on('pong', () => {
      conn.alive = true;
      touch();
    });
    socket.on('message', () => {
      conn.alive = true;
      touch();
    });
    socket.on('close', () => {
      this.players.delete(conn);
      touch();
      this.pushStatus();
    });
    this.send(socket, { type: 'hello', server_time: new Date().toISOString() });
    this.pushStatus();
  }

  addAdmin(socket: WebSocket): void {
    this.admins.add(socket);
    socket.on('close', () => this.admins.delete(socket));
    this.send(socket, { type: 'screens-status', screens: this.status() });
  }

  /** Coalesces bursts of changes (e.g. a bulk price update) into one refetch. */
  contentChanged(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.broadcastPlayers({ type: 'content-changed' });
      for (const admin of this.admins) this.send(admin, { type: 'content-changed' });
    }, this.debounceMs);
  }

  reload(screenId?: number): void {
    this.broadcastPlayers({ type: 'reload' }, screenId);
  }

  status(): ScreenStatus[] {
    const counts = new Map<number, number>();
    for (const conn of this.players) if (!conn.preview) counts.set(conn.screenId, (counts.get(conn.screenId) ?? 0) + 1);
    const ids = new Set([...counts.keys(), ...this.lastSeen.keys()]);
    return [...ids].map((id) => ({ screen_id: id, connections: counts.get(id) ?? 0, last_seen: this.lastSeen.get(id) ?? null }));
  }

  close(): void {
    clearInterval(this.heartbeat);
    if (this.debounce) clearTimeout(this.debounce);
    for (const conn of this.players) conn.socket.close();
    for (const admin of this.admins) admin.close();
  }

  private touch(screenId: number): void {
    this.lastSeen.set(screenId, new Date().toISOString());
  }

  private pushStatus(): void {
    const msg: WsServerMessage = { type: 'screens-status', screens: this.status() };
    for (const admin of this.admins) this.send(admin, msg);
  }

  private broadcastPlayers(msg: WsServerMessage, screenId?: number): void {
    for (const conn of this.players) if (screenId === undefined || conn.screenId === screenId) this.send(conn.socket, msg);
  }

  private send(socket: WebSocket, msg: WsServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }
}
