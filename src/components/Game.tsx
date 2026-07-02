/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Arena } from './Arena';
import { Player } from './Player';
import { Enemy } from './Enemy';
import { OtherPlayer } from './OtherPlayer';
import { Effects } from './Effects';
import { useGameStore } from '../store';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect } from 'react';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
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

function GameLoop() {
  const updateTime = useGameStore(state => state.updateTime);
  const updateEnemies = useGameStore(state => state.updateEnemies);
  const cleanupEffects = useGameStore(state => state.cleanupEffects);

  useFrame((_, delta) => {
    const now = Date.now();
    updateTime(delta);
    updateEnemies(now);
    cleanupEffects(now);
  });
  return null;
}

export function Game() {
  const enemies = useGameStore(state => state.enemies);
  const otherPlayerIds = useGameStore(
    useShallow(state => Object.keys(state.otherPlayers))
  );
  const isMobile = useIsMobile();

  return (
    <Canvas 
      shadows={!isMobile} 
      camera={{ fov: 75 }}
      dpr={isMobile ? [1, 1.5] : [1, 2]} // Lower DPR for mobile performance
    >
      <color attach="background" args={['#050510']} />
      <fogExp2 attach="fog" args={['#050510', isMobile ? 0.04 : 0.025]} />
      
      <ambientLight intensity={isMobile ? 0.8 : 0.5} />
      <pointLight position={[0, 8, 0]} intensity={1.5} castShadow={!isMobile} distance={60} />
      
      {!isMobile && (
        <>
          <pointLight position={[25, 8, 25]} intensity={1.2} castShadow distance={60} />
          <pointLight position={[-25, 8, -25]} intensity={1.2} castShadow distance={60} />
          <pointLight position={[25, 8, -25]} intensity={1.2} castShadow distance={60} />
          <pointLight position={[-25, 8, 25]} intensity={1.2} castShadow distance={60} />
        </>
      )}
      
      <Physics gravity={[0, -20, 0]}>
        <GameLoop />
        <Arena />
        <Player />
        {enemies.map(enemy => (
          <Enemy key={enemy.id} data={enemy} />
        ))}
        {otherPlayerIds.map(id => (
          <OtherPlayer key={id} id={id} />
        ))}
        <Effects />
      </Physics>

      {/* Bloom can be heavy on mobile, disable or simplify */}
      {!isMobile && (
        <EffectComposer>
          <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
