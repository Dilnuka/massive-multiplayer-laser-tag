/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

export type GameState = 'menu' | 'lobby' | 'playing' | 'gameover';
export type EntityState = 'active' | 'disabled';

export interface EnemyData {
  id: string;
  position: [number, number, number];
  state: EntityState;
  disabledUntil: number;
}

export interface PlayerData {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: number;
  state: EntityState;
  disabledUntil: number;
  score: number;
  color: string;
}

export interface UserProfile {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  avatar_color: string;
  total_score: number;
  level: number;
  matches_played: number;
  created_at: number;
}

export interface PublicLobby {
  id: string;
  name: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  createdAt: number;
}

export interface LobbyMember {
  socketId: string;
  userId: number;
  username: string;
  name: string;
  color: string;
  isHost: boolean;
}

export interface LobbyDetail extends PublicLobby {
  members: LobbyMember[];
}

export interface LaserData {
  id: string;
  start: [number, number, number];
  end: [number, number, number];
  timestamp: number;
  color: string;
}

export interface ParticleData {
  id: string;
  position: [number, number, number];
  timestamp: number;
  color: string;
}

export interface GameEvent {
  id: string;
  message: string;
  timestamp: number;
}

interface GameStore {
  gameState: GameState;
  authLoading: boolean;
  score: number;
  timeLeft: number;
  playerState: EntityState;
  playerDisabledUntil: number;
  enemies: EnemyData[];
  lasers: LaserData[];
  particles: ParticleData[];
  events: GameEvent[];

  socket: Socket | null;
  authToken: string | null;
  currentUser: UserProfile | null;
  setAuth: (token: string | null, user: UserProfile | null) => void;
  loadSession: () => Promise<void>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  updateProfile: (profile: { displayName: string; bio: string; avatarColor: string }) => Promise<{ ok: boolean; error?: string }>;
  otherPlayers: Record<string, PlayerData>;
  localPlayerPosition: [number, number, number];
  localPlayerRotation: number;
  setLocalPlayerPosition: (pos: [number, number, number]) => void;
  setLocalPlayerRotation: (rotation: number) => void;

  lobbies: PublicLobby[];
  currentLobby: LobbyDetail | null;
  isLobbyHost: boolean;
  enterLobbyPlatform: () => Promise<{ ok: boolean; error?: string }>;
  leaveLobbyPlatform: () => void;
  createLobby: (name: string, maxPlayers: number) => Promise<{ ok: boolean; error?: string }>;
  joinLobby: (lobbyId: string) => Promise<{ ok: boolean; error?: string }>;
  leaveLobby: () => Promise<void>;
  startLobby: () => Promise<{ ok: boolean; error?: string }>;

  endGame: () => void;
  leaveGame: () => void;
  updateTime: (delta: number) => void;
  hitPlayer: () => void;
  hitEnemy: (id: string, byPlayer?: boolean) => void;
  addLaser: (start: [number, number, number], end: [number, number, number], color: string) => void;
  addParticles: (position: [number, number, number], color: string) => void;
  addEvent: (message: string) => void;
  updateEnemies: (time: number) => void;
  cleanupEffects: (time: number) => void;
  setPlayerState: (state: EntityState) => void;
  updatePlayerPosition: (position: [number, number, number], rotation: number) => void;

  mobileInput: {
    move: { x: number, y: number };
    look: { x: number, y: number };
    shooting: boolean;
  };
  setMobileInput: (input: Partial<{
    move: { x: number, y: number };
    look: { x: number, y: number };
    shooting: boolean;
  }>) => void;
}

const INITIAL_ENEMIES: EnemyData[] = [
  { id: 'bot-1', position: [40, 1, 40], state: 'active', disabledUntil: 0 },
  { id: 'bot-2', position: [-40, 1, 40], state: 'active', disabledUntil: 0 },
  { id: 'bot-3', position: [40, 1, -40], state: 'active', disabledUntil: 0 },
  { id: 'bot-4', position: [-40, 1, -40], state: 'active', disabledUntil: 0 },
  { id: 'bot-5', position: [0, 1, -50], state: 'active', disabledUntil: 0 },
  { id: 'bot-6', position: [60, 1, 0], state: 'active', disabledUntil: 0 },
  { id: 'bot-7', position: [-60, 1, 0], state: 'active', disabledUntil: 0 },
  { id: 'bot-8', position: [0, 1, 50], state: 'active', disabledUntil: 0 },
];

