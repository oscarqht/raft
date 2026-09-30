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
  rightCollapsed?: boolean;
}

export const DraggableSplit: React.FC<DraggableSplitProps> = ({
  left,
  right,
  initialRatio = 0.5,
  minLeftWidth = 320,
  minRightWidth = 320,
  storageKey = 'raft:split-ratio',
  mobileActivePane = 'left',
  mobileBreakpoint = 1200,
  rightCollapsed = false,
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
    if (!isDragging) return;

    const handlePointerMove = (e: MouseEvent | PointerEvent) => {
      updateRatio(e.clientX);
    };

    const handlePointerUp = () => {
      stopDragging();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isDragging, updateRatio, stopDragging]);

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
    <div ref={containerRef} className={`flex-1 flex overflow-hidden relative w-full h-full ${isDragging ? 'select-none' : ''}`}>
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
          width: isMobile
            ? mobileActivePane === 'left' ? '100%' : '0px'
            : rightCollapsed ? '100%' : `calc(${ratio * 100}% - 0.5px)`,
          display: isMobile && mobileActivePane !== 'left' ? 'none' : 'flex',
          pointerEvents: isDragging ? 'none' : 'auto',
        }}
        className="h-full flex flex-col min-w-0 overflow-hidden relative rounded-none border-0 shadow-none bg-cozy-surface"
      >
        {left}
      </div>

      {/* Draggable Divider with Hairline 1px border */}
      {!isMobile && !rightCollapsed && (
        <div
          onPointerDown={handlePointerDown}
          className={`relative w-[1px] h-full cursor-col-resize transition-colors shrink-0 z-20 select-none group touch-none ${
            isDragging ? 'bg-teal-500' : 'bg-cozy-border hover:bg-teal-500/80'
          }`}
          title="Drag to resize panels"
        >
          {/* Invisible wider hit area for easier grabbing */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-10 cursor-col-resize" />
        </div>
      )}

      {/* Right Pane */}
      <div
        style={{
          width: isMobile
            ? mobileActivePane === 'right' ? '100%' : '0px'
            : rightCollapsed ? '0px' : `calc(${(1 - ratio) * 100}% - 0.5px)`,
          display:
            (isMobile && mobileActivePane !== 'right') || (!isMobile && rightCollapsed)
              ? 'none'
              : 'flex',
          pointerEvents: isDragging ? 'none' : 'auto',
        }}
        className="h-full flex flex-col min-w-0 overflow-hidden relative rounded-none border-0 shadow-none bg-cozy-surface"
      >
        {right}
      </div>
    </div>
  );
};
