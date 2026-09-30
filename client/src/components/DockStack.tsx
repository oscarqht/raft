import React from 'react';
import { createPortal } from 'react-dom';

const DOCK_ROOT_ID = 'raft-dock-stack';
const ORDER_EPOCH = Date.UTC(2025, 0, 1);

// Shared bottom-right container so docks from different sources stack instead of overlapping.
const getDockRoot = (): HTMLElement => {
  let root = document.getElementById(DOCK_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = DOCK_ROOT_ID;
    root.className =
      'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none';
    document.body.appendChild(root);
  }
  return root;
};

/** Renders a docked card into the shared stack; newer cards (larger createdAt) appear on top. */
export const DockItem: React.FC<{ createdAt: number; children: React.ReactNode }> = ({ createdAt, children }) => {
  // CSS `order` is a 32-bit int, so use 100ms units since a fixed epoch
  const order = -Math.floor((createdAt - ORDER_EPOCH) / 100);
  return createPortal(<div style={{ order }}>{children}</div>, getDockRoot());
};
