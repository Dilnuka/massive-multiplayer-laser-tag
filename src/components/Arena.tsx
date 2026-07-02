/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { RigidBody } from '@react-three/rapier';
import { Grid, Stars } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';

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

// Seeded PRNG for consistent multiplayer obstacle generation
function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
const rng = mulberry32(12345);

const OBSTACLES = Array.from({ length: 150 }).map(() => {
  const type = 'box';
  const x = (rng() - 0.5) * 170; // Avoid edges
  const z = (rng() - 0.5) * 170;
  
  // Keep center somewhat clear
  if (Math.abs(x) < 20 && Math.abs(z) < 20) return null;

  const height = rng() * 8 + 6;
  const isHorizontal = rng() > 0.5;
  const width = isHorizontal ? rng() * 25 + 10 : rng() * 3 + 1;
  const depth = isHorizontal ? rng() * 3 + 1 : rng() * 25 + 10;
  const rotation = 0; // Axis aligned for maze feel
  const color = rng() > 0.5 ? "#00ffff" : "#ff00ff";

  return { type, position: [x, height / 2 - 0.5, z], size: [width, height, depth], rotation: [0, rotation, 0], color };
}).filter(Boolean);

export function Arena() {
  const isMobile = useIsMobile();
  
  const obstacles = useMemo(() => {
    const count = isMobile ? 60 : 150;
    const rngLocal = mulberry32(12345);
    return Array.from({ length: count }).map(() => {
      const type = 'box';
      const x = (rngLocal() - 0.5) * 170;
      const z = (rngLocal() - 0.5) * 170;
      
      if (Math.abs(x) < 20 && Math.abs(z) < 20) return null;

      const height = rngLocal() * 8 + 6;
      const isHorizontal = rngLocal() > 0.5;
      const width = isHorizontal ? rngLocal() * 25 + 10 : rngLocal() * 3 + 1;
      const depth = isHorizontal ? rngLocal() * 3 + 1 : rngLocal() * 25 + 10;
      const color = rngLocal() > 0.5 ? "#00ffff" : "#ff00ff";

      return { type, position: [x, height / 2 - 0.5, z], size: [width, height, depth], rotation: [0, 0, 0], color };
    }).filter(Boolean);
  }, [isMobile]);

  return (
    <group>
      {/* Floor */}
      <RigidBody type="fixed" name="floor" friction={0}>
        <mesh receiveShadow={!isMobile} position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#050510" roughness={0.2} metalness={0.8} />
        </mesh>
      </RigidBody>
      <Grid position={[0, -0.49, 0]} args={[200, 200]} cellColor="#ff00ff" sectionColor="#00ffff" fadeDistance={100} cellThickness={0.5} sectionThickness={1.5} />

      {/* Ceiling */}
      <RigidBody type="fixed" name="ceiling">
        <mesh receiveShadow={!isMobile} position={[0, 20, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#000000" roughness={1} />
        </mesh>
      </RigidBody>

      {/* Atmosphere */}
      {!isMobile && (
        <>
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={1} fade speed={1} />
          <AmbientParticles />
        </>
      )}

      {/* Walls */}
      <Wall name="wall-n" position={[0, 5, -100]} rotation={[0, 0, 0]} isMobile={isMobile} />
      <Wall name="wall-s" position={[0, 5, 100]} rotation={[0, Math.PI, 0]} isMobile={isMobile} />
      <Wall name="wall-e" position={[100, 5, 0]} rotation={[0, -Math.PI / 2, 0]} isMobile={isMobile} />
      <Wall name="wall-w" position={[-100, 5, 0]} rotation={[0, Math.PI / 2, 0]} isMobile={isMobile} />

      {/* Obstacles */}
      {obstacles.map((obs, i) => {
        if (!obs) return null;
        return (
          <RigidBody 
            key={i} 
            type="fixed" 
            colliders="hull"
            name={`obstacle-${i}`}
            position={obs.position as [number, number, number]}
            rotation={obs.rotation as [number, number, number]}
          >
            <mesh receiveShadow={!isMobile} castShadow={!isMobile}>
              {obs.type === 'box' ? (
                <boxGeometry args={obs.size as [number, number, number]} />
              ) : (
                <cylinderGeometry args={[obs.size[0]/2, obs.size[0]/2, obs.size[1], 16]} />
              )}
              <meshStandardMaterial color="#1a1a2e" roughness={0.6} metalness={0.5} />
              
              {/* Neon accent on obstacles */}
              <mesh position={[0, obs.size[1]/2 - 0.5, 0]}>
                {obs.type === 'box' ? (
                  <boxGeometry args={[obs.size[0] + 0.1, 0.2, obs.size[2] + 0.1]} />
                ) : (
                  <cylinderGeometry args={[obs.size[0]/2 + 0.1, obs.size[0]/2 + 0.1, 0.2, 16]} />
                )}
                <meshBasicMaterial color={obs.color} toneMapped={false} />
              </mesh>
            </mesh>
          </RigidBody>
        );
      })}
    </group>
  );
}

function Wall({ name, position, rotation, isMobile }: { name: string, position: [number, number, number], rotation: [number, number, number], isMobile: boolean }) {
  return (
    <RigidBody type="fixed" name={name} position={position} rotation={rotation}>
      {/* Solid Wall */}
      <mesh>
        <boxGeometry args={[200, 10, 1]} />
        <meshStandardMaterial color="#0a0a1a" roughness={0.8} metalness={0.2} />
      </mesh>
      {/* Glowing Base Line */}
      <mesh position={[0, -4.5, 0.51]}>
        <planeGeometry args={[200, 1]} />
        <meshBasicMaterial color="#ff00ff" toneMapped={false} />
      </mesh>
      {/* Glowing Top Line */}
      <mesh position={[0, 4.5, 0.51]}>
        <planeGeometry args={[200, 1]} />
        <meshBasicMaterial color="#00ffff" toneMapped={false} />
      </mesh>
    </RigidBody>
  );
}

function AmbientParticles() {
  const count = 1500;
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const [positions, sizes] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      sizes[i] = Math.random() * 0.8 + 0.4; // Smaller particles
    }
    return [positions, sizes];
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#ffffff') } // White color
  }), []);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-aSize"
          count={count}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          attribute float aSize;
          varying float vAlpha;
          void main() {
            vec3 pos = position;
            // Slow upward drift and wobble
            pos.y += uTime * 0.5;
            pos.x += sin(uTime * 0.2 + pos.y) * 2.0;
            pos.z += cos(uTime * 0.2 + pos.y) * 2.0;
            
            // Wrap around Y
            pos.y = mod(pos.y, 40.0);
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            
            // Size attenuation
            gl_PointSize = aSize * (300.0 / -mvPosition.z);
            
            // Fade out near top and bottom
            vAlpha = smoothstep(0.0, 5.0, pos.y) * smoothstep(40.0, 35.0, pos.y);
          }
        `}
        fragmentShader={`
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            // Distance from center of point
            float d = length(gl_PointCoord - vec2(0.5));
            // Soft circle using smoothstep
            float alpha = smoothstep(0.5, 0.1, d) * 0.5 * vAlpha;
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(uColor, alpha);
          }
        `}
      />
    </points>
  );
}
