const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 🔍 Find public folder dynamically
const possiblePublicDirs = [
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "src", "public"),
  path.join(__dirname, "public"),
  path.join(__dirname, "..", "public"),
];

let publicPath = possiblePublicDirs.find((dir) => fs.existsSync(dir));

if (!publicPath) {
  console.error("❌ Could not locate public folder!");
  console.log("Checked:", possiblePublicDirs);
  process.exit(1);
}

console.log("📂 Serving static files from:", publicPath);

// ✅ Serve static files
app.use(express.static(publicPath));

// ✅ Serve pages
app.get("/", (req, res) => {
  const file = path.join(publicPath, "client.html");
  console.log("➡ Sending file:", file);
  res.sendFile(file);
});

app.get("/trainer", (req, res) => {
  const file = path.join(publicPath, "trainer.html");
  console.log("➡ Sending file:", file);
  res.sendFile(file);
});

// ===== SOCKET.IO LOGIC =====
let queue = [];
let trainerSocket = null;
let durations = [];
let clientStartTimes = {};
let currentCallClientId = null;

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-queue", (clientId) => {
    queue.push({ socketId: socket.id, clientId });
    console.log(`Client ${clientId} joined the queue`);
    sendQueueUpdates();
  });

  socket.on("register-trainer", () => {
    trainerSocket = socket;
    console.log("Trainer registered:", socket.id);
  });

  socket.on("call-next", () => {
    if (!trainerSocket || queue.length === 0) return;

    const nextClient = queue.shift();
    clientStartTimes[nextClient.socketId] = Date.now();
    currentCallClientId = nextClient.socketId;

    trainerSocket.emit("calling-client", {
      clientId: nextClient.clientId,
      socketId: nextClient.socketId,
    });

    io.to(nextClient.socketId).emit("join-call", {
      trainerSocketId: trainerSocket.id,
    });

    sendQueueUpdates();
  });

  socket.on("end_call", () => {
    const start = clientStartTimes[socket.id];
    if (start) {
      const duration = (Date.now() - start) / 60000;
      durations.push(duration);
      console.log(`Call duration: ${duration.toFixed(2)} mins`);
      delete clientStartTimes[socket.id];
    }

    if (socket.id === currentCallClientId) {
      currentCallClientId = null;
    }

    sendQueueUpdates();
  });

  socket.on("signal", ({ to, signal }) => {
    io.to(to).emit("signal", { from: socket.id, signal });
  });

  socket.on("disconnect", () => {
    queue = queue.filter((p) => p.socketId !== socket.id);
    delete clientStartTimes[socket.id];
    if (socket === trainerSocket) trainerSocket = null;
    if (socket.id === currentCallClientId) currentCallClientId = null;
    console.log("Disconnected:", socket.id);
    sendQueueUpdates();
  });
});

function sendQueueUpdates() {
  const avg =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 5;

  queue.forEach((client, index) => {
    const estimatedTime = (index + 1) * avg;
    if (client.socketId !== currentCallClientId) {
      io.to(client.socketId).emit("update_wait_time", estimatedTime);
    }
  });
}

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
