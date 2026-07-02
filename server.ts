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
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';

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
    users.id AS id,
    users.username AS username,
    COALESCE(users.display_name, users.username) AS display_name,
    COALESCE(users.bio, '') AS bio,
    COALESCE(users.avatar_color, '#00ffff') AS avatar_color,
    users.total_score AS total_score,
    users.level AS level,
    users.matches_played AS matches_played,
    users.created_at AS created_at
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
  
  const PORT = Number(process.env.PORT) || 3000;
  
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
    try {
      const authReq = req as express.Request & { user: PublicUser };
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : authReq.user.display_name;
      const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 160) : authReq.user.bio;
      const avatarColor = typeof body.avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.avatarColor)
        ? body.avatarColor
        : authReq.user.avatar_color;

      if (!displayName) {
        return res.status(400).json({ error: 'Display name is required' });
      }

      db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_color = ? WHERE id = ?')
        .run(displayName, bio, avatarColor, authReq.user.id);
      const updatedUser = db.prepare(`${PROFILE_SELECT} WHERE users.id = ?`).get(authReq.user.id) as PublicUser | undefined;
      res.json({ user: updatedUser });
    } catch (error) {
      console.error('Profile update failed:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  const LOBBY_PLATFORM_ROOM = 'lobby-platform';
  const MATCH_DURATION_SEC = 120;

  type LobbyStatus = 'waiting' | 'playing';
  type LobbyMember = {
    socketId: string;
    userId: number;
    username: string;
    name: string;
    color: string;
  };
  type Lobby = {
    id: string;
    name: string;
    creatorUserId: number;
    creatorSocketId: string;
    maxPlayers: number;
    status: LobbyStatus;
    members: Map<string, LobbyMember>;
    createdAt: number;
  };
  type GamePlayer = {
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
  };
  type GameState = {
    lobbyId: string;
    endsAt: number;
    players: Record<string, GamePlayer>;
  };

  function serializeLobby(lobby: Lobby) {
    return JSON.stringify({
      ...lobby,
      members: Array.from(lobby.members.entries()),
    });
  }

  function deserializeLobby(rawLobby: string) {
    const parsed = JSON.parse(rawLobby) as Omit<Lobby, 'members'> & {
      members: Array<[string, LobbyMember]>;
    };
    return {
      ...parsed,
      members: new Map(parsed.members),
    } as Lobby;
  }

  interface StateStore {
    listLobbies(): Promise<Lobby[]>;
    getLobby(lobbyId: string): Promise<Lobby | null>;
    saveLobby(lobby: Lobby): Promise<void>;
    deleteLobby(lobbyId: string): Promise<void>;
    getGame(lobbyId: string): Promise<GameState | null>;
    saveGame(game: GameState): Promise<void>;
    deleteGame(lobbyId: string): Promise<void>;
  }

  class MemoryStateStore implements StateStore {
    private readonly lobbies = new Map<string, Lobby>();
    private readonly games = new Map<string, GameState>();

    async listLobbies() {
      return Array.from(this.lobbies.values());
    }

    async getLobby(lobbyId: string) {
      return this.lobbies.get(lobbyId) ?? null;
    }

    async saveLobby(lobby: Lobby) {
      this.lobbies.set(lobby.id, lobby);
    }

    async deleteLobby(lobbyId: string) {
      this.lobbies.delete(lobbyId);
      this.games.delete(lobbyId);
    }

    async getGame(lobbyId: string) {
      return this.games.get(lobbyId) ?? null;
    }

    async saveGame(game: GameState) {
      this.games.set(game.lobbyId, game);
    }

    async deleteGame(lobbyId: string) {
      this.games.delete(lobbyId);
    }
  }

  class RedisStateStore implements StateStore {
    private readonly lobbyIndexKey = 'neon-arena:lobbies';

    constructor(private readonly client: RedisClientType) {}

    private lobbyKey(lobbyId: string) {
      return `neon-arena:lobby:${lobbyId}`;
    }

    private gameKey(lobbyId: string) {
      return `neon-arena:game:${lobbyId}`;
    }

    async listLobbies() {
      const lobbyIds = await this.client.sMembers(this.lobbyIndexKey);
      if (lobbyIds.length === 0) return [];

      const rawLobbies = await this.client.mGet(lobbyIds.map((lobbyId) => this.lobbyKey(lobbyId)));
      const lobbies: Lobby[] = [];

      for (const rawLobby of rawLobbies) {
        if (typeof rawLobby !== 'string') continue;
        try {
          lobbies.push(deserializeLobby(rawLobby));
        } catch {
          // Ignore malformed lobby entries and continue.
        }
      }

      return lobbies;
    }

    async getLobby(lobbyId: string) {
      const rawLobby = await this.client.get(this.lobbyKey(lobbyId));
      if (typeof rawLobby !== 'string') return null;
      return deserializeLobby(rawLobby);
    }

    async saveLobby(lobby: Lobby) {
      await this.client
        .multi()
        .sAdd(this.lobbyIndexKey, lobby.id)
        .set(this.lobbyKey(lobby.id), serializeLobby(lobby))
        .exec();
    }

    async deleteLobby(lobbyId: string) {
      await this.client
        .multi()
        .sRem(this.lobbyIndexKey, lobbyId)
        .del(this.lobbyKey(lobbyId))
        .del(this.gameKey(lobbyId))
        .exec();
    }

    async getGame(lobbyId: string) {
      const rawGame = await this.client.get(this.gameKey(lobbyId));
      if (typeof rawGame !== 'string') return null;
      return JSON.parse(rawGame) as GameState;
    }

    async saveGame(game: GameState) {
      await this.client.set(this.gameKey(game.lobbyId), JSON.stringify(game));
    }

    async deleteGame(lobbyId: string) {
      await this.client.del(this.gameKey(lobbyId));
    }
  }

  let stateStore: StateStore = new MemoryStateStore();
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || process.env.REDIS_PUBLIC_URL;

  if (redisUrl) {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    stateStore = new RedisStateStore(pubClient);
    console.log('Redis-backed multiplayer enabled.');
  } else {
    console.log('Redis not configured; using in-memory multiplayer state.');
  }

  const socketToLobby = new Map<string, string>();
  const socketToGame = new Map<string, string>();
  const socketUsers = new Map<string, PublicUser>();

  function lobbyRoomId(lobbyId: string) {
    return `lobby-${lobbyId}`;
  }

  function gameRoomId(lobbyId: string) {
    return `game-${lobbyId}`;
  }

  function toPublicLobby(lobby: Lobby) {
    const host = lobby.members.get(lobby.creatorSocketId);
    return {
      id: lobby.id,
      name: lobby.name,
      hostName: host?.name ?? 'Unknown',
      playerCount: lobby.members.size,
      maxPlayers: lobby.maxPlayers,
      status: lobby.status,
      createdAt: lobby.createdAt,
    };
  }

  function toPublicLobbyDetail(lobby: Lobby) {
    return {
      ...toPublicLobby(lobby),
      members: Array.from(lobby.members.values()).map(member => ({
        socketId: member.socketId,
        userId: member.userId,
        username: member.username,
        name: member.name,
        color: member.color,
        isHost: member.socketId === lobby.creatorSocketId,
      })),
    };
  }

  async function broadcastLobbyList() {
    const list = (await stateStore.listLobbies())
      .filter(lobby => lobby.status === 'waiting')
      .map(toPublicLobby)
      .sort((a, b) => b.createdAt - a.createdAt);
    io.to(LOBBY_PLATFORM_ROOM).emit('lobbyList', list);
  }

  async function emitLobbyUpdate(lobby: Lobby) {
    io.to(lobbyRoomId(lobby.id)).emit('lobbyUpdated', toPublicLobbyDetail(lobby));
    await broadcastLobbyList();
  }

  async function removeMemberFromLobby(socketId: string) {
    const lobbyId = socketToLobby.get(socketId);
    if (!lobbyId) return;

    const lobby = await stateStore.getLobby(lobbyId);
    if (!lobby) {
      socketToLobby.delete(socketId);
      return;
    }

    lobby.members.delete(socketId);
    socketToLobby.delete(socketId);
    io.sockets.sockets.get(socketId)?.leave(lobbyRoomId(lobbyId));

    if (lobby.members.size === 0) {
      await stateStore.deleteLobby(lobbyId);
      await broadcastLobbyList();
      return;
    }

    if (lobby.creatorSocketId === socketId) {
      const nextHost = lobby.members.values().next().value as LobbyMember;
      lobby.creatorSocketId = nextHost.socketId;
      lobby.creatorUserId = nextHost.userId;
    }

    if (lobby.status === 'waiting') {
      await stateStore.saveLobby(lobby);
      await emitLobbyUpdate(lobby);
      io.to(lobbyRoomId(lobbyId)).emit('lobbyPlayerLeft', { socketId, lobby: toPublicLobbyDetail(lobby) });
    } else {
      await stateStore.saveLobby(lobby);
    }
  }

  async function removePlayerFromGame(socketId: string) {
    const lobbyId = socketToGame.get(socketId);
    if (!lobbyId) return;

    const game = await stateStore.getGame(lobbyId);
    if (!game || !game.players[socketId]) return;

    delete game.players[socketId];
    await stateStore.saveGame(game);
    socketToGame.delete(socketId);
    io.to(gameRoomId(lobbyId)).emit('playerLeft', socketId);
  }

  async function endLobbyMatch(lobbyId: string) {
    const lobby = await stateStore.getLobby(lobbyId);
    if (!lobby) return;

    lobby.status = 'waiting';
    await stateStore.saveLobby(lobby);
    await stateStore.deleteGame(lobbyId);

    for (const member of lobby.members.values()) {
      socketToGame.delete(member.socketId);
      const memberSocket = io.sockets.sockets.get(member.socketId);
      memberSocket?.leave(gameRoomId(lobbyId));
    }

    io.to(lobbyRoomId(lobbyId)).emit('lobbyMatchEnded', toPublicLobbyDetail(lobby));
    await broadcastLobbyList();
  }

  setInterval(async () => {
    const lobbies = await stateStore.listLobbies();
    for (const lobby of lobbies) {
      if (lobby.status !== 'playing') continue;
      const game = await stateStore.getGame(lobby.id);
      if (!game || game.endsAt <= Date.now()) {
        await endLobbyMatch(lobby.id);
      }
    }
  }, 5000);

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('connectLobbyPlatform', async (token?: string) => {
      const user = getUserByToken(token);
      if (!user) {
        socket.emit('lobbyError', 'You must sign in before entering the lobby');
        return;
      }

      socketUsers.set(socket.id, user);
      socket.join(LOBBY_PLATFORM_ROOM);
      const waitingLobbies = (await stateStore.listLobbies())
        .filter((lobby) => lobby.status === 'waiting')
        .map(toPublicLobby);
      socket.emit('lobbyList', waitingLobbies);
    });

    socket.on('createLobby', async (data: { name?: string; maxPlayers?: number }) => {
      const user = socketUsers.get(socket.id);
      if (!user) {
        socket.emit('lobbyError', 'Sign in required');
        return;
      }
      if (socketToLobby.has(socket.id)) {
        socket.emit('lobbyError', 'Leave your current lobby first');
        return;
      }

      const name = typeof data?.name === 'string' ? data.name.trim() : '';
      const maxPlayers = Math.min(16, Math.max(2, Number(data?.maxPlayers) || 8));
      if (name.length < 3 || name.length > 30) {
        socket.emit('lobbyError', 'Lobby name must be 3-30 characters');
        return;
      }

      const lobbyId = crypto.randomBytes(6).toString('hex');
      const member: LobbyMember = {
        socketId: socket.id,
        userId: user.id,
        username: user.username,
        name: user.display_name || user.username,
        color: user.avatar_color || randomColor(),
      };

      const lobby: Lobby = {
        id: lobbyId,
        name,
        creatorUserId: user.id,
        creatorSocketId: socket.id,
        maxPlayers,
        status: 'waiting',
        members: new Map([[socket.id, member]]),
        createdAt: Date.now(),
      };

      await stateStore.saveLobby(lobby);
      socketToLobby.set(socket.id, lobbyId);
      socket.join(lobbyRoomId(lobbyId));

      const detail = toPublicLobbyDetail(lobby);
      socket.emit('lobbyJoined', detail);
      await broadcastLobbyList();
    });

    socket.on('joinLobby', async (lobbyId: string) => {
      const user = socketUsers.get(socket.id);
      if (!user) {
        socket.emit('lobbyError', 'Sign in required');
        return;
      }
      if (socketToLobby.has(socket.id)) {
        socket.emit('lobbyError', 'Leave your current lobby first');
        return;
      }

      const lobby = await stateStore.getLobby(lobbyId);
      if (!lobby) {
        socket.emit('lobbyError', 'Lobby not found');
        return;
      }
      if (lobby.status !== 'waiting') {
        socket.emit('lobbyError', 'This match has already started');
        return;
      }
      if (lobby.members.size >= lobby.maxPlayers) {
        socket.emit('lobbyError', 'Lobby is full');
        return;
      }

      const member: LobbyMember = {
        socketId: socket.id,
        userId: user.id,
        username: user.username,
        name: user.display_name || user.username,
        color: user.avatar_color || randomColor(),
      };

      lobby.members.set(socket.id, member);
      await stateStore.saveLobby(lobby);
      socketToLobby.set(socket.id, lobbyId);
      socket.join(lobbyRoomId(lobbyId));

      const detail = toPublicLobbyDetail(lobby);
      socket.emit('lobbyJoined', detail);
      socket.to(lobbyRoomId(lobbyId)).emit('lobbyPlayerJoined', { member: { ...member, isHost: false }, lobby: detail });
      await broadcastLobbyList();
    });

    socket.on('leaveLobby', async () => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) return;
      await removeMemberFromLobby(socket.id);
      socket.emit('lobbyLeft');
      await broadcastLobbyList();
    });

    socket.on('startLobby', async () => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) {
        socket.emit('lobbyError', 'You are not in a lobby');
        return;
      }

      const lobby = await stateStore.getLobby(lobbyId);
      if (!lobby) {
        socket.emit('lobbyError', 'Lobby not found');
        return;
      }
      if (lobby.creatorSocketId !== socket.id) {
        socket.emit('lobbyError', 'Only the lobby host can start the game');
        return;
      }
      if (lobby.status !== 'waiting') {
        socket.emit('lobbyError', 'Match already in progress');
        return;
      }
      if (lobby.members.size < 1) {
        socket.emit('lobbyError', 'Need at least one player to start');
        return;
      }

      lobby.status = 'playing';
      await stateStore.saveLobby(lobby);
      const players: Record<string, GamePlayer> = {};
      const endsAt = Date.now() + MATCH_DURATION_SEC * 1000;

      for (const member of lobby.members.values()) {
        db.prepare('UPDATE users SET matches_played = matches_played + 1 WHERE id = ?').run(member.userId);
        players[member.socketId] = {
          id: member.socketId,
          name: member.name,
          username: member.username,
          userId: member.userId,
          position: [0, 2, 0],
          rotation: 0,
          state: 'active',
          disabledUntil: 0,
          score: 0,
          color: member.color,
        };
        socketToGame.set(member.socketId, lobbyId);
        io.sockets.sockets.get(member.socketId)?.join(gameRoomId(lobbyId));
      }

      await stateStore.saveGame({ lobbyId, endsAt, players });
      await broadcastLobbyList();

      io.to(lobbyRoomId(lobbyId)).emit('lobbyStarted', {
        lobby: toPublicLobbyDetail(lobby),
        players,
        matchDuration: MATCH_DURATION_SEC,
      });
    });

    socket.on('updatePosition', async (data: { position: [number, number, number], rotation: number }) => {
      const lobbyId = socketToGame.get(socket.id);
      if (!lobbyId) return;
      const game = await stateStore.getGame(lobbyId);
      if (!game?.players[socket.id]) return;

      game.players[socket.id].position = data.position;
      game.players[socket.id].rotation = data.rotation;
      await stateStore.saveGame(game);
      socket.to(gameRoomId(lobbyId)).emit('playerMoved', { id: socket.id, ...data });
    });

    socket.on('shoot', (data: { start: [number, number, number], end: [number, number, number], color: string }) => {
      const lobbyId = socketToGame.get(socket.id);
      if (!lobbyId) return;
      socket.to(gameRoomId(lobbyId)).emit('playerShot', { id: socket.id, ...data });
    });

    socket.on('hitPlayer', async (targetId: string) => {
      const lobbyId = socketToGame.get(socket.id);
      if (!lobbyId) return;
      const game = await stateStore.getGame(lobbyId);
      if (!game?.players[targetId] || !game.players[socket.id]) return;

      const now = Date.now();
      if (game.players[targetId].state === 'active' || now > game.players[targetId].disabledUntil) {
        game.players[targetId].state = 'disabled';
        game.players[targetId].disabledUntil = now + 3000;
        game.players[socket.id].score += 100;

        if (game.players[socket.id].userId) {
          db.prepare('UPDATE users SET total_score = total_score + 100, level = CAST(((total_score + 100) / 1000) AS INTEGER) + 1 WHERE id = ?')
            .run(game.players[socket.id].userId);
        }
        await stateStore.saveGame(game);

        io.to(gameRoomId(lobbyId)).emit('playerHit', {
          targetId,
          shooterId: socket.id,
          targetDisabledUntil: game.players[targetId].disabledUntil,
          shooterScore: game.players[socket.id].score,
        });
      }
    });

    socket.on('leaveMatch', async () => {
      await removePlayerFromGame(socket.id);
      socket.emit('matchLeft');
    });

    socket.on('disconnect', async () => {
      await removePlayerFromGame(socket.id);
      await removeMemberFromLobby(socket.id);
      socketUsers.delete(socket.id);
      await broadcastLobbyList();
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
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();