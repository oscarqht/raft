import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Tldraw,
  Editor,
  createShapeId,
  AssetRecordType,
  TLShapeId,
  Box,
} from '@tldraw/tldraw';
import { react as trackReact } from '@tldraw/state';
import '@tldraw/tldraw/tldraw.css';
import {
  Crop,
  Copy,
  Download,
  X,
  Paperclip,
  Check,
  Undo2,
  Redo2,
  Loader2,
  Camera,
} from 'lucide-react';
import { FileAttachment } from '../types';
import { uploadTaskAttachments } from '../api';

const SCREENSHOT_EDITOR_CONFIGS_KEY = 'raft:screenshot-editor-configs';

interface ScreenshotEditorSavedConfigs {
  stylesForNextShape?: Record<string, unknown>;
  opacityForNextShape?: number;
  isToolLocked?: boolean;
  toolId?: string;
}

const VALID_RESTORABLE_TOOLS = new Set([
  'select',
  'hand',
  'draw',
  'arrow',
  'line',
  'geo',
  'text',
  'note',
  'highlight',
  'eraser',
]);

function loadSavedScreenshotConfigs(): ScreenshotEditorSavedConfigs | null {
  try {
    const raw = localStorage.getItem(SCREENSHOT_EDITOR_CONFIGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const result: ScreenshotEditorSavedConfigs = {};

    if (parsed.stylesForNextShape && typeof parsed.stylesForNextShape === 'object') {
      const sanitizedStyles: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(parsed.stylesForNextShape)) {
        if (
          typeof key === 'string' &&
          (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
        ) {
          sanitizedStyles[key] = val;
        }
      }
      if (Object.keys(sanitizedStyles).length > 0) {
        result.stylesForNextShape = sanitizedStyles;
      }
    }

    if (typeof parsed.opacityForNextShape === 'number' && !isNaN(parsed.opacityForNextShape)) {
      result.opacityForNextShape = parsed.opacityForNextShape;
    }

    if (typeof parsed.isToolLocked === 'boolean') {
      result.isToolLocked = parsed.isToolLocked;
    }

    if (typeof parsed.toolId === 'string' && VALID_RESTORABLE_TOOLS.has(parsed.toolId)) {
      result.toolId = parsed.toolId;
    }

    return result;
  } catch (e) {
    console.error('Failed to load saved screenshot editor configs:', e);
    return null;
  }
}

function saveScreenshotConfigs(configs: ScreenshotEditorSavedConfigs): void {
  try {
    localStorage.setItem(SCREENSHOT_EDITOR_CONFIGS_KEY, JSON.stringify(configs));
  } catch (e) {
    console.error('Failed to save screenshot editor configs:', e);
  }
}

export interface PreviewAnnotationOverlayProps {
  screenshotDataUrl: string;
  screenshotWidth: number;
  screenshotHeight: number;
  taskId: string;
  onAttachToChat: (attachments: FileAttachment[]) => void;
  onClose: () => void;
}

export const PreviewAnnotationOverlay: React.FC<PreviewAnnotationOverlayProps> = ({
  screenshotDataUrl,
  screenshotWidth,
  screenshotHeight,
  taskId,
  onAttachToChat,
  onClose,
}) => {
  const editorRef = useRef<Editor | null>(null);
  const screenshotShapeIdRef = useRef<TLShapeId>(createShapeId('screenshot-background'));
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const [isCropping, setIsCropping] = useState(false);
  const [isAttaching, setIsAttaching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [currentDimensions, setCurrentDimensions] = useState({
    w: screenshotWidth,
    h: screenshotHeight,
  });

  // Track initial crop state when entering crop mode to check if changed
  const cropInitialStateRef = useRef<{
    crop: string | null;
    w: number;
    h: number;
    x: number;
    y: number;
  } | null>(null);

  const getScreenshotShape = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return null;
    return editor.getShape(screenshotShapeIdRef.current) as any;
  }, []);

  const getScreenshotUncroppedMetrics = useCallback(() => {
    const shape = getScreenshotShape();
    if (!shape) return null;

    const natW = screenshotWidth || shape.props?.w || 1;
    const natH = screenshotHeight || shape.props?.h || 1;
    const crop = shape.props?.crop;

    let originX = shape.x;
    let originY = shape.y;

    if (crop && crop.topLeft) {
      originX = shape.x - crop.topLeft.x * natW;
      originY = shape.y - crop.topLeft.y * natH;
    }

    return { originX, originY, width: natW, height: natH };
  }, [getScreenshotShape, screenshotWidth, screenshotHeight]);

  const fitScreenshotToViewport = useCallback((immediate = false) => {
    const editor = editorRef.current;
    if (!editor) return;

    const bounds = editor.getShapePageBounds(screenshotShapeIdRef.current);
    if (!bounds) return;

    const viewport = editor.getViewportScreenBounds() || {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const minDim = Math.min(viewport.width, viewport.height);
    const inset = Math.min(Math.round(minDim * 0.22), Math.max(40, Math.round(minDim * 0.12)));

    editor.zoomToBounds(bounds, {
      inset,
      animation: immediate ? undefined : { duration: 220 },
      immediate,
    });
  }, []);

  const startCrop = useCallback(() => {
    const editor = editorRef.current;
    const shape = getScreenshotShape();
    if (!editor || !shape) return;

    cropInitialStateRef.current = {
      crop: shape.props?.crop ? JSON.stringify(shape.props.crop) : null,
      w: shape.props?.w,
      h: shape.props?.h,
      x: shape.x,
      y: shape.y,
    };

    editor.complete?.();
    if (canvasContainerRef.current) {
      editor.updateViewportScreenBounds(canvasContainerRef.current);
    }
    editor.run(
      () => {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          isLocked: false,
        });
        editor.select(screenshotShapeIdRef.current);
        editor.setCroppingShape?.(screenshotShapeIdRef.current);
        editor.setCurrentTool('select.crop.idle');
      },
      { history: 'ignore', ignoreShapeLock: true }
    );

    setIsCropping(true);
  }, [getScreenshotShape]);

  const finishCrop = useCallback((options: { forceFit?: boolean } = {}) => {
    const editor = editorRef.current;
    const shape = getScreenshotShape();
    if (!editor || !shape) return;

    editor.complete?.();
    editor.setCroppingShape?.(null);
    editor.setCurrentTool('select.idle');
    editor.selectNone();

    editor.run(
      () => {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          isLocked: true,
        });
      },
      { history: 'ignore', ignoreShapeLock: true }
    );

    setIsCropping(false);

    if (shape.props?.w && shape.props?.h) {
      setCurrentDimensions({
        w: Math.round(shape.props.w),
        h: Math.round(shape.props.h),
      });
    }

    if (options.forceFit) {
      fitScreenshotToViewport();
    }
    cropInitialStateRef.current = null;
  }, [getScreenshotShape, fitScreenshotToViewport]);

  const toggleCrop = useCallback(() => {
    if (isCropping) {
      finishCrop({ forceFit: true });
    } else {
      startCrop();
    }
  }, [isCropping, finishCrop, startCrop]);

  // Handle export to PNG Blob
  const exportImageBlob = useCallback(async (): Promise<Blob> => {
    const editor = editorRef.current;
    if (!editor) throw new Error('Editor not ready');

    if (isCropping) {
      finishCrop();
    }
    editor.selectNone();

    const bounds = editor.getShapePageBounds(screenshotShapeIdRef.current);
    const shapeIds = Array.from(editor.getCurrentPageShapeIds());

    const result = await editor.toImage(shapeIds, {
      format: 'png',
      bounds: bounds || undefined,
      background: false,
      padding: 0,
      pixelRatio: 1,
    });

    if (!result || !result.blob) {
      throw new Error('Failed to generate image from editor');
    }

    return result.blob;
  }, [isCropping, finishCrop]);

  // Handle Attach to Chat
  const handleAttachToChat = useCallback(async () => {
    if (isAttaching) return;
    try {
      setIsAttaching(true);
      const blob = await exportImageBlob();
      const filename = `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      const uploaded = await uploadTaskAttachments(taskId, [file]);
      if (uploaded && uploaded.length > 0) {
        onAttachToChat(uploaded);
        onClose();
      }
    } catch (err) {
      console.error('Error attaching screenshot to chat:', err);
    } finally {
      setIsAttaching(false);
    }
  }, [isAttaching, exportImageBlob, taskId, onAttachToChat, onClose]);

  // Handle Copy to Clipboard
  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.write) {
        throw new Error('Clipboard API is not available in this context (requires HTTPS or http://localhost)');
      }
      const blob = await exportImageBlob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy screenshot:', err);
    }
  }, [exportImageBlob]);

  // Handle Download to Local Disk
  const handleDownload = useCallback(async () => {
    try {
      const blob = await exportImageBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `preview-annotation-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download screenshot:', err);
    }
  }, [exportImageBlob]);

  // Handle Editor Mount
  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    // Create image asset & locked shape
    const assetId = AssetRecordType.createId();
    const shapeId = screenshotShapeIdRef.current;

    editor.run(
      () => {
        editor.createAssets([
          {
            id: assetId,
            typeName: 'asset',
            type: 'image',
            props: {
              name: 'preview-screenshot.png',
              src: screenshotDataUrl,
              w: screenshotWidth,
              h: screenshotHeight,
              mimeType: 'image/png',
              isAnimated: false,
            },
            meta: {},
          },
        ]);

        editor.createShape({
          id: shapeId,
          type: 'image',
          x: 0,
          y: 0,
          isLocked: true,
          props: {
            assetId,
            w: screenshotWidth,
            h: screenshotHeight,
            altText: 'Preview Screenshot',
          },
        });

        editor.selectNone();
      },
      { history: 'ignore', ignoreShapeLock: true }
    );

    // Initial camera fitting & screen bounds sync
    setTimeout(() => {
      if (canvasContainerRef.current) {
        editor.updateViewportScreenBounds(canvasContainerRef.current);
      }
      fitScreenshotToViewport(true);
    }, 60);

    // Track undo/redo capability & shape changes
    const updateHistoryState = () => {
      setCanUndo(editor.getCanUndo());
      setCanRedo(editor.getCanRedo());
      const shape = editor.getShape(shapeId) as any;
      if (shape && shape.props?.w && shape.props?.h) {
        setCurrentDimensions({
          w: Math.round(shape.props.w),
          h: Math.round(shape.props.h),
        });
      }
    };

    // Restore last configs (color, size, dash, fill, opacity, tool lock, tool, etc.)
    let isInitialized = false;
    const savedConfigs = loadSavedScreenshotConfigs();
    if (savedConfigs) {
      editor.run(
        () => {
          const currentInstance = editor.getInstanceState();
          const update: Record<string, unknown> = {};

          if (savedConfigs.stylesForNextShape && Object.keys(savedConfigs.stylesForNextShape).length > 0) {
            update.stylesForNextShape = {
              ...currentInstance.stylesForNextShape,
              ...savedConfigs.stylesForNextShape,
            };
          }

          if (typeof savedConfigs.opacityForNextShape === 'number') {
            update.opacityForNextShape = savedConfigs.opacityForNextShape;
          }

          if (typeof savedConfigs.isToolLocked === 'boolean') {
            update.isToolLocked = savedConfigs.isToolLocked;
          }

          if (Object.keys(update).length > 0) {
            editor.updateInstanceState(update);
          }

          if (savedConfigs.toolId && VALID_RESTORABLE_TOOLS.has(savedConfigs.toolId)) {
            editor.setCurrentTool(savedConfigs.toolId);
          }
        },
        { history: 'ignore' }
      );
    }
    isInitialized = true;

    const persistCurrentConfigs = () => {
      if (!isInitialized) return;
      const instance = editor.getInstanceState();
      if (!instance) return;

      const currentToolId = editor.getCurrentToolId();
      const toolId = VALID_RESTORABLE_TOOLS.has(currentToolId) ? currentToolId : undefined;

      saveScreenshotConfigs({
        stylesForNextShape: instance.stylesForNextShape ? { ...instance.stylesForNextShape } : {},
        opacityForNextShape: instance.opacityForNextShape,
        isToolLocked: instance.isToolLocked,
        toolId,
      });
    };

    // Reactive listener for tool changes & computed updates
    const disposeReactor = trackReact('persist-screenshot-editor-configs', () => {
      persistCurrentConfigs();
    });

    // Store listener for record changes (stylesForNextShape, opacity, toolLock, shapes, undo/redo)
    const disposeStore = editor.store.listen(() => {
      updateHistoryState();
      persistCurrentConfigs();
    });

    return () => {
      persistCurrentConfigs();
      disposeReactor?.();
      disposeStore?.();
    };
  }, [screenshotDataUrl, screenshotWidth, screenshotHeight, fitScreenshotToViewport]);

  // Bind Marquee Crop Drag Interaction (replicated from Arcable)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isCropping) return;

    let isPointerDown = false;
    let hasMovedEnough = false;
    let startClientX = 0;
    let startClientY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let startPageX = 0;
    let startPageY = 0;
    let currentMetrics: { originX: number; originY: number; width: number; height: number } | null = null;

    const marqueeEl = marqueeRef.current;
    const badgeEl = badgeRef.current;

    const hideMarquee = () => {
      if (marqueeEl) {
        marqueeEl.classList.add('hidden');
        marqueeEl.style.width = '0px';
        marqueeEl.style.height = '0px';
      }
      document.body.classList.remove('crop-dragging-active');
    };

    const isNearHandle = (clientX: number, clientY: number) => {
      const pagePoint = editor.screenToPage({ x: clientX, y: clientY });
      const zoom = editor.getZoomLevel?.() || 1;
      const hitMargin = (editor.options?.hitTestMargin || 14) / zoom;
      const overlay = (editor as any).overlays?.getOverlayAtPoint?.(pagePoint, hitMargin);
      if (
        overlay &&
        (overlay.props?.overlayType === 'resize_handle' ||
          overlay.props?.overlayType === 'crop_handle' ||
          overlay.props?.handle)
      ) {
        return true;
      }

      const currentBounds = editor.getShapePageBounds(screenshotShapeIdRef.current);
      if (currentBounds) {
        const handlePoints = [
          editor.pageToScreen({ x: currentBounds.minX, y: currentBounds.minY }),
          editor.pageToScreen({ x: currentBounds.maxX, y: currentBounds.minY }),
          editor.pageToScreen({ x: currentBounds.minX, y: currentBounds.maxY }),
          editor.pageToScreen({ x: currentBounds.maxX, y: currentBounds.maxY }),
          editor.pageToScreen({ x: currentBounds.midX, y: currentBounds.minY }),
          editor.pageToScreen({ x: currentBounds.midX, y: currentBounds.maxY }),
          editor.pageToScreen({ x: currentBounds.minX, y: currentBounds.midY }),
          editor.pageToScreen({ x: currentBounds.maxX, y: currentBounds.midY }),
        ];
        for (const pt of handlePoints) {
          if (Math.hypot(pt.x - clientX, pt.y - clientY) <= 18) {
            return true;
          }
        }
      }
      return false;
    };

    const calculateCropBox = (currClientX: number, currClientY: number, shiftKey: boolean) => {
      if (!currentMetrics) return null;
      const currPage = editor.screenToPage({ x: currClientX, y: currClientY });

      const minX = currentMetrics.originX;
      const maxX = currentMetrics.originX + currentMetrics.width;
      const minY = currentMetrics.originY;
      const maxY = currentMetrics.originY + currentMetrics.height;

      const csX = Math.max(minX, Math.min(maxX, startPageX));
      const csY = Math.max(minY, Math.min(maxY, startPageY));

      const rawEndX = Math.max(minX, Math.min(maxX, currPage.x));
      const rawEndY = Math.max(minY, Math.min(maxY, currPage.y));

      let endX = rawEndX;
      let endY = rawEndY;

      if (shiftKey) {
        const dx = rawEndX - csX;
        const dy = rawEndY - csY;
        let side = Math.max(Math.abs(dx), Math.abs(dy));
        const signX = dx >= 0 ? 1 : -1;
        const signY = dy >= 0 ? 1 : -1;
        const maxSideX = signX > 0 ? maxX - csX : csX - minX;
        const maxSideY = signY > 0 ? maxY - csY : csY - minY;
        side = Math.min(side, maxSideX, maxSideY);
        endX = csX + signX * side;
        endY = csY + signY * side;
      }

      const boxPageX = Math.min(csX, endX);
      const boxPageY = Math.min(csY, endY);
      const boxPageW = Math.abs(endX - csX);
      const boxPageH = Math.abs(endY - csY);

      return {
        boxPageX,
        boxPageY,
        boxPageW,
        boxPageH,
        metrics: currentMetrics,
      };
    };

    const updateMarqueeUI = (box: any) => {
      if (!marqueeEl) return;
      const canvasEl = canvasContainerRef.current;
      if (!canvasEl) return;
      const canvasRect = canvasEl.getBoundingClientRect();

      const screenP1 = editor.pageToScreen({ x: box.boxPageX, y: box.boxPageY });
      const screenP2 = editor.pageToScreen({ x: box.boxPageX + box.boxPageW, y: box.boxPageY + box.boxPageH });

      const screenLeft = Math.min(screenP1.x, screenP2.x);
      const screenTop = Math.min(screenP1.y, screenP2.y);
      const width = Math.abs(screenP2.x - screenP1.x);
      const height = Math.abs(screenP2.y - screenP1.y);

      const left = screenLeft - canvasRect.left;
      const top = screenTop - canvasRect.top;

      marqueeEl.style.left = `${left}px`;
      marqueeEl.style.top = `${top}px`;
      marqueeEl.style.width = `${width}px`;
      marqueeEl.style.height = `${height}px`;
      marqueeEl.classList.remove('hidden');
      document.body.classList.add('crop-dragging-active');

      if (badgeEl && currentMetrics) {
        const naturalW = Math.round((box.boxPageW / box.metrics.width) * currentMetrics.width);
        const naturalH = Math.round((box.boxPageH / box.metrics.height) * currentMetrics.height);
        badgeEl.textContent = `${naturalW} × ${naturalH}`;

        if (top + height + 34 > canvasRect.height) {
          badgeEl.style.bottom = 'auto';
          badgeEl.style.top = '-28px';
        } else {
          badgeEl.style.top = 'auto';
          badgeEl.style.bottom = '-28px';
        }
      }
    };

    const applyCropBox = (box: any) => {
      const shape = getScreenshotShape();
      if (!editor || !shape || !box.metrics) return;

      const tlx = Math.max(0, Math.min(1, (box.boxPageX - box.metrics.originX) / box.metrics.width));
      const tly = Math.max(0, Math.min(1, (box.boxPageY - box.metrics.originY) / box.metrics.height));
      const brx = Math.max(0, Math.min(1, (box.boxPageX + box.boxPageW - box.metrics.originX) / box.metrics.width));
      const bry = Math.max(0, Math.min(1, (box.boxPageY + box.boxPageH - box.metrics.originY) / box.metrics.height));

      if (brx - tlx < 0.001 || bry - tly < 0.001) return;

      editor.run(
        () => {
          editor.updateShape({
            id: shape.id,
            type: shape.type,
            x: box.boxPageX,
            y: box.boxPageY,
            isLocked: true,
            props: {
              ...shape.props,
              w: box.boxPageW,
              h: box.boxPageH,
              crop: {
                topLeft: { x: tlx, y: tly },
                bottomRight: { x: brx, y: bry },
              },
            },
          });
          editor.setCroppingShape?.(null);
          editor.selectNone();
          editor.setCurrentTool('select.idle');
        },
        { history: 'ignore', ignoreShapeLock: true }
      );

      setIsCropping(false);
      setCurrentDimensions({
        w: Math.round(box.boxPageW),
        h: Math.round(box.boxPageH),
      });
      fitScreenshotToViewport();
      cropInitialStateRef.current = null;
    };

    const cleanupDrag = () => {
      isPointerDown = false;
      hasMovedEnough = false;
      currentMetrics = null;
      hideMarquee();
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.(
          'button, input, select, textarea, [role="toolbar"], [role="menu"], [role="dialog"], .tl-toolbar, .tlui-toolbar, .tlui-main-toolbar, .tlui-menu, .tlui-popover, .preview-annotation-bar'
        )
      ) {
        return;
      }

      const canvasEl = canvasContainerRef.current;
      if (!canvasEl || !canvasEl.contains(target)) {
        return;
      }

      if (
        target?.closest?.(
          '[data-testid*="handle"], [class*="handle"], [class*="corner"], [class*="edge"]'
        )
      ) {
        return;
      }

      // Keep tldraw viewport screen bounds strictly in sync with canvas position
      editor.updateViewportScreenBounds(canvasEl);

      if (isNearHandle(e.clientX, e.clientY)) {
        return;
      }

      currentMetrics = getScreenshotUncroppedMetrics();
      if (!currentMetrics) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      isPointerDown = true;
      hasMovedEnough = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      const startP = editor.screenToPage({ x: e.clientX, y: e.clientY });
      startPageX = startP.x;
      startPageY = startP.y;

      window.addEventListener('pointermove', onPointerMove, { capture: true });
      window.addEventListener('pointerup', onPointerUp, { capture: true });
      window.addEventListener('pointercancel', onPointerCancel, { capture: true });
      window.addEventListener('keydown', onKeyDown, { capture: true });
      window.addEventListener('keyup', onKeyUp, { capture: true });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerDown || !currentMetrics) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      lastClientX = e.clientX;
      lastClientY = e.clientY;

      const screenDist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
      if (!hasMovedEnough && screenDist >= 4) {
        hasMovedEnough = true;
      }

      if (hasMovedEnough) {
        const box = calculateCropBox(e.clientX, e.clientY, e.shiftKey);
        if (box) {
          updateMarqueeUI(box);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isPointerDown) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const screenDist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
      const box = calculateCropBox(e.clientX, e.clientY, e.shiftKey);

      cleanupDrag();

      if (screenDist >= 10 && box && box.boxPageW >= 4 && box.boxPageH >= 4) {
        applyCropBox(box);
      }
    };

    const onPointerCancel = () => {
      if (!isPointerDown) return;
      cleanupDrag();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPointerDown) {
        e.preventDefault();
        e.stopPropagation();
        cleanupDrag();
        return;
      }

      if (e.key === 'Shift' && isPointerDown && hasMovedEnough) {
        const box = calculateCropBox(lastClientX, lastClientY, true);
        if (box) updateMarqueeUI(box);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isPointerDown && hasMovedEnough) {
        const box = calculateCropBox(lastClientX, lastClientY, false);
        if (box) updateMarqueeUI(box);
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });

    return () => {
      cleanupDrag();
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, [isCropping, getScreenshotShape, getScreenshotUncroppedMetrics, fitScreenshotToViewport]);

  // Global Keyboard Shortcuts (Esc, Cmd+Enter, C, Cmd+Z)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      // Cmd+Enter or Ctrl+Enter -> Confirm and attach to chat
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleAttachToChat();
        return;
      }

      // Esc -> Exit crop if cropping, else close overlay
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isCropping) {
          finishCrop();
        } else {
          onClose();
        }
        return;
      }

      // 'c' or 'C' -> Toggle crop (when not in text input)
      if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') {
        const editor = editorRef.current;
        if (!editor?.getEditingShapeId?.()) {
          e.preventDefault();
          toggleCrop();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleAttachToChat, isCropping, finishCrop, onClose, toggleCrop]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-50 flex flex-col bg-slate-950 overflow-hidden select-none animate-in fade-in duration-200"
    >
      {/* Top Action Header Bar - in normal flex document flow so it never overlaps or gets blocked by Tldraw */}
      <div className="preview-annotation-bar relative shrink-0 h-12 z-50 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 shadow-sm pointer-events-auto">
        {/* Left: Title & Dimensions */}
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-teal-50 dark:bg-teal-950/50 border border-teal-200/60 dark:border-teal-900/50 text-teal-600 dark:text-teal-400 text-xs font-semibold">
            <Camera className="w-3.5 h-3.5" />
            <span>Annotate Preview</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            {currentDimensions.w} × {currentDimensions.h}
          </span>
        </div>

        {/* Center: Crop & Undo/Redo */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={toggleCrop}
            title={isCropping ? 'Finish Cropping (C)' : 'Crop Screenshot (C)'}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isCropping
                ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/60'
            }`}
          >
            <Crop className="w-3.5 h-3.5" />
            <span>{isCropping ? 'Done Cropping' : 'Crop'}</span>
            <kbd className="hidden sm:inline-block ml-1 text-[10px] opacity-70">C</kbd>
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => editorRef.current?.undo()}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700/60 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => editorRef.current?.redo()}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700/60 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy image to clipboard"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="Download PNG"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Primary Action: Attach to Chat */}
          <button
            type="button"
            onClick={handleAttachToChat}
            disabled={isAttaching}
            title="Attach to Chat (⌘↵)"
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 active:bg-teal-700 text-white font-medium text-xs shadow-sm shadow-teal-500/25 transition-all disabled:opacity-60 cursor-pointer"
          >
            {isAttaching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Paperclip className="w-3.5 h-3.5" />
            )}
            <span>{isAttaching ? 'Attaching...' : 'Attach to Chat'}</span>
            <span className="hidden sm:inline-block ml-0.5 text-[10px] text-teal-200">⌘↵</span>
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div
        ref={canvasContainerRef}
        className="relative flex-1 w-full min-h-0 tldraw-container preview-annotation-canvas overflow-hidden"
      >
        {/* Marquee Crop Overlay DOM Element */}
        <div
          ref={marqueeRef}
          id="crop-marquee-overlay"
          className="crop-marquee-overlay hidden"
        >
          <div ref={badgeRef} className="crop-marquee-badge" />
        </div>

        <Tldraw
          autoFocus
          onMount={handleMount}
          components={{
            PageMenu: null,
            NavigationPanel: null,
            SharePanel: null,
            HelpMenu: null,
            TopPanel: null,
          }}
        />
      </div>
    </div>
  );
};
