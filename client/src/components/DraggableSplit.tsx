import React, { useState, useRef, useEffect, ReactNode } from 'react';

interface DraggableSplitProps {
  left: ReactNode;
  right: ReactNode;
  initialRatio?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
  storageKey?: string;
}

export const DraggableSplit: React.FC<DraggableSplitProps> = ({
  left,
  right,
  initialRatio = 0.5,
  minLeftWidth = 320,
  minRightWidth = 320,
  storageKey = 'termai:split-ratio',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? parseFloat(saved) : initialRatio;
    } catch {
      return initialRatio;
    }
  });

  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const totalWidth = rect.width;

      const clampedX = Math.max(minLeftWidth, Math.min(totalWidth - minRightWidth, currentX));
      const newRatio = clampedX / totalWidth;
      setRatio(newRatio);
      try {
        localStorage.setItem(storageKey, newRatio.toString());
      } catch {}
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minLeftWidth, minRightWidth, storageKey]);

  const startDragging = () => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden relative w-full h-full">
      {/* Left Pane */}
      <div
        style={{ width: `calc(${ratio * 100}% - 3px)` }}
        className="h-full flex flex-col min-w-0 overflow-hidden"
      >
        {left}
      </div>

      {/* Draggable Divider */}
      <div
        onMouseDown={startDragging}
        className="w-[6px] h-full cursor-col-resize hover:bg-sky-500/40 active:bg-sky-500 transition-colors flex items-center justify-center shrink-0 z-10 select-none group"
        title="Drag to resize panels"
      >
        <div className="w-[2px] h-8 rounded-full bg-cozy-border group-hover:bg-sky-400 group-hover:h-12 transition-all"></div>
      </div>

      {/* Right Pane */}
      <div
        style={{ width: `calc(${(1 - ratio) * 100}% - 3px)` }}
        className="h-full flex flex-col min-w-0 overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
};
