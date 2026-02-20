const path = require("path");
const http = require("http");
const os = require("os");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// Expose server address (local IP + port) for QR code so scanners get the right URL
function getLocalAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

app.get("/api/server-address", (req, res) => {
  const host = getLocalAddress();
  const baseUrl = `http://${host}:${PORT}`;
  res.json({ baseUrl, host, port: PORT });
});

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: "/ws" });

const rooms = new Map();

const getOrCreateRoom = (code) => {
  if (!rooms.has(code)) {
    rooms.set(code, new Map()); // Changed to Map to store userId -> ws
  }
  return rooms.get(code);
};

const generateUserId = () => {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const addClientToRoom = (code, ws, userId, userName) => {
  const room = getOrCreateRoom(code);
  room.set(userId, { ws, userName: userName || `User ${userId.slice(-6)}` });
  ws.roomCode = code;
  ws.userId = userId;
};

const removeClientFromRoom = (ws) => {
  const code = ws.roomCode;
  const userId = ws.userId;
  if (!code || !userId) return;
  const room = rooms.get(code);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) {
    rooms.delete(code);
  } else {
    // Broadcast peer-disconnected to all other peers
    const userList = Array.from(room.entries()).map(([id, data]) => ({
      userId: id,
      userName: data.userName,
    }));
    for (const [id, data] of room.entries()) {
      if (data.ws.readyState === WebSocket.OPEN) {
        data.ws.send(
          JSON.stringify({
            type: "peer-disconnected",
            disconnectedUserId: userId,
            userList,
          })
        );
      }
    }
  }
  ws.roomCode = null;
  ws.userId = null;
};

const broadcastUserList = (roomCode) => {
  const room = rooms.get(roomCode);
  if (!room) return;
  const userList = Array.from(room.entries()).map(([id, data]) => ({
    userId: id,
    userName: data.userName,
  }));
  for (const [id, data] of room.entries()) {
    if (data.ws.readyState === WebSocket.OPEN) {
      data.ws.send(JSON.stringify({ type: "user-list", userList }));
    }
  }
};

const broadcastToRoomExcept = (roomCode, senderUserId, message) => {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [userId, data] of room.entries()) {
    if (userId === senderUserId) continue;
    if (data.ws.readyState === WebSocket.OPEN) {
      data.ws.send(message);
    }
  }
};

const sendToSpecificPeer = (roomCode, targetUserId, message) => {
  const room = rooms.get(roomCode);
  if (!room) return;
  const target = room.get(targetUserId);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(message);
  }
};

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.userId = null;
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    const { type } = msg;

    if (type === "create-room") {
      const code = String(msg.roomCode || "").trim();
      if (!/^\d{6}$/.test(code)) {
        ws.send(
          JSON.stringify({ type: "room-error", reason: "Invalid room code format." })
        );
        return;
      }
      const userId = generateUserId();
      const userName = String(msg.userName || "").trim() || `User ${userId.slice(-6)}`;
      addClientToRoom(code, ws, userId, userName);
      
      // Get the user list (just the creator for now)
      const userList = Array.from(rooms.get(code).entries()).map(([id, data]) => ({
        userId: id,
        userName: data.userName,
      }));
      
      ws.send(
        JSON.stringify({
          type: "room-created",
          roomCode: code,
          userId,
          userName,
          userList,
        })
      );
      return;
    }

    if (type === "join-room") {
      const code = String(msg.roomCode || "").trim();
      if (!/^\d{6}$/.test(code)) {
        ws.send(
          JSON.stringify({ type: "room-error", reason: "Invalid room code format." })
        );
        return;
      }

      const room = rooms.get(code);
      if (!room || room.size === 0) {
        ws.send(
          JSON.stringify({ type: "room-error", reason: "Room not found or empty." })
        );
        return;
      }

      const userId = generateUserId();
      const userName = String(msg.userName || "").trim() || `User ${userId.slice(-6)}`;
      addClientToRoom(code, ws, userId, userName);
      
      // Get the full user list including the new user
      const userList = Array.from(room.entries()).map(([id, data]) => ({
        userId: id,
        userName: data.userName,
      }));
      
      // Send room-joined with full user list to the new joiner
      ws.send(
        JSON.stringify({
          type: "room-joined",
          roomCode: code,
          userId,
          userName,
          userList,
        })
      );

      // Notify all existing peers about the new peer
      for (const [id, data] of room.entries()) {
        if (id !== userId && data.ws.readyState === WebSocket.OPEN) {
          data.ws.send(
            JSON.stringify({
              type: "peer-joined",
              newUserId: userId,
              newUserName: userName,
              userList,
            })
          );
        }
      }
      return;
    }

    if (type === "signal") {
      const roomCode = String(msg.roomCode || "").trim();
      const targetUserId = msg.targetUserId;
      if (!roomCode || !ws.roomCode || ws.roomCode !== roomCode) {
        return;
      }
      const payload = msg.payload || {};
      const relay = JSON.stringify({
        type: "signal",
        roomCode,
        fromUserId: ws.userId,
        payload,
      });

      // If targetUserId is specified, send to that specific peer only
      if (targetUserId) {
        sendToSpecificPeer(roomCode, targetUserId, relay);
      } else {
        // Otherwise broadcast to all except sender
        broadcastToRoomExcept(roomCode, ws.userId, relay);
      }
      return;
    }

    if (type === "leave-room") {
      removeClientFromRoom(ws);
      return;
    }
  });

  ws.on("close", () => {
    removeClientFromRoom(ws);
  });

  ws.on("error", () => {
    removeClientFromRoom(ws);
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      // ignore
    }
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  const localHost = getLocalAddress();
  // eslint-disable-next-line no-console
  console.log(`OpenDrop server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Other devices: http://${localHost}:${PORT}`);
});