let lobbyActionResolver: ((result: { ok: boolean; error?: string }) => void) | null = null;

function resolveLobbyAction(result: { ok: boolean; error?: string }) {
  if (lobbyActionResolver) {
    lobbyActionResolver(result);
    lobbyActionResolver = null;
  }
}

function waitForLobbyAction(timeoutMs = 5000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      if (lobbyActionResolver) {
        lobbyActionResolver = null;
        resolve({ ok: false, error: 'Request timed out' });
      }
    }, timeoutMs);
    lobbyActionResolver = (result) => {
      window.clearTimeout(timeout);
      resolve(result);
    };
  });
}

function attachGameListeners(socket: Socket, set: typeof useGameStore.setState, get: () => GameStore) {
  socket.off('lobbyStarted');
  socket.off('playerJoined');
  socket.off('playerMoved');
  socket.off('playerShot');
  socket.off('playerHit');
  socket.off('playerLeft');
  socket.off('lobbyMatchEnded');
  socket.off('matchLeft');

  socket.on('lobbyStarted', (data: { lobby: LobbyDetail; players: Record<string, PlayerData>; matchDuration: number }) => {
    const otherPlayers = { ...data.players };
    delete otherPlayers[socket.id!];
    set({
      currentLobby: data.lobby,
      isLobbyHost: data.lobby.members.find(m => m.socketId === socket.id)?.isHost ?? false,
      gameState: 'playing',
      timeLeft: data.matchDuration,
      score: 0,
      playerState: 'active',
      playerDisabledUntil: 0,
      otherPlayers,
      enemies: INITIAL_ENEMIES.map(e => ({ ...e, state: 'active', disabledUntil: 0 })),
      lasers: [],
      particles: [],
      events: [{ id: Math.random().toString(), message: 'Match started!', timestamp: Date.now() }],
    });
    get().refreshCurrentUser();
    resolveLobbyAction({ ok: true });
  });

  socket.on('playerJoined', (player: PlayerData) => {
    set(state => ({
      otherPlayers: { ...state.otherPlayers, [player.id]: player },
      events: [...state.events, { id: Math.random().toString(), message: `${player.name} joined`, timestamp: Date.now() }],
    }));
  });

  socket.on('playerMoved', (data: { id: string, position: [number, number, number], rotation: number }) => {
    set(state => {
      if (!state.otherPlayers[data.id]) return state;
      return {
        otherPlayers: {
          ...state.otherPlayers,
          [data.id]: {
            ...state.otherPlayers[data.id],
            position: data.position,
            rotation: data.rotation,
          },
        },
      };
    });
  });

  socket.on('playerShot', (data: { id: string, start: [number, number, number], end: [number, number, number], color: string }) => {
    set(state => ({
      lasers: [...state.lasers, { id: Math.random().toString(36).slice(2, 11), start: data.start, end: data.end, timestamp: Date.now(), color: data.color }],
      particles: [...state.particles, { id: Math.random().toString(36).slice(2, 11), position: data.end, timestamp: Date.now(), color: data.color }],
    }));
  });

  socket.on('playerHit', (data: { targetId: string, shooterId: string, targetDisabledUntil: number, shooterScore: number }) => {
    set(state => {
      const isLocalShooter = data.shooterId === socket.id;
      const isLocalTarget = data.targetId === socket.id;
      const shooterName = isLocalShooter ? 'You' : (state.otherPlayers[data.shooterId]?.name || 'Unknown');
      const targetName = isLocalTarget ? 'You' : (state.otherPlayers[data.targetId]?.name || 'Unknown');
      const newEvent = { id: Math.random().toString(), message: `${shooterName} tagged ${targetName}`, timestamp: Date.now() };

      const newState: Partial<GameStore> = {
        events: [...state.events, newEvent],
      };

      if (isLocalTarget) {
        newState.playerState = 'disabled';
        newState.playerDisabledUntil = data.targetDisabledUntil;
      }
      if (isLocalShooter) {
        newState.score = data.shooterScore;
        void get().refreshCurrentUser();
      }

      const players = { ...state.otherPlayers };
      let playersChanged = false;

      if (!isLocalTarget && players[data.targetId]) {
        players[data.targetId] = { ...players[data.targetId], state: 'disabled', disabledUntil: data.targetDisabledUntil };
        playersChanged = true;
      }
      if (!isLocalShooter && players[data.shooterId]) {
        players[data.shooterId] = { ...players[data.shooterId], score: data.shooterScore };
        playersChanged = true;
      }
      if (playersChanged) {
        newState.otherPlayers = players;
      }

      return newState;
    });
  });

  socket.on('playerLeft', (id: string) => {
    set(state => {
      const players = { ...state.otherPlayers };
      const playerName = players[id]?.name || 'Unknown';
      delete players[id];
      return {
        otherPlayers: players,
        events: [...state.events, { id: Math.random().toString(), message: `${playerName} left`, timestamp: Date.now() }],
      };
    });
  });

  socket.on('lobbyMatchEnded', (lobby: LobbyDetail) => {
    set({
      gameState: 'gameover',
      currentLobby: lobby,
      isLobbyHost: lobby.members.find(m => m.socketId === socket.id)?.isHost ?? false,
      otherPlayers: {},
      enemies: [],
    });
  });

  socket.on('matchLeft', () => {
    set({
      gameState: 'lobby',
      score: 0,
      timeLeft: 120,
      playerState: 'active',
      playerDisabledUntil: 0,
      otherPlayers: {},
      enemies: [],
      lasers: [],
      particles: [],
      events: [],
    });
  });
}

