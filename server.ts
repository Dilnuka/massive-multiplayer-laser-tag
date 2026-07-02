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
    password_salt TEXT,
    display_name TEXT,
    bio TEXT DEFAULT '',
    avatar_color TEXT DEFAULT '#00ffff',
    total_score INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    matches_played INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'password_salt', 'TEXT');
ensureColumn('users', 'display_name', 'TEXT');
ensureColumn('users', 'bio', "TEXT DEFAULT ''");
ensureColumn('users', 'avatar_color', "TEXT DEFAULT '#00ffff'");
ensureColumn('users', 'created_at', "INTEGER DEFAULT (strftime('%s', 'now'))");
db.exec("UPDATE users SET display_name = username WHERE display_name IS NULL OR display_name = ''");
db.exec("UPDATE users SET bio = '' WHERE bio IS NULL");
db.exec("UPDATE users SET avatar_color = '#00ffff' WHERE avatar_color IS NULL OR avatar_color = ''");

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PROFILE_SELECT = `
  SELECT
    id,
    username,
    COALESCE(display_name, username) AS display_name,
    COALESCE(bio, '') AS bio,
    COALESCE(avatar_color, '#00ffff') AS avatar_color,
    total_score,
    level,
    matches_played,
    created_at
  FROM users
`;

type PublicUser = {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  avatar_color: string;
  total_score: number;
  level: number;
  matches_played: number;
  created_at: number;
};

function randomColor() {
  const colors = ['#ff0055', '#00ff88', '#00ffff', '#f59e0b', '#a855f7', '#f43f5e'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now,
    now + SESSION_TTL_MS
  );
  return token;
}

function sanitizeUser(user: PublicUser | undefined) {
  return user ?? null;
}

function getUserByToken(token?: string) {
  if (!token) return null;
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  const user = db.prepare(`
    ${PROFILE_SELECT}
    INNER JOIN sessions ON sessions.user_id = users.id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, now) as PublicUser | undefined;
  return sanitizeUser(user);
}

function getAuthToken(req: express.Request) {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = getAuthToken(req);
  const user = getUserByToken(token ?? undefined);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  (req as express.Request & { user?: PublicUser; token?: string }).user = user;
  (req as express.Request & { user?: PublicUser; token?: string }).token = token ?? undefined;
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json());
  
  const PORT = 3000;
  
  app.post('/api/register', (req, res) => {
    const { username, password, displayName } = req.body;
    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const normalizedDisplayName = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : normalizedUsername;

    if (!normalizedUsername || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters and use only letters, numbers, or underscores' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      const avatarColor = randomColor();
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, password_salt, display_name, avatar_color)
        VALUES (?, ?, ?, ?, ?)
      `).run(normalizedUsername, hash, salt, normalizedDisplayName, avatarColor);

      const user = db.prepare(`${PROFILE_SELECT} WHERE id = ?`).get(result.lastInsertRowid) as PublicUser | undefined;
      const token = createSession(Number(result.lastInsertRowid));
      res.json({ token, user });
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
    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!normalizedUsername || !password) return res.status(400).json({ error: 'Missing username or password' });

    const userRecord = db.prepare('SELECT * FROM users WHERE username = ?').get(normalizedUsername) as
      | { id: number; password_hash: string; password_salt?: string }
      | undefined;

    if (!userRecord) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const hash = userRecord.password_salt
      ? hashPassword(password, userRecord.password_salt)
      : crypto.createHash('sha256').update(password).digest('hex');
    const user = db.prepare(`${PROFILE_SELECT} WHERE id = ? AND EXISTS (SELECT 1 FROM users auth_check WHERE auth_check.id = ? AND auth_check.password_hash = ?)`)
      .get(userRecord.id, userRecord.id, hash) as PublicUser | undefined;

    if (user) {
      if (!userRecord.password_salt) {
        const newSalt = crypto.randomBytes(16).toString('hex');
        const newHash = hashPassword(password, newSalt);
        db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(newHash, newSalt, userRecord.id);
      }
      const token = createSession(userRecord.id);
      res.json({ token, user });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: (req as express.Request & { user: PublicUser }).user });
  });

  app.post('/api/logout', requireAuth, (req, res) => {
    const token = (req as express.Request & { token?: string }).token;
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ ok: true });
  });

  app.patch('/api/profile', requireAuth, (req, res) => {
    const authReq = req as express.Request & { user: PublicUser };
    const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : authReq.user.display_name;
    const bio = typeof req.body.bio === 'string' ? req.body.bio.trim().slice(0, 160) : authReq.user.bio;
    const avatarColor = typeof req.body.avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.avatarColor)
      ? req.body.avatarColor
      : authReq.user.avatar_color;

    if (!displayName) {
      return res.status(400).json({ error: 'Display name is required' });
    }

    db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_color = ? WHERE id = ?')
      .run(displayName, bio, avatarColor, authReq.user.id);
    const updatedUser = db.prepare(`${PROFILE_SELECT} WHERE id = ?`).get(authReq.user.id) as PublicUser | undefined;
    res.json({ user: updatedUser });
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
  const players: Record<string, {
    id: string;
    name: string;
    username?: string;
    userId?: number;
    position: [number, number, number];
    rotation: number;
    state: 'active' | 'disabled';
    disabledUntil: number;
    score: number;
    color: string;
  }> = {};

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinGame', (token?: string) => {
      if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('gameError', 'Server is full (60/60 players)');
        return;
      }

      const user = getUserByToken(token);
      if (!user) {
        socket.emit('gameError', 'You must sign in before joining the game');
        return;
      }

      let playerName = `Player ${playerCounter++}`;
      let dbUsername: string | undefined = undefined;
      let dbUserId: number | undefined = undefined;

      playerName = user.display_name || user.username;
      dbUsername = user.username;
      dbUserId = user.id;
      db.prepare('UPDATE users SET matches_played = matches_played + 1 WHERE id = ?').run(user.id);
      
      // Assign random color
      const color = user.avatar_color || randomColor();

      players[socket.id] = {
        id: socket.id,
        name: playerName,
        username: dbUsername,
        userId: dbUserId,
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

          if (players[socket.id].userId) {
            db.prepare('UPDATE users SET total_score = total_score + 100, level = CAST(((total_score + 100) / 1000) AS INTEGER) + 1 WHERE id = ?')
              .run(players[socket.id].userId);
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