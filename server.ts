/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const db = new Database('database.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    total_score INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    matches_played INTEGER DEFAULT 0
  )
`);

async function startServer() {
  const app = express();
  app.use(express.json());
  
  const PORT = 3000;
  
  app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
    try {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
      const user = db.prepare('SELECT id, username, total_score, level, matches_played FROM users WHERE username = ?').get(username);
      res.json({ user });
    } catch (e: any) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(400).json({ error: 'Username already exists' });
      } else {
        res.status(500).json({ error: 'Server error' });
      }
    }
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const user = db.prepare('SELECT id, username, total_score, level, matches_played FROM users WHERE username = ? AND password_hash = ?').get(username, hash);
    if (user) {
      res.json({ user });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  // Global Game State
  const MAX_PLAYERS = 60;
  let playerCounter = 1;
  const players: Record<string, { id: string, name: string, username?: string, position: [number, number, number], rotation: number, state: 'active' | 'disabled', disabledUntil: number, score: number, color: string }> = {};

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinGame', (username?: string) => {
      if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('gameError', 'Server is full (60/60 players)');
        return;
      }

      let playerName = `Player ${playerCounter++}`;
      let dbUsername: string | undefined = undefined;

      if (username) {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
        if (user) {
          playerName = user.username;
          dbUsername = user.username;
          db.prepare('UPDATE users SET matches_played = matches_played + 1 WHERE username = ?').run(user.username);
        }
      }
      
      // Assign random color
      const colors = ['#ff0055', '#00ff00', '#ffff00', '#ff00ff', '#00ffff'];
      const color = colors[Object.keys(players).length % colors.length];

      players[socket.id] = {
        id: socket.id,
        name: playerName,
        username: dbUsername,
        position: [0, 2, 0],
        rotation: 0,
        state: 'active',
        disabledUntil: 0,
        score: 0,
        color
      };

      // Send initial state
      socket.emit('gameJoined', players);
      // Broadcast to others
      socket.broadcast.emit('playerJoined', players[socket.id]);
    });

    socket.on('updatePosition', (data: { position: [number, number, number], rotation: number }) => {
      if (players[socket.id]) {
        players[socket.id].position = data.position;
        players[socket.id].rotation = data.rotation;
        socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
      }
    });

    socket.on('shoot', (data: { start: [number, number, number], end: [number, number, number], color: string }) => {
      socket.broadcast.emit('playerShot', { id: socket.id, ...data });
    });

    socket.on('hitPlayer', (targetId: string) => {
      if (players[targetId] && players[socket.id]) {
        const now = Date.now();
        // Allow hit if active OR if disabled period has expired
        if (players[targetId].state === 'active' || now > players[targetId].disabledUntil) {
          players[targetId].state = 'disabled';
          players[targetId].disabledUntil = now + 3000;
          players[socket.id].score += 100;

          if (players[socket.id].username) {
            db.prepare('UPDATE users SET total_score = total_score + 100, level = ((total_score + 100) / 1000) + 1 WHERE username = ?').run(players[socket.id].username);
          }
          
          io.emit('playerHit', {
            targetId,
            shooterId: socket.id,
            targetDisabledUntil: players[targetId].disabledUntil,
            shooterScore: players[socket.id].score
          });
        }
      }
    });

    socket.on('disconnect', () => {
      if (players[socket.id]) {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();