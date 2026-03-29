import React, { useEffect, useRef } from 'react';

export default function CustomCursor() {
  const dotRef  = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${x - 4}px, ${y - 4}px)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${x - 16}px, ${y - 16}px)`;
      }
    };

    const onEnter = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const clickable = t.closest('a, button, [role="button"], input, select, textarea, label');
      if (ringRef.current) {
        ringRef.current.style.transform = ringRef.current.style.transform.replace(/scale\([^)]+\)/, '');
        ringRef.current.style.scale = clickable ? '1.6' : '1';
      }
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseover', onEnter, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onEnter);
    };
  }, []);

  return (
    <>
      <div
        ref={dotRef}
        className="pointer-events-none fixed top-0 left-0 z-[9999] w-2 h-2 rounded-full bg-[#f5a623]"
        style={{ willChange: 'transform' }}
      />
      <div
        ref={ringRef}
        className="pointer-events-none fixed top-0 left-0 z-[9998] w-8 h-8 rounded-full border border-[#f5a623]/50"
        style={{ willChange: 'transform', transition: 'scale 0.15s ease' }}
      />
    </>
  );
}
