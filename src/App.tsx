/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, useMemo, useState } from 'react';
import { Game } from './components/Game';
import { MobileControls } from './components/MobileControls';
import { LobbyBrowser, LobbyRoom } from './components/Lobby';
import { buildArenaObstacles } from './components/Arena';
import { useGameStore } from './store';

function usePointerLockState() {
  const [isPointerLocked, setIsPointerLocked] = useState(() => document.pointerLockElement != null);

  useEffect(() => {
    const handlePointerLockChange = () => {
      setIsPointerLocked(document.pointerLockElement != null);
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  return isPointerLocked;
}

function HUD() {
  const gameState = useGameStore(state => state.gameState);
  const score = useGameStore(state => state.score);
  const timeLeft = useGameStore(state => state.timeLeft);
  const playerState = useGameStore(state => state.playerState);
  const otherPlayers = useGameStore(state => state.otherPlayers);
  const localPlayerPosition = useGameStore(state => state.localPlayerPosition);
  const localPlayerRotation = useGameStore(state => state.localPlayerRotation);
  const events = useGameStore(state => state.events);
  const currentLobby = useGameStore(state => state.currentLobby);
  const playerCount = Object.keys(otherPlayers).length + 1;
  const leaveGame = useGameStore(state => state.leaveGame);
  const isMobile = useIsMobile();
  const isPointerLocked = usePointerLockState();

  const handleResumeGame = () => {
    const canvas = document.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) {
      canvas.requestPointerLock();
    }
  };

  const leaderboard = useMemo(() => {
    const players = [
      { id: 'You', score: score, isMe: true },
      ...Object.values(otherPlayers).map(p => ({
        id: p.name,
        score: p.score,
        isMe: false
      }))
    ];
    return players.sort((a, b) => b.score - a.score);
  }, [score, otherPlayers]);

  return (
    <>
      {/* Minimap */}
      <div className="absolute bottom-4 left-4 pointer-events-none">
        <MiniMap
          arenaSize={200}
          me={localPlayerPosition}
          meRotation={localPlayerRotation}
          others={Object.values(otherPlayers).map(p => ({
            pos: p.position,
            rotation: p.rotation,
            color: p.color,
            state: p.state,
            name: p.name,
          }))}
        />
      </div>

      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center">
        <div className="relative">
          <div className={`w-4 h-4 border-2 rounded-full ${playerState === 'disabled' ? 'border-red-500' : 'border-cyan-400'}`} />
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full ${playerState === 'disabled' ? 'bg-red-500' : 'bg-cyan-400'}`} />
        </div>
        {!isMobile && <div className="mt-4 text-cyan-400/50 text-xs tracking-widest font-bold">CLICK TO AIM</div>}
      </div>

      {/* HUD Left - Score & Leaderboard */}
      <div className="absolute top-2 left-2 md:top-4 md:left-4 flex flex-col gap-2 md:gap-4 pointer-events-none">
        <div className="text-cyan-400 text-lg md:text-2xl font-bold drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
          SCORE: {score.toString().padStart(4, '0')}
        </div>
        
        {/* Leaderboard - Hide on mobile if screen is small, or make smaller */}
        {!isMobile && (
          <div className="bg-black/50 border border-cyan-900/50 p-3 rounded w-48 flex flex-col gap-1">
            <div className="text-cyan-400/70 text-xs font-bold mb-1 border-b border-cyan-900/50 pb-1">LEADERBOARD</div>
            {leaderboard.map((p, i) => (
              <div key={p.id} className={`flex justify-between text-sm ${p.isMe ? 'text-cyan-400 font-bold' : 'text-cyan-400/70'}`}>
                <span>{i + 1}. {p.id}</span>
                <span>{p.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* HUD Right - Time, Leave, Events */}
      <div className="absolute top-2 right-2 md:top-4 md:right-4 flex flex-col items-end gap-1 md:gap-2 pointer-events-auto">
        {gameState === 'playing' && (
          <div className="text-cyan-400 text-lg md:text-2xl font-bold drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] pointer-events-none">
            TIME: {Math.floor(timeLeft / 60)}:{(Math.floor(timeLeft) % 60).toString().padStart(2, '0')}
          </div>
        )}
        <button
          onClick={leaveGame}
          className="px-2 py-1 md:px-4 md:py-2 bg-red-500/20 border border-red-500 text-red-500 text-xs md:text-sm font-bold rounded hover:bg-red-500 hover:text-black transition-all duration-200"
        >
          LEAVE
        </button>
        {!isMobile && !isPointerLocked && (
          <button
            onClick={handleResumeGame}
            onMouseDown={(e) => e.stopPropagation()}
            className="px-3 py-2 bg-cyan-500/20 border border-cyan-400 text-cyan-400 text-xs md:text-sm font-bold rounded hover:bg-cyan-400 hover:text-black transition-all"
          >
            RESUME AIM
          </button>
        )}
        {!isMobile && (
          <div className="text-cyan-400/50 text-xs mt-1 pointer-events-none uppercase tracking-widest font-bold">
            {isPointerLocked ? 'ESC to unlock cursor' : 'Use RESUME AIM to re-enter the game'}
          </div>
        )}

        {/* Event Log */}
        <div className="mt-2 md:mt-4 flex flex-col items-end gap-1 pointer-events-none">
          {events.slice(-3).map(event => (
            <div key={event.id} className="text-[10px] md:text-xs font-bold text-fuchsia-400 bg-black/50 px-2 py-1 rounded border border-fuchsia-900/50 animate-pulse">
              {event.message}
            </div>
          ))}
        </div>
      </div>

      {/* Multiplayer Info */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
        {currentLobby && (
          <div className="text-fuchsia-400 text-[10px] md:text-xs font-bold drop-shadow-[0_0_8px_rgba(232,121,249,0.8)] mb-1">
            {currentLobby.name}
          </div>
        )}
        <div className="text-cyan-400 text-[10px] md:text-sm font-bold drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] opacity-70">
          PLAYERS ONLINE: {playerCount}
        </div>
      </div>

      {/* Damage Overlay */}
      {playerState === 'disabled' && (
        <div className="absolute inset-0 bg-red-500/20 pointer-events-none flex items-center justify-center">
          <div className="text-red-500 text-4xl md:text-6xl font-black tracking-widest drop-shadow-[0_0_20px_rgba(239,68,68,1)] animate-pulse text-center">
            SYSTEM DISABLED
          </div>
        </div>
      )}

      {/* Mobile Controls */}
      {isMobile && gameState === 'playing' && <MobileControls />}
    </>
  );
}

function MiniMap({
  arenaSize,
  me,
  meRotation,
  others,
}: {
  arenaSize: number;
  me: [number, number, number];
  meRotation: number;
  others: Array<{ pos: [number, number, number]; rotation: number; color: string; state: 'active' | 'disabled'; name: string }>;
}) {
  const size = 172;
  const obstacles = useMemo(() => buildArenaObstacles(150), []);
  const center = size / 2;
  const radarRadius = size / 2 - 10;
  const worldRadius = 42;
  const scale = radarRadius / worldRadius;
  const arenaMin = -arenaSize / 2;
  const arenaMax = arenaSize / 2;
  const rotationDegrees = (meRotation * 180) / Math.PI;
  const northX = center - Math.sin(meRotation) * (radarRadius - 10);
  const northY = center - Math.cos(meRotation) * (radarRadius - 10);

  const visibleObstacles = useMemo(() => {
    const margin = 18;
    return obstacles.filter((obstacle) => {
      const dx = obstacle.position[0] - me[0];
      const dz = obstacle.position[2] - me[2];
      return Math.abs(dx) <= worldRadius + obstacle.size[0] / 2 + margin
        && Math.abs(dz) <= worldRadius + obstacle.size[2] / 2 + margin;
    });
  }, [me, obstacles]);

  const visiblePlayers = useMemo(() => {
    const maxDistance = worldRadius * 1.35;
    return others.filter((player) => {
      const dx = player.pos[0] - me[0];
      const dz = player.pos[2] - me[2];
      return Math.hypot(dx, dz) <= maxDistance;
    });
  }, [me, others]);

  const renderWorldMarker = (
    x: number,
    z: number,
    rotation: number,
    fill: string,
    stroke: string,
    sizeScale: number,
  ) => (
    <g transform={`translate(${x} ${z})`}>
      <line
        x1={0}
        y1={0}
        x2={-Math.sin(rotation) * 5.2 * sizeScale}
        y2={-Math.cos(rotation) * 5.2 * sizeScale}
        stroke={fill}
        strokeWidth={1.5 / scale}
        strokeLinecap="round"
      />
      <circle
        cx={0}
        cy={0}
        r={2 * sizeScale}
        fill={fill}
        stroke={stroke}
        strokeWidth={0.9 / scale}
      />
      <circle
        cx={-Math.sin(rotation) * 5.2 * sizeScale}
        cy={-Math.cos(rotation) * 5.2 * sizeScale}
        r={0.95 * sizeScale}
        fill={stroke}
      />
    </g>
  );

  return (
    <div className="bg-black/65 border border-cyan-900/60 rounded-[999px] p-2 backdrop-blur shadow-[0_0_24px_rgba(34,211,238,0.16)]">
      <div className="text-cyan-300/80 text-[10px] font-bold tracking-[0.25em] mb-1 text-center">RADAR</div>
      <svg width={size} height={size} className="block">
        <defs>
          <clipPath id="radarClip">
            <circle cx={center} cy={center} r={radarRadius} />
          </clipPath>
        </defs>
        <circle cx={center} cy={center} r={radarRadius + 2} fill="rgba(255,255,255,0.03)" stroke="rgba(34,211,238,0.35)" strokeWidth={2} />
        <circle cx={center} cy={center} r={radarRadius} fill="rgba(2,8,23,0.92)" />
        <circle cx={center} cy={center} r={radarRadius - 2} fill="none" stroke="rgba(217,70,239,0.08)" strokeWidth={3} />
        <g clipPath="url(#radarClip)">
          <circle cx={center} cy={center} r={radarRadius * 0.72} fill="none" stroke="rgba(34,211,238,0.10)" />
          <circle cx={center} cy={center} r={radarRadius * 0.42} fill="none" stroke="rgba(34,211,238,0.10)" />
          <line x1={center} y1={6} x2={center} y2={size - 6} stroke="rgba(34,211,238,0.14)" />
          <line x1={6} y1={center} x2={size - 6} y2={center} stroke="rgba(34,211,238,0.14)" />
          <g transform={`translate(${center} ${center}) scale(${scale}) rotate(${rotationDegrees}) translate(${-me[0]} ${-me[2]})`}>
            <rect
              x={arenaMin}
              y={arenaMin}
              width={arenaSize}
              height={arenaSize}
              fill="none"
              stroke="rgba(125,211,252,0.18)"
              strokeWidth={1 / scale}
              strokeDasharray={`${3 / scale} ${3 / scale}`}
            />
            <line x1={arenaMin} y1={arenaMin} x2={arenaMax} y2={arenaMin} stroke="rgba(34,211,238,0.72)" strokeWidth={3 / scale} />
            <line x1={arenaMin} y1={arenaMax} x2={arenaMax} y2={arenaMax} stroke="rgba(217,70,239,0.72)" strokeWidth={3 / scale} />
            <line x1={arenaMin} y1={arenaMin} x2={arenaMin} y2={arenaMax} stroke="rgba(217,70,239,0.72)" strokeWidth={3 / scale} />
            <line x1={arenaMax} y1={arenaMin} x2={arenaMax} y2={arenaMax} stroke="rgba(34,211,238,0.72)" strokeWidth={3 / scale} />
            {visibleObstacles.map((obstacle, idx) => (
              <rect
                key={idx}
                x={obstacle.position[0] - obstacle.size[0] / 2}
                y={obstacle.position[2] - obstacle.size[2] / 2}
                width={obstacle.size[0]}
                height={obstacle.size[2]}
                rx={1.2}
                fill="rgba(15,23,42,0.92)"
                stroke="rgba(148,163,184,0.4)"
                strokeWidth={0.9 / scale}
              />
            ))}
            {visiblePlayers.map((player, idx) => {
              const fill = player.state === 'disabled' ? 'rgba(148,163,184,0.78)' : player.color;
              return (
                <g key={`${player.name}-${idx}`}>
                  {renderWorldMarker(player.pos[0], player.pos[2], player.rotation, fill, 'rgba(2,6,23,0.9)', 1)}
                </g>
              );
            })}
          </g>
          <line x1={center} y1={center} x2={center} y2={center - 12} stroke="#22d3ee" strokeWidth={2} strokeLinecap="round" />
          <circle cx={center} cy={center} r={5.2} fill="#ffffff" stroke="#22d3ee" strokeWidth={1.8} />
          <circle cx={center} cy={center - 12} r={2.2} fill="#22d3ee" stroke="#082f49" strokeWidth={1} />
        </g>
        <circle cx={center} cy={center} r={1.5} fill="rgba(34,211,238,0.95)" />
        <circle cx={northX} cy={northY} r={8} fill="rgba(8,47,73,0.9)" stroke="rgba(34,211,238,0.65)" strokeWidth={1.2} />
        <text x={northX} y={northY + 3} textAnchor="middle" className="fill-cyan-100" style={{ fontSize: 10, fontWeight: 700 }}>
          N
        </text>
        <text x={center} y={size - 8} textAnchor="middle" className="fill-cyan-200/70" style={{ fontSize: 9, letterSpacing: '0.18em' }}>
          LIVE MATCH
        </text>
      </svg>
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    const uaMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    return uaMatch || coarsePointer || window.innerWidth < 768;
  });

  useEffect(() => {
    const check = () => {
      const uaMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      setIsMobile(uaMatch || coarsePointer || window.innerWidth < 768);
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}

function AuthMenu() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const setAuth = useGameStore(state => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(isLogin ? '/api/login' : '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'An error occurred');
        return;
      }
      setAuth(data.token, data.user);
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-80 bg-black/50 p-6 rounded border border-cyan-900/50">
      <h2 className="text-2xl text-cyan-400 font-bold mb-2 text-center">{isLogin ? 'LOGIN' : 'REGISTER'}</h2>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      {!isLogin && (
        <input
          type="text"
          placeholder="Display Name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          className="px-4 py-2 bg-transparent border border-cyan-900 text-cyan-400 focus:outline-none focus:border-cyan-400"
        />
      )}
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        className="px-4 py-2 bg-transparent border border-cyan-900 text-cyan-400 focus:outline-none focus:border-cyan-400"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        className="px-4 py-2 bg-transparent border border-cyan-900 text-cyan-400 focus:outline-none focus:border-cyan-400"
      />
      <div className="text-cyan-400/60 text-xs">
        {isLogin ? 'Sign in to use your saved profile and stats.' : 'Create an account with at least an 8 character password.'}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-cyan-500/20 border border-cyan-400 text-cyan-400 font-bold hover:bg-cyan-400 hover:text-black transition-all disabled:opacity-60"
      >
        {submitting ? 'PLEASE WAIT...' : isLogin ? 'LOGIN' : 'REGISTER'}
      </button>
      <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-cyan-400/50 text-sm hover:text-cyan-400">
        {isLogin ? 'Need an account? Register' : 'Have an account? Login'}
      </button>
    </form>
  );
}

function ProfileCard() {
  const currentUser = useGameStore(state => state.currentUser);
  const logout = useGameStore(state => state.logout);
  const updateProfile = useGameStore(state => state.updateProfile);
  const enterLobbyPlatform = useGameStore(state => state.enterLobbyPlatform);
  const [displayName, setDisplayName] = useState(currentUser?.display_name ?? '');
  const [avatarColor, setAvatarColor] = useState(currentUser?.avatar_color ?? '#00ffff');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    setDisplayName(currentUser?.display_name ?? '');
    setAvatarColor(currentUser?.avatar_color ?? '#00ffff');
  }, [currentUser]);

  if (!currentUser) {
    return null;
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const result = await updateProfile({ displayName, bio: '', avatarColor });
    setSaving(false);
    setMessage(result.ok ? 'Profile updated.' : result.error || 'Failed to update profile.');
  };

  return (
    <div className="flex flex-col items-center gap-6 w-96 max-w-[90vw]">
      <form onSubmit={handleSave} className="bg-black/50 border border-cyan-900/50 p-5 rounded w-full">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20" style={{ backgroundColor: avatarColor }} />
          <div>
            <div className="text-cyan-400 text-xl font-bold">{currentUser.username}</div>
            <div className="text-cyan-400/60 text-sm">Member since {new Date(currentUser.created_at * 1000).toLocaleDateString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm mb-4">
          <div className="bg-black/40 p-2 rounded text-center text-cyan-400/80">Level<br />{currentUser.level}</div>
          <div className="bg-black/40 p-2 rounded text-center text-cyan-400/80">Score<br />{currentUser.total_score}</div>
          <div className="bg-black/40 p-2 rounded text-center text-cyan-400/80">Matches<br />{currentUser.matches_played}</div>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display Name"
            className="px-4 py-2 bg-transparent border border-cyan-900 text-cyan-400 focus:outline-none focus:border-cyan-400"
          />
          <label className="text-cyan-400/70 text-sm flex items-center justify-between gap-3">
            Profile Color
            <input
              type="color"
              value={avatarColor}
              onChange={(e) => setAvatarColor(e.target.value)}
              className="h-10 w-16 bg-transparent border border-cyan-900 rounded"
            />
          </label>
        </div>

        {message && <div className={`mt-3 text-sm ${message === 'Profile updated.' ? 'text-green-400' : 'text-red-400'}`}>{message}</div>}

        <div className="mt-4 flex gap-3">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-cyan-500/20 border border-cyan-400 text-cyan-400 font-bold hover:bg-cyan-400 hover:text-black transition-all disabled:opacity-60">
            {saving ? 'SAVING...' : 'SAVE PROFILE'}
          </button>
          <button type="button" onClick={() => void logout()} className="px-4 py-2 border border-red-500 text-red-400 hover:bg-red-500 hover:text-black transition-all">
            LOG OUT
          </button>
        </div>
      </form>

      <button
        onClick={async () => {
          setEntering(true);
          const result = await enterLobbyPlatform();
          setEntering(false);
          if (!result.ok) {
            setMessage(result.error || 'Failed to enter lobby platform');
          }
        }}
        className="w-full px-8 py-4 bg-fuchsia-500/20 border-2 border-fuchsia-400 text-fuchsia-400 text-xl font-bold rounded hover:bg-fuchsia-400 hover:text-black transition-all duration-200 shadow-[0_0_15px_rgba(232,121,249,0.5)] disabled:opacity-60"
        disabled={entering}
      >
        {entering ? 'CONNECTING...' : 'ENTER LOBBY'}
      </button>
    </div>
  );
}

export default function App() {
  const gameState = useGameStore(state => state.gameState);
  const score = useGameStore(state => state.score);
  const currentUser = useGameStore(state => state.currentUser);
  const currentLobby = useGameStore(state => state.currentLobby);
  const authLoading = useGameStore(state => state.authLoading);
  const loadSession = useGameStore(state => state.loadSession);
  const isMobile = useIsMobile();

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  return (
    <div className="w-screen h-screen bg-black relative overflow-hidden font-mono select-none">
      {/* 3D Canvas */}
      <div className="absolute inset-0">
        <Game />
      </div>

      {/* UI Overlay */}
      {gameState === 'playing' && <HUD />}

      {/* Menus */}
      {gameState === 'lobby' && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center z-10 pointer-events-auto overflow-y-auto py-8">
          <h1 className="text-5xl font-black text-cyan-400 mb-6 drop-shadow-[0_0_20px_rgba(34,211,238,0.8)] tracking-tighter">
            LOBBY PLATFORM
          </h1>
          {currentLobby ? <LobbyRoom /> : <LobbyBrowser />}
        </div>
      )}

      {gameState === 'menu' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10 pointer-events-auto">
          <h1 className="text-6xl font-black text-cyan-400 mb-8 drop-shadow-[0_0_20px_rgba(34,211,238,0.8)] tracking-tighter">
            NEON ARENA
          </h1>
          <p className="text-gray-400 mb-8 text-center max-w-md">
            WASD to move. Mouse to look and shoot.<br/>
            Hit enemies for points. Don't get hit!
          </p>

          {authLoading ? (
            <div className="text-cyan-400/80 text-lg">Loading profile...</div>
          ) : !currentUser ? (
            <AuthMenu />
          ) : (
            <ProfileCard />
          )}
        </div>
      )}

      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10 pointer-events-auto">
          <h1 className="text-6xl font-black text-red-500 mb-4 drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] tracking-tighter">
            MATCH OVER
          </h1>
          {currentLobby && (
            <div className="text-fuchsia-400 mb-2 text-lg">{currentLobby.name}</div>
          )}
          <div className="text-3xl text-cyan-400 mb-8 font-bold">
            FINAL SCORE: {score}
          </div>
          <button
            onClick={() => useGameStore.setState({ gameState: 'lobby' })}
            className="px-8 py-4 bg-cyan-500/20 border-2 border-cyan-400 text-cyan-400 text-xl font-bold rounded hover:bg-cyan-400 hover:text-black transition-all duration-200"
          >
            BACK TO LOBBY
          </button>
        </div>
      )}
    </div>
  );
}
