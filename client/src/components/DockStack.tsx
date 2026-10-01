import React from 'react';
import { createPortal } from 'react-dom';

const DOCK_ROOT_ID = 'raft-dock-stack';
const ORDER_EPOCH = Date.UTC(2025, 0, 1);

// Shared top-right container (below action buttons) so docks from different sources stack instead of overlapping.
const DOCK_ROOT_CLASS =
  'fixed top-24 left-4 right-4 sm:left-auto sm:right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none';

const getDockRoot = (): HTMLElement => {
  let root = document.getElementById(DOCK_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = DOCK_ROOT_ID;
    document.body.appendChild(root);
  }
  if (root.className !== DOCK_ROOT_CLASS) {
    root.className = DOCK_ROOT_CLASS;
  }
  return root;
};

/** Renders a docked card into the shared stack; cards are sorted top to bottom (newer cards appear at the bottom). */
export const DockItem: React.FC<{ createdAt: number; children: React.ReactNode }> = ({ createdAt, children }) => {
  // CSS `order` is a 32-bit int, so use 100ms units since a fixed epoch.
  // Smaller order appears at top (older), larger order appears at bottom (newer).
  const order = Math.floor((createdAt - ORDER_EPOCH) / 100);
  return createPortal(
    <div style={{ order }} className="animate-in fade-in slide-in-from-top-2 duration-200">
      {children}
    </div>,
    getDockRoot()
  );
};
