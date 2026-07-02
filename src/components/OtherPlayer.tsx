/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, CapsuleCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { useGameStore } from '../store';
import { Text } from '@react-three/drei';

export function OtherPlayer({ id }: { id: string }) {
  const data = useGameStore(state => state.otherPlayers[id]);
  const body = useRef<RapierRigidBody>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!body.current || !data) return;
    
    // Smoothly interpolate position
    const currentPos = body.current.translation();
    const targetPos = new THREE.Vector3(...data.position);
    
    // Frame-rate independent lerp
    const lerpFactor = 1.0 - Math.exp(-20 * delta);
    const newPos = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z).lerp(targetPos, lerpFactor);
    
    body.current.setNextKinematicTranslation({ x: newPos.x, y: newPos.y, z: newPos.z });

    // Smoothly interpolate rotation
    if (groupRef.current) {
      // Handle angle wrap-around
      let diff = data.rotation - groupRef.current.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      groupRef.current.rotation.y += diff * lerpFactor;
    }
  });

  if (!data) return null;

  const color = data.state === 'disabled' ? '#444' : data.color;

  return (
    <RigidBody
      ref={body}
      colliders={false}
      type="kinematicPosition"
      position={data.position}
      enabledRotations={[false, false, false]}
      userData={{ name: data.id }}
    >
      <CapsuleCollider args={[0.5, 0.5]} position={[0, 1, 0]} />
      <group ref={groupRef} position={[0, 0, 0]}>
        {/* Body */}
        <mesh castShadow position={[0, 1, 0]}>
          <capsuleGeometry args={[0.5, 1]} />
          <meshStandardMaterial 
            color={color} 
            roughness={0.3} 
            metalness={0.8} 
            emissive={color}
            emissiveIntensity={data.state === 'disabled' ? 0 : 0.4}
          />
        </mesh>
        
        {/* Eye/Visor */}
        <mesh position={[0, 1.6, 0.45]}>
          <boxGeometry args={[0.6, 0.2, 0.2]} />
          <meshBasicMaterial color={data.state === 'disabled' ? '#111' : '#ffffff'} />
        </mesh>

        {/* Username Label */}
        <Text
          position={[0, 2.5, 0]}
          fontSize={0.3}
          color={data.state === 'active' ? data.color : '#666666'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {data.name}
        </Text>
      </group>
    </RigidBody>
  );
}
