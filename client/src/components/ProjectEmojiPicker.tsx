import React from 'react';
import { ProjectIconPicker } from './ProjectIconPicker';

interface ProjectEmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
  className?: string;
  selectedEmoji?: string | null;
}

/**
 * Backwards-compatible wrapper that directs to ProjectIconPicker
 */
export const ProjectEmojiPicker: React.FC<ProjectEmojiPickerProps> = ({
  onSelectEmoji,
  onClose,
  className,
  selectedEmoji,
}) => {
  return (
    <ProjectIconPicker
      selectedIcon={selectedEmoji}
      onSelectIcon={onSelectEmoji}
      onClose={onClose}
      className={className}
    />
  );
};