function attachLobbyListeners(socket: Socket, set: typeof useGameStore.setState, get: () => GameStore) {
  socket.off('lobbyList');
  socket.off('lobbyJoined');
  socket.off('lobbyUpdated');
  socket.off('lobbyPlayerJoined');
  socket.off('lobbyPlayerLeft');
  socket.off('lobbyLeft');
  socket.off('lobbyError');

  socket.on('lobbyList', (list: PublicLobby[]) => {
    set({ lobbies: list });
  });

  socket.on('lobbyJoined', (lobby: LobbyDetail) => {
    set({
      currentLobby: lobby,
      isLobbyHost: lobby.members.find(m => m.socketId === socket.id)?.isHost ?? false,
      gameState: 'lobby',
    });
    resolveLobbyAction({ ok: true });
  });

  socket.on('lobbyUpdated', (lobby: LobbyDetail) => {
    set({
      currentLobby: lobby,
      isLobbyHost: lobby.members.find(m => m.socketId === socket.id)?.isHost ?? false,
    });
  });

  socket.on('lobbyPlayerJoined', (data: { lobby: LobbyDetail }) => {
    set({
      currentLobby: data.lobby,
      isLobbyHost: data.lobby.members.find(m => m.socketId === socket.id)?.isHost ?? false,
    });
  });

  socket.on('lobbyPlayerLeft', (data: { lobby: LobbyDetail }) => {
    set({
      currentLobby: data.lobby,
      isLobbyHost: data.lobby.members.find(m => m.socketId === socket.id)?.isHost ?? false,
    });
  });

  socket.on('lobbyLeft', () => {
    set({ currentLobby: null, isLobbyHost: false });
    resolveLobbyAction({ ok: true });
  });

  socket.on('lobbyError', (msg: string) => {
    resolveLobbyAction({ ok: false, error: msg });
    if (get().gameState === 'playing') {
      alert(msg);
      get().leaveGame();
    }
  });
}

