import React, { useEffect, useRef } from 'react';

export default function CustomCursor() {
  const dotRef  = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rx = -100, ry = -100;
    let dx = -100, dy = -100;
    let raf: number;

    const onMove = (e: MouseEvent) => {
      rx = e.clientX;
      ry = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${rx - 4}px, ${ry - 4}px)`;
      }
    };

    const loop = () => {
      dx += (rx - dx) * 0.12;
      dy += (ry - dy) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${dx - 16}px, ${dy - 16}px)`;
      }
      raf = requestAnimationFrame(loop);
    };

    const onEnter = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const clickable = t.closest('a, button, [role="button"], input, select, textarea, label');
      if (dotRef.current)  dotRef.current.classList.toggle('scale-150', !!clickable);
      if (ringRef.current) ringRef.current.classList.toggle('scale-150', !!clickable);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseover', onEnter);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onEnter);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      {/* Dot */}
      <div
        ref={dotRef}
        className="pointer-events-none fixed top-0 left-0 z-[9999] w-2 h-2 rounded-full bg-[#f5a623] transition-transform duration-75"
        style={{ willChange: 'transform' }}
      />
      {/* Ring */}
      <div
        ref={ringRef}
        className="pointer-events-none fixed top-0 left-0 z-[9998] w-8 h-8 rounded-full border border-[#f5a623]/50 transition-transform duration-150"
        style={{ willChange: 'transform' }}
      />
    </>
  );
}
