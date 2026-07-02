/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, useState, useMemo } from 'react';
import { Game } from './components/Game';
import { MobileControls } from './components/MobileControls';
import { useGameStore } from './store';

function HUD() {
  const gameState = useGameStore(state => state.gameState);
  const score = useGameStore(state => state.score);
  const timeLeft = useGameStore(state => state.timeLeft);
  const playerState = useGameStore(state => state.playerState);
  const otherPlayers = useGameStore(state => state.otherPlayers);
  const events = useGameStore(state => state.events);
  const playerCount = Object.keys(otherPlayers).length + 1;
  const leaveGame = useGameStore(state => state.leaveGame);
  const isMobile = useIsMobile();

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
        {!isMobile && <div className="text-cyan-400/50 text-xs mt-1 pointer-events-none uppercase tracking-widest font-bold">ESC to unlock cursor</div>}

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

export default function App() {
  const gameState = useGameStore(state => state.gameState);
  const score = useGameStore(state => state.score);
  const startGame = useGameStore(state => state.startGame);
  const isMobile = useIsMobile();

  return (
    <div className="w-screen h-screen bg-black relative overflow-hidden font-mono select-none">
      {/* 3D Canvas */}
      <div className="absolute inset-0">
        <Game />
      </div>

      {/* UI Overlay */}
      {gameState === 'playing' && <HUD />}

      {/* Menus */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10 pointer-events-auto">
          <h1 className="text-6xl font-black text-cyan-400 mb-8 drop-shadow-[0_0_20px_rgba(34,211,238,0.8)] tracking-tighter">
            NEON ARENA
          </h1>
          <p className="text-gray-400 mb-8 text-center max-w-md">
            WASD to move. Mouse to look and shoot.<br/>
            Hit enemies for points. Don't get hit!
          </p>

          <div className="flex flex-col gap-6 w-80">
            <button
              onClick={() => startGame()}
              className="w-full px-8 py-4 bg-fuchsia-500/20 border-2 border-fuchsia-400 text-fuchsia-400 text-xl font-bold rounded hover:bg-fuchsia-400 hover:text-black transition-all duration-200 shadow-[0_0_15px_rgba(232,121,249,0.5)]"
            >
              PLAY NOW
            </button>
          </div>
        </div>
      )}

      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10 pointer-events-auto">
          <h1 className="text-6xl font-black text-red-500 mb-4 drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] tracking-tighter">
            GAME OVER
          </h1>
          <div className="text-3xl text-cyan-400 mb-8 font-bold">
            FINAL SCORE: {score}
          </div>
          <button
            id="start-button"
            onClick={() => startGame()}
            className="px-8 py-4 bg-cyan-500/20 border-2 border-cyan-400 text-cyan-400 text-xl font-bold rounded hover:bg-cyan-400 hover:text-black transition-all duration-200"
          >
            PLAY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}