function ensureSocket(authToken: string): Socket {
  const existing = useGameStore.getState().socket;
  if (existing?.connected) {
    return existing;
  }
  if (existing) {
    existing.disconnect();
  }

  const socket = io(window.location.origin);
  useGameStore.setState({ socket });
  return socket;
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameState: 'menu',
  authLoading: true,
  score: 0,
  timeLeft: 120,
  playerState: 'active',
  playerDisabledUntil: 0,
  enemies: [],
  lasers: [],
  particles: [],
  events: [],

  socket: null,
  authToken: null,
  currentUser: null,
  setAuth: (token, user) => {
    if (typeof window !== 'undefined') {
      if (token) {
        window.localStorage.setItem('auth_token', token);
      } else {
        window.localStorage.removeItem('auth_token');
      }
    }
    set({ authToken: token, currentUser: user, authLoading: false });
  },
  loadSession: async () => {
    if (typeof window === 'undefined') {
      set({ authLoading: false });
      return;
    }

    const token = window.localStorage.getItem('auth_token');
    if (!token) {
      set({ authToken: null, currentUser: null, authLoading: false });
      return;
    }

    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        window.localStorage.removeItem('auth_token');
        set({ authToken: null, currentUser: null, authLoading: false });
        return;
      }
      const data = await res.json();
      set({ authToken: token, currentUser: data.user, authLoading: false });
    } catch {
      set({ authLoading: false });
    }
  },
  logout: async () => {
    const { authToken, socket } = get();
    if (socket) {
      socket.disconnect();
    }
    if (authToken) {
      try {
        await fetch('/api/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // Ignore logout network failures.
      }
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('auth_token');
    }
    set({
      authToken: null,
      currentUser: null,
      authLoading: false,
      gameState: 'menu',
      socket: null,
      lobbies: [],
      currentLobby: null,
      isLobbyHost: false,
      otherPlayers: {},
      enemies: [],
      lasers: [],
      particles: [],
      events: [],
      score: 0,
      timeLeft: 120,
      playerState: 'active',
      playerDisabledUntil: 0,
    });
  },
  refreshCurrentUser: async () => {
    const { authToken } = get();
    if (!authToken) return;
    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      set({ currentUser: data.user });
    } catch {
      // Ignore transient refresh failures.
    }
  },
  updateProfile: async ({ displayName, bio, avatarColor }) => {
    const { authToken } = get();
    if (!authToken) {
      return { ok: false, error: 'You must be signed in' };
    }

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ displayName, bio, avatarColor }),
      });
      const raw = await res.text();
      let data: { user?: UserProfile; error?: string } = {};
      if (raw) {
        try {
          data = JSON.parse(raw) as { user?: UserProfile; error?: string };
        } catch {
          data = {};
        }
      }
      if (!res.ok) {
        return { ok: false, error: data.error || `Failed to update profile (${res.status})` };
      }
      if (data.user) {
        set({ currentUser: data.user });
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Failed to connect to server' };
    }
  },
  otherPlayers: {},
  localPlayerPosition: [0, 2, 0],
  localPlayerRotation: 0,
  setLocalPlayerPosition: (pos) => set({ localPlayerPosition: pos }),
  setLocalPlayerRotation: (rotation) => set({ localPlayerRotation: rotation }),

  lobbies: [],
  currentLobby: null,
  isLobbyHost: false,

  enterLobbyPlatform: async () => {
    const { authToken } = get();
    if (!authToken) {
      return { ok: false, error: 'You must be signed in' };
    }

    const socket = ensureSocket(authToken);
    attachLobbyListeners(socket, set, get);
    attachGameListeners(socket, set, get);

    return new Promise((resolve) => {
      const onConnect = () => {
        socket.emit('connectLobbyPlatform', authToken);
        set({ gameState: 'lobby', currentLobby: null, lobbies: [] });
        resolve({ ok: true });
      };

      if (socket.connected) {
        socket.emit('connectLobbyPlatform', authToken);
        set({ gameState: 'lobby', currentLobby: null, lobbies: [] });
        resolve({ ok: true });
        return;
      }

      socket.once('connect', onConnect);
      socket.once('connect_error', () => resolve({ ok: false, error: 'Failed to connect to server' }));
    });
  },

  leaveLobbyPlatform: () => {
    const { socket } = get();
    if (socket) {
      socket.emit('leaveLobby');
      socket.disconnect();
    }
    set({
      gameState: 'menu',
      socket: null,
      lobbies: [],
      currentLobby: null,
      isLobbyHost: false,
    });
  },

  createLobby: async (name, maxPlayers) => {
    const { socket } = get();
    if (!socket) {
      return { ok: false, error: 'Not connected to lobby platform' };
    }
    const action = waitForLobbyAction();
    socket.emit('createLobby', { name, maxPlayers });
    return action;
  },

  joinLobby: async (lobbyId) => {
    const { socket } = get();
    if (!socket) {
      return { ok: false, error: 'Not connected to lobby platform' };
    }
    const action = waitForLobbyAction();
    socket.emit('joinLobby', lobbyId);
    const result = await action;
    if (!result.ok) {
      alert(result.error);
    }
    return result;
  },

  leaveLobby: async () => {
    const { socket } = get();
    if (socket) {
      socket.emit('leaveLobby');
    }
    set({ currentLobby: null, isLobbyHost: false });
  },

  startLobby: async () => {
    const { socket } = get();
    if (!socket) {
      return { ok: false, error: 'Not connected to lobby platform' };
    }
    const action = waitForLobbyAction(10000);
    socket.emit('startLobby');
    return action;
  },

  endGame: () => {
    set({ gameState: 'gameover', otherPlayers: {}, enemies: [] });
  },

  leaveGame: () => {
    const { socket } = get();
    if (socket) {
      socket.emit('leaveMatch');
    }
    set({
      gameState: 'lobby',
      score: 0,
      timeLeft: 120,
      playerState: 'active',
      playerDisabledUntil: 0,
      otherPlayers: {},
      enemies: [],
      lasers: [],
      particles: [],
      events: [],
    });
  },

  updateTime: (delta) => set((state) => {
    if (state.gameState !== 'playing') return state;
    const newTime = state.timeLeft - delta;
    if (newTime <= 0) {
      return { timeLeft: 0, gameState: 'gameover' as const, otherPlayers: {}, enemies: [] };
    }
    return { timeLeft: newTime };
  }),

  hitPlayer: () => set((state) => {
    if (state.playerState === 'disabled' || state.gameState !== 'playing') return state;
    return {
      playerState: 'disabled',
      playerDisabledUntil: Date.now() + 3000,
      score: Math.max(0, state.score - 50),
    };
  }),

  hitEnemy: (id, byPlayer = false) => set((state) => {
    if (state.gameState !== 'playing') return state;

    if (state.socket && state.otherPlayers[id]) {
      state.socket.emit('hitPlayer', id);
      return state;
    }

    const enemies = state.enemies.map(e => {
      if (e.id === id && e.state === 'active') {
        return { ...e, state: 'disabled' as EntityState, disabledUntil: Date.now() + 3000 };
      }
      return e;
    });
    return {
      enemies,
      score: byPlayer ? state.score + 100 : state.score,
      events: byPlayer ? [...state.events, { id: Math.random().toString(), message: `You tagged ${id}`, timestamp: Date.now() }] : state.events,
    };
  }),

  addLaser: (start, end, color) => {
    const { socket } = get();
    if (socket) {
      socket.emit('shoot', { start, end, color });
    }
    set((state) => ({
      lasers: [...state.lasers, { id: Math.random().toString(36).slice(2, 11), start, end, timestamp: Date.now(), color }],
    }));
  },

  addParticles: (position, color) => set((state) => ({
    particles: [...state.particles, { id: Math.random().toString(36).slice(2, 11), position, timestamp: Date.now(), color }],
  })),

  addEvent: (message) => set((state) => ({
    events: [...state.events, { id: Math.random().toString(), message, timestamp: Date.now() }],
  })),

  updateEnemies: (time) => set((state) => {
    let changed = false;
    const enemies = state.enemies.map(e => {
      if (e.state === 'disabled' && time > e.disabledUntil) {
        changed = true;
        return { ...e, state: 'active' as EntityState };
      }
      return e;
    });

    let otherPlayers = state.otherPlayers;
    let playersChanged = false;
    Object.values(state.otherPlayers).forEach(p => {
      if (p.state === 'disabled' && time > p.disabledUntil) {
        if (!playersChanged) {
          otherPlayers = { ...state.otherPlayers };
          playersChanged = true;
        }
        otherPlayers[p.id] = { ...p, state: 'active' };
      }
    });

    if (state.playerState === 'disabled' && time > state.playerDisabledUntil) {
      return { enemies, playerState: 'active', otherPlayers: playersChanged ? otherPlayers : state.otherPlayers };
    }
    return changed || playersChanged ? { enemies, otherPlayers } : state;
  }),

  cleanupEffects: (time) => set((state) => {
    const lasers = state.lasers.filter(l => time - l.timestamp < 200);
    const particles = state.particles.filter(p => time - p.timestamp < 500);
    const events = state.events.filter(e => time - e.timestamp < 5000);
    if (lasers.length !== state.lasers.length || particles.length !== state.particles.length || events.length !== state.events.length) {
      return { lasers, particles, events };
    }
    return state;
  }),

  setPlayerState: (playerState) => set({ playerState }),

  updatePlayerPosition: (position, rotation) => {
    const { socket } = get();
    if (socket) {
      socket.emit('updatePosition', { position, rotation });
    }
  },

  mobileInput: {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    shooting: false,
  },

  setMobileInput: (input) => set((state) => ({
    mobileInput: { ...state.mobileInput, ...input },
  })),
}));
