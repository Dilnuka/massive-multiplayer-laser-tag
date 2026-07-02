/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useState } from 'react';
import { useGameStore } from '../store';

export function LobbyBrowser() {
  const lobbies = useGameStore(state => state.lobbies);
  const currentUser = useGameStore(state => state.currentUser);
  const createLobby = useGameStore(state => state.createLobby);
  const joinLobby = useGameStore(state => state.joinLobby);
  const leaveLobbyPlatform = useGameStore(state => state.leaveLobbyPlatform);
  const [lobbyName, setLobbyName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const waitingLobbies = lobbies.filter(l => l.status === 'waiting');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    const result = await createLobby(lobbyName, maxPlayers);
    setCreating(false);
    if (!result.ok) {
      setError(result.error || 'Failed to create lobby');
    }
  };

  return (
    <div className="w-full max-w-4xl px-4 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl text-cyan-400 font-bold">LIVE LOBBIES</h2>
          <p className="text-cyan-400/60 text-sm">Welcome, {currentUser?.display_name}</p>
        </div>
        <button
          onClick={() => void leaveLobbyPlatform()}
          className="px-4 py-2 border border-cyan-900 text-cyan-400/70 hover:text-cyan-400 hover:border-cyan-400 transition-all text-sm"
        >
          BACK TO PROFILE
        </button>
      </div>

      <form onSubmit={handleCreate} className="bg-black/50 border border-cyan-900/50 p-5 rounded flex flex-col md:flex-row gap-3">
        <input
          type="text"
          placeholder="Lobby name"
          value={lobbyName}
          onChange={(e) => setLobbyName(e.target.value)}
          className="flex-1 px-4 py-2 bg-transparent border border-cyan-900 text-cyan-400 focus:outline-none focus:border-cyan-400"
        />
        <select
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
          className="px-4 py-2 bg-black border border-cyan-900 text-cyan-400 focus:outline-none focus:border-cyan-400"
        >
          {[4, 6, 8, 10, 12, 16].map(n => (
            <option key={n} value={n}>{n} players</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={creating}
          className="px-6 py-2 bg-fuchsia-500/20 border border-fuchsia-400 text-fuchsia-400 font-bold hover:bg-fuchsia-400 hover:text-black transition-all disabled:opacity-60"
        >
          {creating ? 'CREATING...' : 'CREATE LOBBY'}
        </button>
      </form>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="bg-black/50 border border-cyan-900/50 rounded overflow-hidden">
        <div className="grid grid-cols-5 gap-2 px-4 py-3 border-b border-cyan-900/50 text-cyan-400/60 text-xs font-bold uppercase">
          <span className="col-span-2">Lobby</span>
          <span>Host</span>
          <span>Players</span>
          <span className="text-right">Action</span>
        </div>

        {waitingLobbies.length === 0 ? (
          <div className="px-4 py-10 text-center text-cyan-400/50">
            No open lobbies yet. Create one to get started.
          </div>
        ) : (
          waitingLobbies.map(lobby => (
            <div
              key={lobby.id}
              className="grid grid-cols-5 gap-2 px-4 py-3 border-b border-cyan-900/30 items-center hover:bg-cyan-950/20"
            >
              <span className="col-span-2 text-cyan-400 font-bold truncate">{lobby.name}</span>
              <span className="text-cyan-400/70 text-sm truncate">{lobby.hostName}</span>
              <span className="text-cyan-400/70 text-sm">{lobby.playerCount}/{lobby.maxPlayers}</span>
              <div className="text-right">
                <button
                  onClick={() => void joinLobby(lobby.id)}
                  disabled={lobby.playerCount >= lobby.maxPlayers}
                  className="px-3 py-1 text-xs border border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-cyan-400"
                >
                  JOIN
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LobbyRoom() {
  const currentLobby = useGameStore(state => state.currentLobby);
  const isLobbyHost = useGameStore(state => state.isLobbyHost);
  const leaveLobby = useGameStore(state => state.leaveLobby);
  const startLobby = useGameStore(state => state.startLobby);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  if (!currentLobby) return null;

  const handleStart = async () => {
    setError('');
    setStarting(true);
    const result = await startLobby();
    setStarting(false);
    if (!result.ok) {
      setError(result.error || 'Failed to start game');
    }
  };

  return (
    <div className="w-full max-w-lg px-4 flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-3xl text-fuchsia-400 font-bold">{currentLobby.name}</h2>
        <p className="text-cyan-400/60 text-sm mt-1">
          {currentLobby.status === 'waiting' ? 'Waiting for host to start' : 'Match in progress'}
        </p>
      </div>

      <div className="bg-black/50 border border-cyan-900/50 rounded p-5">
        <div className="text-cyan-400/70 text-xs font-bold uppercase mb-3 border-b border-cyan-900/50 pb-2">
          Players ({currentLobby.members.length}/{currentLobby.maxPlayers})
        </div>
        <div className="flex flex-col gap-2">
          {currentLobby.members.map(member => (
            <div key={member.socketId} className="flex items-center gap-3 px-3 py-2 bg-black/40 rounded">
              <div className="w-8 h-8 rounded-full border border-white/20" style={{ backgroundColor: member.color }} />
              <div className="flex-1">
                <div className="text-cyan-400 font-bold text-sm">{member.name}</div>
                <div className="text-cyan-400/50 text-xs">@{member.username}</div>
              </div>
              {member.isHost && (
                <span className="text-fuchsia-400 text-xs font-bold border border-fuchsia-400/50 px-2 py-0.5 rounded">
                  HOST
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <div className="text-red-400 text-sm text-center">{error}</div>}

      <div className="flex flex-col gap-3">
        {isLobbyHost && currentLobby.status === 'waiting' && (
          <button
            onClick={() => void handleStart()}
            disabled={starting || currentLobby.members.length < 1}
            className="w-full px-8 py-4 bg-fuchsia-500/20 border-2 border-fuchsia-400 text-fuchsia-400 text-xl font-bold rounded hover:bg-fuchsia-400 hover:text-black transition-all disabled:opacity-60"
          >
            {starting ? 'STARTING...' : 'START GAME'}
          </button>
        )}
        <button
          onClick={() => void leaveLobby()}
          className="w-full px-4 py-2 border border-red-500 text-red-400 hover:bg-red-500 hover:text-black transition-all"
        >
          LEAVE LOBBY
        </button>
      </div>
    </div>
  );
}
