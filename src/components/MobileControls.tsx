/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';

interface JoystickProps {
  onMove: (x: number, y: number) => void;
  className?: string;
  label?: string;
}

function Joystick({ onMove, className, label }: JoystickProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    origin.current = { x: centerX, y: centerY };
    isDragging.current = true;
    containerRef.current.setPointerCapture(e.pointerId);
    
    // Process initial touch immediately
    handlePointerMove(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;

    const maxDist = 30; // Reduced from 40 for smaller joystick
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let x = dx;
    let y = dy;

    if (dist > maxDist) {
      const angle = Math.atan2(dy, dx);
      x = Math.cos(angle) * maxDist;
      y = Math.sin(angle) * maxDist;
    }

    setPosition({ x, y });
    
    // Normalize output -1 to 1
    // Invert Y because screen Y is down, but usually joystick up is -1 or 1 depending on convention.
    // In 3D: Forward is -Z.
    // Screen Up (negative Y) -> Forward (-Z).
    // Screen Down (positive Y) -> Backward (+Z).
    // So we can pass raw normalized values and handle mapping in Player.tsx.
    onMove(x / maxDist, y / maxDist);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    setPosition({ x: 0, y: 0 });
    onMove(0, 0);
    if (containerRef.current) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`relative w-24 h-24 bg-white/10 rounded-full flex items-center justify-center touch-none select-none backdrop-blur-sm ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ touchAction: 'none' }}
    >
      {/* Base */}
      <div className="absolute w-full h-full rounded-full border-2 border-white/20" />
      
      {/* Stick */}
      <div 
        className="absolute w-8 h-8 bg-cyan-400/50 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.5)]"
        style={{ 
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
      />
      
      {label && (
        <div className="absolute -bottom-6 text-white/50 text-[10px] font-bold uppercase tracking-widest pointer-events-none">
          {label}
        </div>
      )}
    </div>
  );
}

export function MobileControls() {
  const setMobileInput = useGameStore(state => state.setMobileInput);
  const [shooting, setShooting] = useState(false);

  useEffect(() => {
    setMobileInput({ shooting });
  }, [shooting, setMobileInput]);

  return (
    <div className="absolute inset-0 pointer-events-none z-50 flex flex-col justify-end pb-12 px-4 select-none">
      <div className="flex justify-between items-end w-full pointer-events-auto gap-2">
        {/* Left Stick - Move */}
        <Joystick 
          label="Move"
          onMove={(x, y) => setMobileInput({ move: { x, y } })} 
        />

        {/* Shoot Button */}
        <button
          className={`w-20 h-20 rounded-full border-4 border-fuchsia-500 flex items-center justify-center mb-2 active:scale-95 transition-all touch-none ${shooting ? 'bg-fuchsia-500/50 scale-95' : 'bg-fuchsia-500/20'}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setShooting(true);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setShooting(false);
          }}
          onPointerCancel={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setShooting(false);
          }}
          style={{ touchAction: 'none' }}
        >
          <div className="w-12 h-12 bg-fuchsia-500 rounded-full shadow-[0_0_15px_rgba(232,121,249,0.8)]" />
        </button>

        {/* Right Stick - Look */}
        <Joystick 
          label="Look"
          onMove={(x, y) => setMobileInput({ look: { x, y } })} 
        />
      </div>
    </div>
  );
}
