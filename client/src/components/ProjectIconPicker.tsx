import React, { useRef, useEffect } from 'react';
import { PROJECT_ICONS, getProjectIcon } from '../utils/projectIcons';
import { ProjectIcon } from './ProjectIcon';

export interface ProjectIconPickerProps {
  selectedIcon?: string | null;
  onSelectIcon: (iconId: string) => void;
  onClose: () => void;
  className?: string;
}

export const ProjectIconPicker: React.FC<ProjectIconPickerProps> = ({
  selectedIcon,
  onSelectIcon,
  onClose,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentDef = getProjectIcon(selectedIcon);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className={`z-50 w-[290px] rounded-2xl glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl bg-cozy-card/95 dark:bg-cozy-surface/95 backdrop-blur-xl p-3 flex flex-col text-cozy-text animate-in fade-in zoom-in-95 duration-150 ${className}`}
    >
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-cozy-border/60 select-none">
        <span className="text-xs font-semibold text-cozy-text">Choose Icon</span>
        <span className="text-[11px] text-cozy-muted font-mono">{currentDef.name}</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5 p-1 max-h-[300px] overflow-y-auto outline-none scrollbar-thin">
        {PROJECT_ICONS.map((item) => {
          const isSelected = item.id === currentDef.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectIcon(item.id);
                onClose();
              }}
              className={`w-11 h-11 rounded-xl p-1.5 flex items-center justify-center transition-all duration-150 cursor-pointer select-none group relative ${
                isSelected
                  ? 'bg-teal-500/20 ring-2 ring-teal-500 ring-offset-1 ring-offset-cozy-surface scale-105 shadow-sm'
                  : 'hover:bg-cozy-subtle hover:scale-108 active:scale-95'
              }`}
              title={item.name}
              aria-label={item.name}
            >
              <ProjectIcon icon={item.id} className="w-full h-full drop-shadow-sm transition-transform group-hover:scale-105" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
