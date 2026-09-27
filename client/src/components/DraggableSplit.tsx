import React, { useState, useRef, useEffect, ReactNode, useCallback } from 'react';

interface DraggableSplitProps {
  left: ReactNode;
  right: ReactNode;
  initialRatio?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
  storageKey?: string;
  mobileActivePane?: 'left' | 'right';
  mobileBreakpoint?: number;
}

export const DraggableSplit: React.FC<DraggableSplitProps> = ({
  left,
  right,
  initialRatio = 0.5,
  minLeftWidth = 320,
  minRightWidth = 320,
  storageKey = 'raft:split-ratio',
  mobileActivePane = 'left',
  mobileBreakpoint = 920,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < mobileBreakpoint);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileBreakpoint]);
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey) || (storageKey === 'raft:split-ratio' ? localStorage.getItem('termai:split-ratio') : null);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
          return parsed;
        }
      }
    } catch {}
    return initialRatio;
  });

  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const rafIdRef = useRef<number | null>(null);

  const updateRatio = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      if (totalWidth <= 0) return;

      const maxLeftWidth = Math.max(minLeftWidth, totalWidth - minRightWidth);
      const currentX = clientX - rect.left;
      const clampedX = Math.max(minLeftWidth, Math.min(maxLeftWidth, currentX));
      const newRatio = clampedX / totalWidth;

      ratioRef.current = newRatio;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          setRatio(ratioRef.current);
          rafIdRef.current = null;
        });
      }
    },
    [minLeftWidth, minRightWidth]
  );

  const stopDragging = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setRatio(ratioRef.current);

    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    try {
      localStorage.setItem(storageKey, ratioRef.current.toString());
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    const handlePointerMove = (e: MouseEvent | PointerEvent) => {
      if (!isDraggingRef.current) return;
      updateRatio(e.clientX);
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        stopDragging();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [updateRatio, stopDragging]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only primary button
    e.preventDefault();

    isDraggingRef.current = true;
    setIsDragging(true);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden relative w-full h-full select-none">
      {/* Full-screen invisible overlay during dragging to prevent iframe from capturing pointer events */}
      {!isMobile && isDragging && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto"
          onPointerMove={(e) => updateRatio(e.clientX)}
          onPointerUp={stopDragging}
        />
      )}

      {/* Left Pane */}
      <div
        style={{
          width: isMobile ? (mobileActivePane === 'left' ? '100%' : '0px') : `calc(${ratio * 100}% - 7px)`,
          display: isMobile && mobileActivePane !== 'left' ? 'none' : 'flex',
          pointerEvents: isDragging ? 'none' : 'auto',
        }}
        className={`h-full flex flex-col min-w-0 overflow-hidden relative ${
          isMobile
            ? 'rounded-none border-0 shadow-none bg-cozy-surface/60'
            : 'rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-md transition-shadow hover:shadow-soft-lg'
        }`}
      >
        {left}
      </div>

      {/* Draggable Divider with Airy Gutter */}
      {!isMobile && (
        <div
          onPointerDown={handlePointerDown}
          className={`relative w-3 h-full cursor-col-resize transition-all flex items-center justify-center shrink-0 z-20 select-none group touch-none mx-0.5 rounded-full ${
            isDragging ? 'bg-teal-500/10' : 'hover:bg-teal-500/5'
          }`}
          title="Drag to resize panels"
        >
          {/* Invisible wider hit area for easier grabbing */}
          <div className="absolute inset-y-0 -left-2 -right-2 z-10 cursor-col-resize" />

          <div
            className={`w-1 rounded-full transition-all z-20 ${
              isDragging
                ? 'bg-teal-400 h-16 shadow-glow-ocean'
                : 'h-8 bg-cozy-border/80 group-hover:bg-teal-400 group-hover:h-12'
            }`}
          />
        </div>
      )}

      {/* Right Pane */}
      <div
        style={{
          width: isMobile ? (mobileActivePane === 'right' ? '100%' : '0px') : `calc(${(1 - ratio) * 100}% - 7px)`,
          display: isMobile && mobileActivePane !== 'right' ? 'none' : 'flex',
          pointerEvents: isDragging ? 'none' : 'auto',
        }}
        className={`h-full flex flex-col min-w-0 overflow-hidden relative ${
          isMobile
            ? 'rounded-none border-0 shadow-none bg-cozy-surface/60'
            : 'rounded-squircle glass-panel border border-white/80 dark:border-white/10 shadow-soft-md transition-shadow hover:shadow-soft-lg'
        }`}
      >
        {right}
      </div>
    </div>
  );
};
