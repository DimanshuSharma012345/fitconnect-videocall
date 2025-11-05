const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// ✅ Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// ✅ ROUTES
// Client page (main)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Trainer page
app.get('/trainer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trainer.html'));
});

// ====== SOCKET.IO LOGIC ======

let queue = []; // { socketId, clientId }
let trainerSocket = null;
let durations = []; // call durations (in minutes)
let clientStartTimes = {};
let currentCallClientId = null;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // When a Client joins the queue
  socket.on('join-queue', (clientId) => {
    queue.push({ socketId: socket.id, clientId });
    console.log(`Client ${clientId} joined the queue`);
    sendQueueUpdates();
  });

  // When the Trainer registers
  socket.on('register-trainer', () => {
    trainerSocket = socket;
    console.log('Trainer registered:', socket.id);
  });

  // Trainer calls the next Client
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

  // When a call ends
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

  // Handle WebRTC signaling
  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  // Handle disconnects
  socket.on('disconnect', () => {
    queue = queue.filter((p) => p.socketId !== socket.id);
    delete clientStartTimes[socket.id];

    if (socket === trainerSocket) trainerSocket = null;
    if (socket.id === currentCallClientId) currentCallClientId = null;

    console.log('Disconnected:', socket.id);
    sendQueueUpdates();
  });
});

// ====== HELPER FUNCTION ======
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

// ====== START SERVER ======
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
