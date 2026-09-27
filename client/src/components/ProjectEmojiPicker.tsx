import React, { useRef, useEffect } from 'react';
import { EmojiPicker, EmojiPickerListCategoryHeaderProps, EmojiPickerListEmojiProps } from 'frimousse';
import { Search, Loader2 } from 'lucide-react';

interface ProjectEmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}

const CategoryHeader: React.FC<EmojiPickerListCategoryHeaderProps> = ({ category, ...props }) => (
  <div
    {...props}
    className="px-2 py-1.5 text-[11px] font-semibold text-cozy-muted uppercase tracking-wider bg-cozy-card/95 dark:bg-cozy-surface/95 backdrop-blur-sm sticky top-0 z-10 select-none"
  >
    {category.label}
  </div>
);

const EmojiButton: React.FC<EmojiPickerListEmojiProps> = ({ emoji, ...props }) => (
  <button
    type="button"
    {...props}
    className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg leading-none transition-all duration-150 cursor-pointer select-none ${
      emoji.isActive
        ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400 scale-110 shadow-sm'
        : 'hover:bg-cozy-subtle hover:scale-105 active:scale-95'
    }`}
    title={emoji.label}
  >
    {emoji.emoji}
  </button>
);

export const ProjectEmojiPicker: React.FC<ProjectEmojiPickerProps> = ({
  onSelectEmoji,
  onClose,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

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
      className={`z-50 w-[304px] rounded-2xl glass-panel border border-white/80 dark:border-white/10 shadow-soft-xl bg-cozy-card/95 dark:bg-cozy-surface/95 backdrop-blur-xl p-3 flex flex-col text-cozy-text animate-in fade-in zoom-in-95 duration-150 ${className}`}
    >
      <EmojiPicker.Root
        columns={8}
        className="flex flex-col h-[320px] outline-none"
        onEmojiSelect={(item) => {
          onSelectEmoji(item.emoji);
          onClose();
        }}
      >
        {/* Search header */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-cozy-border/60">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cozy-muted pointer-events-none" />
            <EmojiPicker.Search
              className="w-full bg-cozy-bg/80 border border-cozy-border focus:border-teal-500 rounded-xl pl-8 pr-3 py-1.5 text-xs text-cozy-text placeholder:text-cozy-muted/70 focus:outline-none transition-colors"
              placeholder="Search emoji..."
              autoFocus
            />
          </div>
          <EmojiPicker.SkinToneSelector
            className="w-8 h-8 rounded-xl bg-cozy-bg/80 border border-cozy-border hover:border-teal-400/40 flex items-center justify-center text-sm cursor-pointer transition-colors"
            title="Switch skin tone"
          />
        </div>

        {/* Viewport for emoji list */}
        <EmojiPicker.Viewport className="relative flex-1 overflow-y-auto pr-1 outline-none scrollbar-thin">
          <EmojiPicker.Loading className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-cozy-muted">
            <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
            <span>Loading emojis...</span>
          </EmojiPicker.Loading>

          <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-cozy-muted text-center p-4">
            No emojis found
          </EmojiPicker.Empty>

          <EmojiPicker.List
            components={{
              CategoryHeader,
              Emoji: EmojiButton,
            }}
          />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
};
