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
        const t = e.target as HTMLElement;
        const clickable = !!t.closest('a, button, [role="button"], input, select, textarea, label');
        const s = clickable ? 1.5 : 1;
        ringRef.current.style.transform = `translate(${x - 16}px, ${y - 16}px) scale(${s})`;
      }
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
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
        style={{ willChange: 'transform', transition: 'transform 0.12s ease' }}
      />
    </>
  );
}
