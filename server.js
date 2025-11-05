const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ✅ Dynamically handle Render’s weird “src” directory issue
const rootDir = process.cwd().includes('/src')
  ? path.join(process.cwd(), '..') // move one level up if in /src
  : process.cwd();

const publicPath = path.join(rootDir, 'public');
console.log('📂 Serving public path from:', publicPath);

// ✅ Serve static files
app.use(express.static(publicPath));

// ✅ Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'client.html'));
});

app.get('/trainer', (req, res) => {
  res.sendFile(path.join(publicPath, 'trainer.html'));
});

// ===== SOCKET.IO LOGIC =====
let queue = [];
let trainerSocket = null;
let durations = [];
let clientStartTimes = {};
let currentCallClientId = null;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-queue', (clientId) => {
    queue.push({ socketId: socket.id, clientId });
    console.log(`Client ${clientId} joined the queue`);
    sendQueueUpdates();
  });

  socket.on('register-trainer', () => {
    trainerSocket = socket;
    console.log('Trainer registered:', socket.id);
  });

  socket.on('call-next', () => {
    if (!trainerSocket || queue.length === 0) return;

    const nextClient = queue.shift();
    clientStartTimes[nextClient.socketId] = Date.now();
    currentCallClientId = nextClient.socketId;

    trainerSocket.emit('calling-client', {
      clientId: nextClient.clientId,
      socketId: nextClient.socketId,
    });

    io.to(nextClient.socketId).emit('join-call', {
      trainerSocketId: trainerSocket.id,
    });

    sendQueueUpdates();
  });

  socket.on('end_call', () => {
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

  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  socket.on('disconnect', () => {
    queue = queue.filter((p) => p.socketId !== socket.id);
    delete clientStartTimes[socket.id];

    if (socket === trainerSocket) trainerSocket = null;
    if (socket.id === currentCallClientId) currentCallClientId = null;

    console.log('Disconnected:', socket.id);
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
      io.to(client.socketId).emit('update_wait_time', estimatedTime);
    }
  });
}

// ===== START SERVER =====
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
