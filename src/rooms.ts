import { applyMove, createEmptyGrid, resetGame, type GameState, type Player } from "./shared/index.js";
import { nanoid } from "nanoid";
import type { Room } from "./types.js";

const DEFAULT_ROWS = 9;
const DEFAULT_COLS = 6;

const PLAYER_COLORS = [
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#ec4899"
];

export class RoomStore {
  private rooms = new Map<string, Room>();

  createRoom(hostName: string, rows?: number, cols?: number): { room: Room; playerId: string } {
    const roomId = nanoid(8);
    const finalRows = rows ?? DEFAULT_ROWS;
    const finalCols = cols ?? DEFAULT_COLS;

    const hostId = nanoid(10);
    const host: Player = {
      id: hostId,
      name: hostName,
      color: PLAYER_COLORS[0]!,
      eliminated: false,
      hasPlacedAtLeastOnce: false
    };

    const state: GameState = {
      roomId,
      rows: finalRows,
      cols: finalCols,
      grid: createEmptyGrid(finalRows, finalCols),
      players: [host],
      currentPlayerIdx: 0,
      status: "lobby",
      winnerId: null,
      moveNumber: 0,
      updatedAt: Date.now()
    };

    const room: Room = {
      id: roomId,
      state,
      socketToPlayer: new Map(),
      leaderboard: new Map([[hostId, { name: hostName, wins: 0 }]])
    };

    this.rooms.set(roomId, room);
    return { room, playerId: hostId };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  joinRoom(roomId: string, name: string): { room: Room; player: Player } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found." };
    if (room.state.status !== "lobby" && room.state.status !== "playing" && room.state.status !== "finished") {
      return { error: "Invalid room state." };
    }

    const playerId = nanoid(10);
    const color = PLAYER_COLORS[room.state.players.length % PLAYER_COLORS.length]!;
    const player: Player = { id: playerId, name, color, eliminated: false, hasPlacedAtLeastOnce: false };

    room.state.players.push(player);
    if (!room.leaderboard.has(playerId)) room.leaderboard.set(playerId, { name, wins: 0 });

    // Auto transition to playing when 2+ players and currently lobby.
    if (room.state.status === "lobby" && room.state.players.length >= 2) {
      room.state.status = "playing";
      room.state.updatedAt = Date.now();
    }

    return { room, player };
  }

  leaveByPlayerId(room: Room, playerId: string): void {
    const p = room.state.players.find((x: { id: string }) => x.id === playerId);
    if (!p) return;
    p.eliminated = true;
    room.state.updatedAt = Date.now();
    // If game is ongoing, winner recalculation will happen on next move/restart.
  }

  startGame(room: Room): { ok: true; state: GameState } | { ok: false; reason: string } {
    if (room.state.players.length < 2) return { ok: false, reason: "Need at least 2 players." };
    room.state = resetGame({ ...room.state, status: "playing" });
    return { ok: true, state: room.state };
  }

  restartGame(room: Room): { ok: true; state: GameState } | { ok: false; reason: string } {
    if (room.state.players.length < 2) return { ok: false, reason: "Need at least 2 players." };
    room.state = resetGame({ ...room.state, status: "playing" });
    return { ok: true, state: room.state };
  }

  applyPlayerMove(room: Room, row: number, col: number, playerId: string) {
    const res = applyMove(room.state, row, col, playerId);
    if (!res.ok) return res;

    // If someone won, increment leaderboard.
    if (room.state.status === "finished" && room.state.winnerId) {
      const entry = room.leaderboard.get(room.state.winnerId);
      if (entry) room.leaderboard.set(room.state.winnerId, { ...entry, wins: entry.wins + 1 });
    }

    return res;
  }
}

