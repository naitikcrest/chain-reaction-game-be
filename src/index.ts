import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./types.js";
import { RoomStore } from "./rooms.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "https://chain-reaction-game-fe.vercel.app/";

console.log("Client Origin:", CLIENT_ORIGIN);
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true }
});

const rooms = new RoomStore();
const socketToRoom = new Map<string, string>();

io.on("connection", (socket) => {
  socket.on("room:create", (payload, cb) => {
    const name = payload.name?.trim();
    if (!name) return cb({ ok: false, reason: "Name is required." });

    const { room, playerId } = rooms.createRoom(name, payload.rows, payload.cols);
    room.socketToPlayer.set(socket.id, playerId);
    socketToRoom.set(socket.id, room.id);
    void socket.join(room.id);
    cb({ ok: true, roomId: room.id, state: room.state, playerId });
    io.to(room.id).emit("room:state", { state: room.state });
    io.to(room.id).emit("room:leaderboard", {
      roomId: room.id,
      entries: [...room.leaderboard.entries()].map(([pid, v]) => ({ playerId: pid, ...v }))
    });
  });

  socket.on("room:join", (payload, cb) => {
    const roomId = payload.roomId?.trim();
    const name = payload.name?.trim();
    if (!roomId) return cb({ ok: false, reason: "roomId is required." });
    if (!name) return cb({ ok: false, reason: "Name is required." });

    const room = rooms.getRoom(roomId);
    if (!room) return cb({ ok: false, reason: "Room not found." });

    const joinRes = rooms.joinRoom(roomId, name);
    if ("error" in joinRes) return cb({ ok: false, reason: joinRes.error });

    room.socketToPlayer.set(socket.id, joinRes.player.id);
    socketToRoom.set(socket.id, roomId);
    void socket.join(roomId);
    cb({ ok: true, state: room.state, playerId: joinRes.player.id });

    io.to(roomId).emit("room:players", { state: room.state });
    io.to(roomId).emit("room:state", { state: room.state });
    io.to(roomId).emit("room:leaderboard", {
      roomId,
      entries: [...room.leaderboard.entries()].map(([pid, v]) => ({ playerId: pid, ...v }))
    });
  });

  socket.on("game:start", (payload, cb) => {
    const room = rooms.getRoom(payload.roomId);
    if (!room) return cb({ ok: false, reason: "Room not found." });
    const res = rooms.startGame(room);
    if (!res.ok) return cb(res);
    cb(res);
    io.to(room.id).emit("room:state", { state: room.state });
  });

  socket.on("game:restart", (payload, cb) => {
    const room = rooms.getRoom(payload.roomId);
    if (!room) return cb({ ok: false, reason: "Room not found." });
    const res = rooms.restartGame(room);
    if (!res.ok) return cb(res);
    cb(res);
    io.to(room.id).emit("room:state", { state: room.state });
  });

  socket.on("game:move", (payload, cb) => {
    const room = rooms.getRoom(payload.roomId);
    if (!room) return cb({ ok: false, reason: "Room not found." });

    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return cb({ ok: false, reason: "Not joined." });

    const res = rooms.applyPlayerMove(room, payload.row, payload.col, playerId);
    if (!res.ok) return cb({ ok: false, reason: res.reason });

    cb({ ok: true });
    io.to(room.id).emit("game:events", { state: room.state, events: res.events });
    io.to(room.id).emit("room:leaderboard", {
      roomId: room.id,
      entries: [...room.leaderboard.entries()].map(([pid, v]) => ({ playerId: pid, ...v }))
    });
  });

  socket.on("chat:send", (payload, cb) => {
    const room = rooms.getRoom(payload.roomId);
    if (!room) return cb({ ok: false, reason: "Room not found." });
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return cb({ ok: false, reason: "Not joined." });
    const player = room.state.players.find((p) => p.id === playerId);
    if (!player) return cb({ ok: false, reason: "Player not found." });

    const msg = payload.message?.trim();
    if (!msg) return cb({ ok: false, reason: "Message is empty." });
    if (msg.length > 400) return cb({ ok: false, reason: "Message too long." });

    const at = Date.now();
    io.to(room.id).emit("chat:message", { roomId: room.id, playerId, name: player.name, message: msg, at });
    cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    socketToRoom.delete(socket.id);
    const room = rooms.getRoom(roomId);
    if (!room) return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    room.socketToPlayer.delete(socket.id);
    rooms.leaveByPlayerId(room, playerId);
    io.to(roomId).emit("room:state", { state: room.state });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

