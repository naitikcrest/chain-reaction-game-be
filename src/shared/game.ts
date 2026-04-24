import type { ApplyMoveResult, Cell, GameEvent, GameState, Grid, PlayerId } from "./types.js";

export function createEmptyGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): Cell => ({ ownerId: null, orbCount: 0 }))
  );
}

export function cellCapacity(rows: number, cols: number, row: number, col: number): number {
  const isTop = row === 0;
  const isBottom = row === rows - 1;
  const isLeft = col === 0;
  const isRight = col === cols - 1;

  const edges = Number(isTop) + Number(isBottom) + Number(isLeft) + Number(isRight);
  return edges === 2 ? 1 : edges === 1 ? 2 : 3;
}

export function neighbors(rows: number, cols: number, row: number, col: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (row > 0) out.push([row - 1, col]);
  if (row < rows - 1) out.push([row + 1, col]);
  if (col > 0) out.push([row, col - 1]);
  if (col < cols - 1) out.push([row, col + 1]);
  return out;
}

function getCurrentPlayerId(state: GameState): PlayerId | null {
  const p = state.players[state.currentPlayerIdx];
  return p?.eliminated ? null : (p?.id ?? null);
}

function advanceTurn(state: GameState): void {
  if (state.players.length === 0) return;
  for (let i = 0; i < state.players.length; i++) {
    state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
    if (!state.players[state.currentPlayerIdx]!.eliminated) return;
  }
}

function recomputeEliminations(state: GameState, events: GameEvent[]): void {
  const ownedCounts = new Map<PlayerId, number>();
  for (const p of state.players) ownedCounts.set(p.id, 0);
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.grid[r]![c]!;
      if (cell.ownerId) ownedCounts.set(cell.ownerId, (ownedCounts.get(cell.ownerId) ?? 0) + cell.orbCount);
    }
  }

  for (const p of state.players) {
    if (p.eliminated) continue;
    if (p.hasPlacedAtLeastOnce && (ownedCounts.get(p.id) ?? 0) === 0) {
      p.eliminated = true;
      events.push({ type: "elimination", playerId: p.id });
    }
  }

  const alive = state.players.filter((p) => !p.eliminated);
  if (state.status === "playing" && alive.length === 1) {
    state.status = "finished";
    state.winnerId = alive[0]!.id;
    events.push({ type: "win", playerId: alive[0]!.id });
  }
}

export function applyMove(state: GameState, row: number, col: number, playerId: PlayerId): ApplyMoveResult {
  if (state.status !== "playing") return { ok: false, reason: "Game is not in playing state." };
  if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) {
    return { ok: false, reason: "Move out of bounds." };
  }
  const current = getCurrentPlayerId(state);
  if (!current || current !== playerId) return { ok: false, reason: "Not your turn." };

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return { ok: false, reason: "Player not in game." };

  const cell = state.grid[row]![col]!;
  if (cell.ownerId !== null && cell.ownerId !== playerId) {
    return { ok: false, reason: "You can only play in empty or your own cells." };
  }

  const events: GameEvent[] = [];
  player.hasPlacedAtLeastOnce = true;

  cell.ownerId = playerId;
  cell.orbCount += 1;
  events.push({ type: "place", row, col, playerId, orbCount: cell.orbCount });

  const q: Array<[number, number]> = [];
  q.push([row, col]);

  while (q.length > 0) {
    const [cr, cc] = q.shift()!;
    const curCell = state.grid[cr]![cc]!;
    if (curCell.orbCount === 0) continue;

    const cap = cellCapacity(state.rows, state.cols, cr, cc);
    if (curCell.orbCount <= cap) continue;

    events.push({ type: "burst", row: cr, col: cc });
    const owner = curCell.ownerId;
    curCell.ownerId = null;
    curCell.orbCount = 0;
    events.push({ type: "capture", row: cr, col: cc, ownerId: null, orbCount: 0 });

    for (const [nr, nc] of neighbors(state.rows, state.cols, cr, cc)) {
      const nCell = state.grid[nr]![nc]!;
      nCell.ownerId = owner;
      nCell.orbCount += 1;
      events.push({ type: "capture", row: nr, col: nc, ownerId: nCell.ownerId, orbCount: nCell.orbCount });
      q.push([nr, nc]);
    }
  }

  recomputeEliminations(state, events);

  if (state.status === "playing") {
    advanceTurn(state);
  }

  state.moveNumber += 1;
  state.updatedAt = Date.now();

  return { ok: true, state, events };
}

export function resetGame(state: GameState): GameState {
  return {
    ...state,
    grid: createEmptyGrid(state.rows, state.cols),
    currentPlayerIdx: 0,
    status: state.players.length >= 2 ? "playing" : "lobby",
    winnerId: null,
    moveNumber: 0,
    updatedAt: Date.now(),
    players: state.players.map((p) => ({
      ...p,
      eliminated: false,
      hasPlacedAtLeastOnce: false
    }))
  };
}

