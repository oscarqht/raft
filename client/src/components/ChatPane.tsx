import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, X, Send, Square, UploadCloud, Sliders, ChevronDown, ChevronUp, Pencil,
  Terminal, Sparkles, MessageSquareQuote, Target, Clock, Globe, ListTodo, HelpCircle, BookOpen, Layers, MoreVertical,
  Paperclip, Loader2, AlertCircle, Trash2, ArrowUp, RotateCcw
} from 'lucide-react';
import { Task, ChatSession, ChatMessage, Settings, CliInfo, ModelOption, AgentSkill, FileAttachment, AlphaHitlPayload, QueuedMessage } from '../types';
import { ChatMessageList, ChatMessageListHandle } from './ChatMessageList';
import { ChatQueueDrawer } from './ChatQueueDrawer';
import { getTaskChats, createChatSession, updateChatSession, deleteChatSession, getChatMessages, deleteChatMessage, getModels, getSkills, uploadTaskAttachments } from '../api';
import {
  formatFileSize,
  getFileIcon,
  isImageAttachment,
} from './AttachmentModals';
import {
  getCachedChats,
  setCachedChats,
  getCachedActiveChatId,
  setCachedActiveChatId,
  getCachedMessages,
  setCachedMessages,
  loadCachedMessagesAsync,
  loadCachedChatsAsync,
  deleteCachedChat,
  getCachedModels,
  setCachedModels,
  getCachedProviderPreference,
  setCachedProviderPreference,
  resolveModelAndEffort,
  getCachedQueuedMessages,
  setCachedQueuedMessages,
  setCachedTaskQueuedCount,
  removeUnreadReplyTaskId,
  getTaskDraft,
  setTaskDraft,
  clearTaskDraft,
  setCachedTask,
} from '../cache';
import { requestNotificationPermissionOnUserGesture } from '../utils/notifications';

interface ChatPaneProps {
  task: Task;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
  onOpenSubmit: () => void;
  submitDisabled?: boolean;
  onOpenScripts?: () => void;
  onOpenRebase?: () => void;
  onDeleteTask?: () => void;
  isDeletingTask?: boolean;
  isPreviewOpen?: boolean;
  onTogglePreview?: () => void;
  isDevRunning?: boolean;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  task,
  settings,
  clis,
  ws,
  onOpenSubmit,
  submitDisabled = false,
  onOpenScripts,
  onOpenRebase,
  onDeleteTask,
  isDeletingTask,
  isPreviewOpen = false,
  onTogglePreview,
  isDevRunning = false,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPromptProcessedRef = useRef(false);
  // Synchronous cache initialization for 0ms instantaneous load
  const [chats, setChats] = useState<ChatSession[]>(() => getCachedChats(task.id) || []);
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    const cachedActive = getCachedActiveChatId(task.id);
    const cachedSessions = getCachedChats(task.id) || [];
    if (cachedActive && cachedSessions.some((c) => c.id === cachedActive)) {
      return cachedActive;
    }
    return cachedSessions[0]?.id || null;
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const cachedActive = getCachedActiveChatId(task.id);
    const cachedSessions = getCachedChats(task.id) || [];
    const targetId = (cachedActive && cachedSessions.some((c) => c.id === cachedActive))
      ? cachedActive
      : cachedSessions[0]?.id;
    return targetId ? (getCachedMessages(targetId) || []) : [];
  });
  const [loadingChats, setLoadingChats] = useState(() => !(getCachedChats(task.id)?.length));
  // True while a background revalidation of the active chat's messages is in flight
  const [syncingChats, setSyncingChats] = useState(true);
  const [syncingActiveChat, setSyncingActiveChat] = useState(false);

  const [inputPrompt, setInputPrompt] = useState(() => {
    const draft = getTaskDraft(task.id);
    return draft?.text || '';
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingChunk, setStreamingChunk] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [activeHitl, setActiveHitl] = useState<Record<string, AlphaHitlPayload>>({});

  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>(() => {
    const cachedActive = getCachedActiveChatId(task.id);
    const cachedSessions = getCachedChats(task.id) || [];
    const targetId =
      cachedActive && cachedSessions.some((c) => c.id === cachedActive)
        ? cachedActive
        : cachedSessions[0]?.id;
    return targetId ? getCachedQueuedMessages(targetId) : [];
  });
  const queuedMessagesRef = useRef<QueuedMessage[]>(queuedMessages);
  queuedMessagesRef.current = queuedMessages;

  const activeChatIdRef = useRef<string | null>(activeChatId);
  // Chats created optimistically that the server hasn't confirmed yet
  const pendingChatIdsRef = useRef<Set<string>>(new Set());
  activeChatIdRef.current = activeChatId;

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const isSteeringRef = useRef(false);
  const chatListRef = useRef<ChatMessageListHandle>(null);
  const dispatchMessageRef = useRef<
    | ((
        promptText: string,
        msgAttachments?: FileAttachment[],
        cliOverride?: string,
        modelOverride?: string,
        effortOverride?: string,
        sessionIdOverride?: string
      ) => void)
    | null
  >(null);
  const dispatchNextQueuedMessageRef = useRef<((explicitSessionId?: string) => void) | null>(null);

  // Tab overrides
  const [tabCli, setTabCli] = useState<string>(() => {
    const cachedChats = getCachedChats(task.id) || [];
    const cachedActive = getCachedActiveChatId(task.id);
    const active = cachedChats.find((c) => c.id === cachedActive) || cachedChats[0];
    return active?.agent_cli || settings?.agent_cli || task.project?.default_agent_cli || 'agy';
  });
  const [tabModel, setTabModel] = useState<string>(() => {
    const cachedChats = getCachedChats(task.id) || [];
    const cachedActive = getCachedActiveChatId(task.id);
    const active = cachedChats.find((c) => c.id === cachedActive) || cachedChats[0];
    return active?.model || settings?.default_model || task.project?.default_model || '';
  });
  const [tabEffort, setTabEffort] = useState<string>(() => {
    const cachedChats = getCachedChats(task.id) || [];
    const cachedActive = getCachedActiveChatId(task.id);
    const active = cachedChats.find((c) => c.id === cachedActive) || cachedChats[0];
    return active?.thinking_effort || settings?.thinking_effort || 'medium';
  });

  // Track user manual selection so asynchronous loading/sync never reverts user choices
  const userSelectedCliRef = useRef<string | null>(null);
  const userSelectedModelRef = useRef<string | null>(null);
  const userSelectedEffortRef = useRef<string | null>(null);
  const lastSyncedChatIdRef = useRef<string | null>(null);

  // Tab rename state
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Mobile actions dropdown menu state
  const [showMobileActionsMenu, setShowMobileActionsMenu] = useState(false);

  // Attachments state
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>(() => {
    const draft = getTaskDraft(task.id);
    return draft?.attachments || [];
  });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileActionsRef = useRef<HTMLDivElement>(null);

  // Persist unsent draft (text & pending attachments) to sessionStorage
  const currentDraftTaskIdRef = useRef(task.id);
  useEffect(() => {
    if (currentDraftTaskIdRef.current !== task.id) {
      currentDraftTaskIdRef.current = task.id;
      const draft = getTaskDraft(task.id);
      setInputPrompt(draft?.text || '');
      setPendingAttachments(draft?.attachments || []);
      return;
    }

    if (!inputPrompt.trim() && pendingAttachments.length === 0) {
      clearTaskDraft(task.id);
    } else {
      setTaskDraft(task.id, {
        text: inputPrompt,
        attachments: pendingAttachments,
      });
    }
  }, [task.id, inputPrompt, pendingAttachments]);

  useEffect(() => {
    if (!showMobileActionsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileActionsRef.current && !mobileActionsRef.current.contains(e.target as Node)) {
        setShowMobileActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMobileActionsMenu]);

  // Listen for externally added pending attachments (e.g. from Preview Annotation)
  useEffect(() => {
    const handleExternalAttachments = (e: Event) => {
      const customEvent = e as CustomEvent<
        FileAttachment[] | { attachments?: FileAttachment[]; url?: string }
      >;
      let incomingAttachments: FileAttachment[] = [];
      let url: string | undefined;

      if (Array.isArray(customEvent.detail)) {
        incomingAttachments = customEvent.detail;
      } else if (customEvent.detail && typeof customEvent.detail === 'object') {
        if (Array.isArray(customEvent.detail.attachments)) {
          incomingAttachments = customEvent.detail.attachments;
        }
        if (typeof customEvent.detail.url === 'string') {
          url = customEvent.detail.url;
        }
      }

      if (incomingAttachments.length > 0) {
        setPendingAttachments((prev) => [...prev, ...incomingAttachments]);
      }

      if (url) {
        const targetUrl = url.trim();
        if (targetUrl) {
          setInputPrompt((prev) => {
            if (prev.includes(targetUrl)) {
              return prev;
            }
            if (!prev || !prev.trim()) {
              return `${targetUrl}\n`;
            }
            return `${prev.trimEnd()}\n${targetUrl}`;
          });
        }
      }

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const length = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(length, length);
        }
      }, 80);
    };
    window.addEventListener('add-pending-attachments', handleExternalAttachments);
    return () => window.removeEventListener('add-pending-attachments', handleExternalAttachments);
  }, []);

  // Skills autocompletion state
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [showSkillsPopup, setShowSkillsPopup] = useState(false);
  const [filteredSkills, setFilteredSkills] = useState<AgentSkill[]>([]);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [activeSlashToken, setActiveSlashToken] = useState<{ start: number; end: number; query: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skillsPopupRef = useRef<HTMLDivElement>(null);
  const popupListRef = useRef<HTMLDivElement>(null);
  const configRef = useRef<HTMLDivElement>(null);
  const configBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (task?.id) {
      removeUnreadReplyTaskId(task.id);
    }
  }, [task?.id]);

  useEffect(() => {
    if (task?.id) {
      setCachedTaskQueuedCount(task.id, queuedMessages.length);
    }
  }, [task?.id, queuedMessages.length]);

  useEffect(() => {
    if (!showConfig) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        configRef.current &&
        !configRef.current.contains(e.target as Node) &&
        configBtnRef.current &&
        !configBtnRef.current.contains(e.target as Node)
      ) {
        setShowConfig(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showConfig]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 48), 200)}px`;
    }
  }, [inputPrompt]);

  useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChatId]);

  const chatsAbortControllerRef = useRef<AbortController | null>(null);
  const activeChatAbortControllerRef = useRef<AbortController | null>(null);
  const lastLoadedActiveChatRef = useRef<string | null>(null);
  const taskRef = useRef(task);
  taskRef.current = task;

  // Load chat sessions & active messages in 1 round trip
  const loadChats = async () => {
    if (chatsAbortControllerRef.current) {
      chatsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    chatsAbortControllerRef.current = controller;
    const currentTaskId = task.id;
    const targetActiveId = activeChatId || getCachedActiveChatId(currentTaskId);
    setSyncingChats(true);

    try {
      const data = await getTaskChats(currentTaskId, {
        includeMessages: true,
        activeChatId: targetActiveId || undefined,
        signal: controller.signal,
      });

      if (controller.signal.aborted || taskRef.current.id !== currentTaskId) return;

      let nextChats = data;

      if (data.length > 0) {
        const nextActiveChat = (targetActiveId && data.find((c) => c.id === targetActiveId)) || data[0];
        const nextActiveId = nextActiveChat.id;

        // If the user made a manual selection (e.g. right after task creation while chats were loading),
        // apply it to the active chat session instead of falling back to the server's default!
        if (userSelectedCliRef.current || userSelectedModelRef.current || userSelectedEffortRef.current) {
          const cliToApply = userSelectedCliRef.current || tabCli;
          const modelToApply = userSelectedModelRef.current || tabModel;
          const effortToApply = userSelectedEffortRef.current || tabEffort;

          nextChats = data.map((c) =>
            c.id === nextActiveId
              ? {
                  ...c,
                  agent_cli: cliToApply || c.agent_cli,
                  model: modelToApply || c.model,
                  thinking_effort: effortToApply || c.thinking_effort,
                }
              : c
          );

          updateChatSession(nextActiveId, {
            agent_cli: cliToApply,
            model: modelToApply,
            thinking_effort: effortToApply,
          }).catch(() => {});
        }

        setChats(nextChats);
        setCachedChats(currentTaskId, nextChats);
        setActiveChatId(nextActiveId);
        setCachedActiveChatId(currentTaskId, nextActiveId);

        if (Array.isArray(nextActiveChat.messages)) {
          lastLoadedActiveChatRef.current = nextActiveId;
          const incomingMessages: ChatMessage[] = nextActiveChat.messages;
          setMessages((prev) => {
            if (prev.length > 0 && incomingMessages.length === 0) return prev;
            if (isStreamingRef.current) return prev;
            return incomingMessages;
          });
          setCachedMessages(nextActiveId, incomingMessages);
        } else {
          // Fallback if messages were not returned directly
          const fresh = await getChatMessages(nextActiveId, controller.signal);
          if (!controller.signal.aborted && taskRef.current.id === currentTaskId) {
            lastLoadedActiveChatRef.current = nextActiveId;
            setMessages((prev) => {
              if (prev.length > 0 && fresh.length === 0) return prev;
              if (isStreamingRef.current) return prev;
              return fresh;
            });
            setCachedMessages(nextActiveId, fresh);
          }
        }
      } else {
        setChats(data);
        setCachedChats(currentTaskId, data);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
    } finally {
      if (!controller.signal.aborted && taskRef.current.id === currentTaskId) {
        setLoadingChats(false);
        setSyncingChats(false);
      }
    }
  };

  useEffect(() => {
    loadChats();
    return () => {
      chatsAbortControllerRef.current?.abort();
      activeChatAbortControllerRef.current?.abort();
    };
  }, [task.id]);

  // Sync tab overrides when active chat changes
  useEffect(() => {
    if (!activeChatId) return;
    const currentChat = chats.find((c) => c.id === activeChatId);
    if (!currentChat) return;

    if (currentChat.status === 'running') {
      setIsStreaming(true);
    } else {
      setIsStreaming(false);
    }

    // Only sync provider/model from currentChat when switching to a different chat tab
    if (lastSyncedChatIdRef.current !== activeChatId) {
      lastSyncedChatIdRef.current = activeChatId;

      // If user had pending manual selection for this newly active chat, keep it!
      if (userSelectedCliRef.current || userSelectedModelRef.current) {
        return;
      }

      const cli = currentChat.agent_cli || settings?.agent_cli || task.project?.default_agent_cli || 'agy';
      setTabCli(cli);

      // Instantly load cached models for this CLI if available
      const cached = getCachedModels(cli);
      if (cached.length > 0) {
        setAvailableModels(cached);
        const resolved = resolveModelAndEffort(
          cli,
          cached,
          currentChat.model,
          currentChat.thinking_effort || settings?.thinking_effort || 'medium'
        );
        setTabModel(resolved.modelId);
        setTabEffort(resolved.effort);
      } else {
        setTabModel(currentChat.model || settings?.default_model || task.project?.default_model || '');
        setTabEffort(currentChat.thinking_effort || settings?.thinking_effort || 'medium');
      }
    }
  }, [activeChatId, chats]);

  // Load messages and queued messages when active chat changes (instant cached + revalidate in background)
  useEffect(() => {
    if (!activeChatId) return;
    setCachedActiveChatId(task.id, activeChatId);
    const cachedQueue = getCachedQueuedMessages(activeChatId);
    setQueuedMessages(cachedQueue);
    queuedMessagesRef.current = cachedQueue;

    // If cached messages exist for this chat, display immediately
    const cached = getCachedMessages(activeChatId);
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else {
      // Never show the previous chat's messages while this one loads
      setMessages([]);
      loadCachedMessagesAsync(activeChatId).then((idbMsgs) => {
        if (idbMsgs && idbMsgs.length > 0) {
          setMessages((prev) => (prev.length === 0 ? idbMsgs : prev));
        }
      });
    }

    if (pendingChatIdsRef.current.has(activeChatId)) {
      // Brand-new chat: nothing to fetch, and the server may not have it yet
      setSyncingActiveChat(false);
      return;
    }

    if (lastLoadedActiveChatRef.current === activeChatId) {
      // Already freshly populated by loadChats in the same cycle!
      lastLoadedActiveChatRef.current = null;
      setSyncingActiveChat(false);
      return;
    }

    if (activeChatAbortControllerRef.current) {
      activeChatAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;

    setSyncingActiveChat(true);
    getChatMessages(activeChatId, controller.signal)
      .then((fresh) => {
        if (controller.signal.aborted) return;
        setMessages((prev) => {
          if (prev.length > 0 && fresh.length === 0) return prev;
          if (isStreamingRef.current) return prev;
          return fresh;
        });
        setCachedMessages(activeChatId, fresh);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
      })
      .finally(() => {
        if (!controller.signal.aborted) setSyncingActiveChat(false);
      });

    return () => {
      controller.abort();
    };
  }, [activeChatId, task.id]);

  // Load models when tab CLI changes
  useEffect(() => {
    const cli = tabCli || settings?.agent_cli || task.project?.default_agent_cli || 'agy';
    let isCurrent = true;

    // Immediately show cached models for this CLI if available
    const cached = getCachedModels(cli);
    if (cached.length > 0) {
      setAvailableModels(cached);
    }

    getModels(cli)
      .then((data) => {
        if (!isCurrent || !Array.isArray(data) || data.length === 0) return;
        setAvailableModels(data);
        setCachedModels(cli, data);

        // Reconcile tabModel and tabEffort
        setTabModel((currModel) => {
          // If the user's current selection is already valid in data, PRESERVE IT!
          const isCurrValid = currModel && data.some((m) => m.id === currModel);
          const candidateModel = isCurrValid ? currModel : undefined;

          const resolved = resolveModelAndEffort(cli, data, candidateModel, tabEffort);

          setTabEffort(resolved.effort);
          if (resolved.modelId) {
            setCachedProviderPreference(cli, resolved.modelId, resolved.effort);
          }

          if (activeChatId) {
            setChats((prevChats) => {
              const currentChat = prevChats.find((c) => c.id === activeChatId);
              if (!currentChat) return prevChats;
              if (currentChat.model === resolved.modelId && currentChat.thinking_effort === resolved.effort) {
                return prevChats;
              }
              const nextChats = prevChats.map((c) =>
                c.id === activeChatId
                  ? { ...c, model: resolved.modelId, thinking_effort: resolved.effort }
                  : c
              );
              setCachedChats(task.id, nextChats);
              return nextChats;
            });
            updateChatSession(activeChatId, {
              model: resolved.modelId,
              thinking_effort: resolved.effort,
            }).catch(() => {});
          }

          return resolved.modelId;
        });
      })
      .catch(() => {});

    return () => {
      isCurrent = false;
    };
  }, [tabCli, activeChatId]);

  // Load custom skills
  useEffect(() => {
    let isCurrent = true;
    getSkills()
      .then((data) => {
        if (isCurrent && Array.isArray(data)) {
          setSkills(data);
        }
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [activeChatId]);

  // Click outside to dismiss skills popup
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        skillsPopupRef.current &&
        !skillsPopupRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowSkillsPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (showSkillsPopup && popupListRef.current) {
      const activeEl = popupListRef.current.children[selectedSkillIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedSkillIndex, showSkillsPopup]);

  // Check if slash command should trigger popup
  const checkSlashTrigger = (text: string, cursorIndex: number, currentSkills = skills) => {
    const textBeforeCursor = text.slice(0, cursorIndex);
    const slashIndex = textBeforeCursor.lastIndexOf('/');
    if (slashIndex === -1) {
      setShowSkillsPopup(false);
      setActiveSlashToken(null);
      return;
    }

    // Check if character before slash is start of string or whitespace
    if (slashIndex > 0 && !/\s/.test(text.charAt(slashIndex - 1))) {
      setShowSkillsPopup(false);
      setActiveSlashToken(null);
      return;
    }

    // Check if there are spaces between '/' and cursor
    const query = textBeforeCursor.slice(slashIndex + 1);
    if (/\s/.test(query)) {
      setShowSkillsPopup(false);
      setActiveSlashToken(null);
      return;
    }

    // Valid active slash token!
    setActiveSlashToken({ start: slashIndex, end: cursorIndex, query });
    const q = query.toLowerCase();
    const filtered = currentSkills.filter((s) => {
      return s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q));
    });
    setFilteredSkills(filtered);
    setSelectedSkillIndex(0);
    setShowSkillsPopup(true);
  };

  // Select a skill from the popup
  const selectSkill = (skill: AgentSkill) => {
    if (!activeSlashToken) return;
    const before = inputPrompt.slice(0, activeSlashToken.start);
    const after = inputPrompt.slice(activeSlashToken.end);
    const replacement = `/${skill.name} `;
    const nextVal = before + replacement + after;
    const newCursorPos = before.length + replacement.length;

    setInputPrompt(nextVal);
    setShowSkillsPopup(false);
    setActiveSlashToken(null);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // Listen to WebSocket messages
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const eventSessionId = msg.sessionId || msg.message?.session_id;

        if (msg.type === 'task_agent_status' && msg.sessionId) {
          const isIdle = msg.agentStatus === 'idle';
          setChats((prev) =>
            prev.map((c) => (c.id === msg.sessionId ? { ...c, status: isIdle ? 'idle' : 'running' } : c))
          );
          if (msg.sessionId === activeChatIdRef.current && isIdle) {
            setIsStreaming(false);
            isStreamingRef.current = false;
            setTimeout(() => {
              dispatchNextQueuedMessageRef.current?.(msg.sessionId);
            }, 60);
          }
        }

        if (eventSessionId && eventSessionId === activeChatId) {
          if (msg.type === 'message_saved') {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.message.id)) {
                return prev;
              }
              const next = [...prev, msg.message];
              setCachedMessages(eventSessionId, next);
              return next;
            });
          } else if (msg.type === 'chat_stream') {
            setIsStreaming(true);
            isStreamingRef.current = true;
            const fullContent = msg.fullContent;
            const deltaContent = msg.event?.content || '';

            setMessages((prev) => {
              // 1. Look for existing message with matching ID
              let existingIdx = prev.findIndex((m) => m.id === msg.messageId);

              // 2. If not found by ID, look for the last assistant message
              if (existingIdx === -1 && prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                existingIdx = prev.length - 1;
              }

              if (existingIdx !== -1) {
                const updated = [...prev];
                const target = updated[existingIdx];
                let nextContent = '';

                if (typeof fullContent === 'string') {
                  nextContent = fullContent;
                } else if (deltaContent) {
                  const currentText = target.content || '';
                  if (currentText.endsWith(deltaContent)) {
                    nextContent = currentText;
                  } else {
                    let overlap = 0;
                    const maxOverlap = Math.min(currentText.length, deltaContent.length);
                    for (let len = maxOverlap; len > 0; len--) {
                      if (currentText.endsWith(deltaContent.slice(0, len))) {
                        overlap = len;
                        break;
                      }
                    }
                    nextContent = currentText + deltaContent.slice(overlap);
                  }
                } else {
                  nextContent = target.content || '';
                }

                updated[existingIdx] = {
                  ...target,
                  id: msg.messageId || target.id,
                  content: nextContent,
                  steps: msg.steps || target.steps,
                };
                return updated;
              }

              // 3. If no assistant message exists yet, create one
              return [
                ...prev,
                {
                  id: msg.messageId || `assistant-${Date.now()}`,
                  session_id: eventSessionId,
                  role: 'assistant',
                  content: typeof fullContent === 'string' ? fullContent : deltaContent,
                  steps: msg.steps,
                  timestamp: Date.now(),
                },
              ];
            });
          } else if (msg.type === 'hitl_input_required') {
            if (msg.hitl) {
              setActiveHitl((prev) => ({
                ...prev,
                [msg.sessionId || eventSessionId]: msg.hitl,
              }));
            }
          } else if (msg.type === 'chat_turn_complete') {
            setIsStreaming(false);
            isStreamingRef.current = false;
            setStreamingChunk('');
            const targetSessionId = msg.sessionId || eventSessionId;
            setActiveHitl((prev) => {
              const copy = { ...prev };
              delete copy[targetSessionId];
              return copy;
            });
            setChats((prev) =>
              prev.map((c) => (c.id === targetSessionId ? { ...c, status: 'idle' } : c))
            );
            const cachedChats = getCachedChats(taskRef.current.id);
            if (cachedChats) {
              setCachedChats(
                taskRef.current.id,
                cachedChats.map((c) => (c.id === targetSessionId ? { ...c, status: 'idle' } : c))
              );
            }
            setMessages((prev) => {
              let existingIdx = prev.findIndex((m) => m.id === msg.message.id);
              if (existingIdx === -1 && prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                existingIdx = prev.length - 1;
              }
              let parsedSteps = msg.steps;
              if (!parsedSteps && msg.message.metadata) {
                try {
                  parsedSteps = JSON.parse(msg.message.metadata)?.steps;
                } catch {}
              }
              const messageWithSteps: ChatMessage = {
                ...msg.message,
                steps: parsedSteps,
              };
              let next: ChatMessage[];
              if (existingIdx !== -1) {
                const updated = [...prev];
                updated[existingIdx] = messageWithSteps;
                next = updated;
              } else {
                next = [...prev, messageWithSteps];
              }
              setCachedMessages(eventSessionId, next);
              return next;
            });

            // Automatically check and dispatch next message in queue
            setTimeout(() => {
              dispatchNextQueuedMessageRef.current?.(targetSessionId);
            }, 60);
          } else if (msg.type === 'aborted') {
            if (isSteeringRef.current) {
              isSteeringRef.current = false;
              return;
            }
            setIsStreaming(false);
            isStreamingRef.current = false;
            setStreamingChunk('');
            const targetSessionId = msg.sessionId || eventSessionId;
            setChats((prev) =>
              prev.map((c) => (c.id === targetSessionId ? { ...c, status: 'idle' } : c))
            );
            setActiveHitl((prev) => {
              const copy = { ...prev };
              delete copy[targetSessionId];
              return copy;
            });
            if (activeChatId) {
              getChatMessages(activeChatId).then((fresh) => {
                setMessages(fresh);
                setCachedMessages(activeChatId, fresh);
              }).catch(() => {});
            }
          }
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, activeChatId]);

  const handleCreateChat = async () => {
    const newTitle = `Chat ${chats.length + 1}`;
    const cliToUse = tabCli || settings?.agent_cli || 'agy';
    const cached = getCachedModels(cliToUse);
    const { modelId, effort } = resolveModelAndEffort(
      cliToUse,
      cached.length > 0 ? cached : availableModels,
      tabModel,
      tabEffort
    );

    const newId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    const optimisticChat: ChatSession = {
      id: newId,
      task_id: task.id,
      title: newTitle,
      agent_cli: cliToUse,
      model: modelId,
      thinking_effort: effort,
      status: 'idle',
      created_at: now,
      updated_at: now,
    };

    userSelectedCliRef.current = null;
    userSelectedModelRef.current = null;
    userSelectedEffortRef.current = null;
    lastSyncedChatIdRef.current = newId;
    pendingChatIdsRef.current.add(newId);

    const nextChats = [...chats, optimisticChat];
    setChats(nextChats);
    setMessages([]);
    setActiveChatId(newId);
    setCachedChats(task.id, nextChats);
    setCachedActiveChatId(task.id, newId);

    try {
      const created = await createChatSession(task.id, newTitle, cliToUse, modelId, effort, newId);
      pendingChatIdsRef.current.delete(newId);
      setChats((prev) => {
        const merged = prev.map((c) => (c.id === newId ? { ...c, ...created } : c));
        setCachedChats(task.id, merged);
        return merged;
      });
      const now = Date.now();
      const updatedTask = { ...task, updated_at: now };
      setCachedTask(updatedTask);
      window.dispatchEvent(new CustomEvent('task-updated', { detail: updatedTask }));
    } catch {
      pendingChatIdsRef.current.delete(newId);
      deleteCachedChat(task.id, newId);
      const remaining = chatsRef.current.filter((c) => c.id !== newId);
      setChats(remaining);
      setCachedChats(task.id, remaining);
      if (activeChatIdRef.current === newId) {
        const fallback = remaining[remaining.length - 1]?.id || null;
        setActiveChatId(fallback);
        if (fallback) setCachedActiveChatId(task.id, fallback);
      }
    }
  };

  const handleDeleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (chats.length <= 1) return;
    await deleteChatSession(id);
    deleteCachedChat(task.id, id);
    const nextChats = chats.filter((c) => c.id !== id);
    setChats(nextChats);
    setCachedChats(task.id, nextChats);
    if (activeChatId === id) {
      const nextActive = nextChats[0]?.id || null;
      setActiveChatId(nextActive);
      if (nextActive) {
        setCachedActiveChatId(task.id, nextActive);
      }
    }
  };

  const handleStartRename = (chat: ChatSession, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleSaveRename = async (id: string) => {
    const trimmed = editTitle.trim();
    setEditingChatId(null);
    if (!trimmed) return;
    const currentChat = chats.find((c) => c.id === id);
    if (currentChat && currentChat.title === trimmed) return;

    const nextChats = chats.map((c) => (c.id === id ? { ...c, title: trimmed } : c));
    setChats(nextChats);
    setCachedChats(task.id, nextChats);

    try {
      await updateChatSession(id, { title: trimmed });
    } catch {
      loadChats();
    }
  };

  const handleRenameKeyDown = (id: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingChatId(null);
    }
  };

  const handleCliChange = (newCli: string) => {
    userSelectedCliRef.current = newCli;
    setTabCli(newCli);

    // 1. Immediately load cached models for new CLI if available
    const cached = getCachedModels(newCli);
    if (cached.length > 0) {
      setAvailableModels(cached);
    }

    // 2. Resolve default/recommended model and effort for new CLI (ignoring old CLI's model)
    const { modelId: nextModel, effort: nextEffort } = resolveModelAndEffort(
      newCli,
      cached,
      undefined, // Do NOT use tabModel since it belongs to previous CLI!
      tabEffort
    );

    userSelectedModelRef.current = nextModel;
    userSelectedEffortRef.current = nextEffort;
    setTabModel(nextModel);
    setTabEffort(nextEffort);
    if (nextModel) {
      setCachedProviderPreference(newCli, nextModel, nextEffort);
    }

    // 3. Update the active chat in DB and state with new CLI and resolved model/effort
    if (activeChatId) {
      setChats((prevChats) => {
        const nextChats = prevChats.map((c) =>
          c.id === activeChatId
            ? { ...c, agent_cli: newCli, model: nextModel, thinking_effort: nextEffort }
            : c
        );
        setCachedChats(task.id, nextChats);
        return nextChats;
      });
      updateChatSession(activeChatId, {
        agent_cli: newCli,
        model: nextModel,
        thinking_effort: nextEffort,
      }).catch(() => {});
    }
  };

  const handleModelChange = (newModel: string) => {
    userSelectedModelRef.current = newModel;
    setTabModel(newModel);
    const found = availableModels.find((m) => m.id === newModel);
    let nextEffort = tabEffort;
    if (found?.reasoningEfforts && found.reasoningEfforts.length > 0) {
      if (!found.reasoningEfforts.map((s) => s.toLowerCase()).includes(tabEffort.toLowerCase())) {
        nextEffort = found.defaultEffort || found.reasoningEfforts[0] || 'medium';
        setTabEffort(nextEffort);
      }
    }
    userSelectedEffortRef.current = nextEffort;
    setCachedProviderPreference(tabCli, newModel, nextEffort);
    if (activeChatId) {
      setChats((prevChats) => {
        const nextChats = prevChats.map((c) =>
          c.id === activeChatId ? { ...c, model: newModel, thinking_effort: nextEffort } : c
        );
        setCachedChats(task.id, nextChats);
        return nextChats;
      });
      updateChatSession(activeChatId, { model: newModel, thinking_effort: nextEffort }).catch(() => {});
    }
  };

  const handleEffortChange = (newEffort: string) => {
    userSelectedEffortRef.current = newEffort;
    setTabEffort(newEffort);
    if (tabModel) {
      setCachedProviderPreference(tabCli, tabModel, newEffort);
    }
    if (activeChatId) {
      setChats((prevChats) => {
        const nextChats = prevChats.map((c) =>
          c.id === activeChatId ? { ...c, thinking_effort: newEffort } : c
        );
        setCachedChats(task.id, nextChats);
        return nextChats;
      });
      updateChatSession(activeChatId, { thinking_effort: newEffort }).catch(() => {});
    }
  };

  const globalCli = settings?.agent_cli || '';
  const globalModel = settings?.default_model || '';
  const globalEffort = settings?.thinking_effort || '';
  const isAlphaTab = tabCli?.toLowerCase() === 'alpha';
  const differsFromGlobal =
    !!globalCli &&
    (tabCli !== globalCli ||
      (!isAlphaTab &&
        ((!!globalModel && tabModel !== globalModel) ||
          (!!globalEffort && tabEffort.toLowerCase() !== globalEffort.toLowerCase()))));

  const handleResetToGlobal = () => {
    if (!globalCli) return;
    const nextModel = globalModel;
    const nextEffort = globalEffort || tabEffort;

    userSelectedCliRef.current = globalCli;
    userSelectedModelRef.current = nextModel;
    userSelectedEffortRef.current = nextEffort;
    setTabCli(globalCli);
    setTabModel(nextModel);
    setTabEffort(nextEffort);

    if (globalCli !== tabCli) {
      const cached = getCachedModels(globalCli);
      if (cached.length > 0) setAvailableModels(cached);
    }
    if (nextModel) {
      setCachedProviderPreference(globalCli, nextModel, nextEffort);
    }

    if (activeChatId) {
      setChats((prevChats) => {
        const nextChats = prevChats.map((c) =>
          c.id === activeChatId
            ? { ...c, agent_cli: globalCli, model: nextModel, thinking_effort: nextEffort }
            : c
        );
        setCachedChats(task.id, nextChats);
        return nextChats;
      });
      updateChatSession(activeChatId, {
        agent_cli: globalCli,
        model: nextModel,
        thinking_effort: nextEffort,
      }).catch(() => {});
    }
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    if (pendingAttachments.length + fileArray.length > 10) {
      setUploadError('Maximum 10 attachments per message.');
      return;
    }

    for (const file of fileArray) {
      if (file.size > 50 * 1024 * 1024) {
        setUploadError(`File "${file.name}" exceeds the 50MB limit.`);
        return;
      }
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const uploaded = await uploadTaskAttachments(task.id, fileArray);
      setPendingAttachments((prev) => [...prev, ...uploaded]);
      const now = Date.now();
      const updatedTask = { ...task, updated_at: now };
      setCachedTask(updatedTask);
      window.dispatchEvent(new CustomEvent('task-updated', { detail: updatedTask }));
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload attachment(s)');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleUploadFiles(e.clipboardData.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const dispatchMessage = useCallback(
    (
      promptText: string,
      msgAttachments?: FileAttachment[],
      cliOverride?: string,
      modelOverride?: string,
      effortOverride?: string,
      sessionIdOverride?: string
    ) => {
      const targetSessionId = sessionIdOverride || activeChatIdRef.current;
      if (!targetSessionId || !ws || ws.readyState !== WebSocket.OPEN) return;

      const newMsgId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const now = Date.now();
      const currentAttachments = msgAttachments ? [...msgAttachments] : [];

      const matchedActiveSkills = skills.filter((s) => {
        const textWithoutUrls = promptText.replace(/https?:\/\/[^\s]+/g, ' ');
        const regex = new RegExp(`(?:^|[\\s/])/${s.name}(?=[^\\w\\-]|$)`, 'i');
        return regex.test(textWithoutUrls);
      });

      const optimisticMetadata =
        matchedActiveSkills.length > 0 || currentAttachments.length > 0
          ? JSON.stringify({
              attachments: currentAttachments,
              skills: matchedActiveSkills.map((s) => ({
                name: s.name,
                description: s.description,
                content: s.content,
              })),
            })
          : undefined;

      const optimisticUserMessage: ChatMessage = {
        id: newMsgId,
        session_id: targetSessionId,
        role: 'user',
        content: promptText,
        metadata: optimisticMetadata,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        timestamp: now,
      };

      const optimisticAssistantMessage: ChatMessage = {
        id: `pending-${now}`,
        session_id: targetSessionId,
        role: 'assistant',
        content: '',
        timestamp: now + 1,
      };

      if (targetSessionId === activeChatIdRef.current) {
        setMessages((prev) => {
          const next = [...prev, optimisticUserMessage, optimisticAssistantMessage];
          setCachedMessages(targetSessionId, next);
          return next;
        });

        setIsStreaming(true);
        isStreamingRef.current = true;
        setStreamingChunk('');
        chatListRef.current?.scrollToBottom();
      } else {
        const cached = getCachedMessages(targetSessionId) || [];
        setCachedMessages(targetSessionId, [...cached, optimisticUserMessage, optimisticAssistantMessage]);
      }

      const effectiveCli = cliOverride || tabCli;
      let modelToSend = modelOverride || tabModel;
      let effortToSend = effortOverride || tabEffort;

      if (availableModels.length > 0) {
        const isValid = availableModels.some((m) => m.id === modelToSend);
        if (!isValid) {
          const resolved = resolveModelAndEffort(effectiveCli, availableModels, undefined, effortToSend);
          modelToSend = resolved.modelId;
          effortToSend = resolved.effort;
        }
      }

      try {
        ws.send(
          JSON.stringify({
            type: 'send_chat_message',
            sessionId: targetSessionId,
            messageId: newMsgId,
            prompt: promptText,
            attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
            agentCli: effectiveCli,
            model: modelToSend,
            thinkingEffort: effortToSend,
          })
        );
        const now = Date.now();
        if (task?.id) {
          const updatedTask = { ...task, updated_at: now, agent_status: 'WIP' as const };
          setCachedTask(updatedTask);
          window.dispatchEvent(new CustomEvent('task-updated', { detail: updatedTask }));
        }
      } catch (err) {
        console.error('Failed to send chat message:', err);
        if (targetSessionId === activeChatIdRef.current) {
          setIsStreaming(false);
          isStreamingRef.current = false;
        }
      }
    },
    [skills, tabCli, tabModel, tabEffort, availableModels, ws]
  );
  dispatchMessageRef.current = dispatchMessage;

  const isDispatchingQueuedRef = useRef(false);

  const dispatchNextQueuedMessage = useCallback(
    (explicitSessionId?: string) => {
      const targetSessionId = explicitSessionId || activeChatIdRef.current;
      if (!targetSessionId || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (isDispatchingQueuedRef.current) return;

      // Don't auto-dispatch if active chat is currently streaming or running
      if (
        targetSessionId === activeChatIdRef.current &&
        (isStreamingRef.current || chatsRef.current.find((c) => c.id === targetSessionId)?.status === 'running')
      ) {
        return;
      }

      // Get current queue from ref or cache
      let queue =
        targetSessionId === activeChatIdRef.current
          ? queuedMessagesRef.current
          : getCachedQueuedMessages(targetSessionId);

      if (!queue || queue.length === 0) {
        queue = getCachedQueuedMessages(targetSessionId);
      }
      if (!queue || queue.length === 0) return;

      const [nextItem, ...remaining] = queue;
      if (!nextItem) return;

      isDispatchingQueuedRef.current = true;

      // Update refs, state, and cache immediately
      queuedMessagesRef.current = remaining;
      if (targetSessionId === activeChatIdRef.current) {
        setQueuedMessages(remaining);
      }
      setCachedQueuedMessages(targetSessionId, remaining);
      setCachedTaskQueuedCount(taskRef.current.id, remaining.length);

      try {
        dispatchMessage(
          nextItem.prompt,
          nextItem.attachments,
          nextItem.agentCli,
          nextItem.model,
          nextItem.thinkingEffort,
          targetSessionId
        );
      } finally {
        setTimeout(() => {
          isDispatchingQueuedRef.current = false;
        }, 150);
      }
    },
    [ws, dispatchMessage]
  );
  dispatchNextQueuedMessageRef.current = dispatchNextQueuedMessage;

  // Auto-dispatch next queued message whenever the active chat is idle and has queued messages
  useEffect(() => {
    if (!isStreaming && activeChatId && queuedMessages.length > 0 && ws?.readyState === WebSocket.OPEN) {
      const timer = setTimeout(() => {
        dispatchNextQueuedMessage(activeChatId);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, activeChatId, queuedMessages.length, ws?.readyState, dispatchNextQueuedMessage]);

  // When WebSocket becomes open, trigger queued message check if idle
  useEffect(() => {
    if (!ws) return;
    const handleOpen = () => {
      if (!isStreamingRef.current && activeChatIdRef.current) {
        dispatchNextQueuedMessage(activeChatIdRef.current);
      }
    };
    if (ws.readyState === WebSocket.OPEN) {
      handleOpen();
    } else {
      ws.addEventListener('open', handleOpen);
      return () => ws.removeEventListener('open', handleOpen);
    }
  }, [ws, dispatchNextQueuedMessage]);

  // Auto-dispatch initial prompt if passed via router navigation state on task creation
  useEffect(() => {
    const initPrompt = (location.state as any)?.initialPrompt;
    if (
      !initPrompt ||
      typeof initPrompt !== 'string' ||
      !initPrompt.trim() ||
      !activeChatId ||
      initialPromptProcessedRef.current
    ) {
      return;
    }

    const sendInitialPrompt = () => {
      if (initialPromptProcessedRef.current) return;
      initialPromptProcessedRef.current = true;
      const promptToSend = initPrompt.trim();
      dispatchMessage(promptToSend, [], tabCli, tabModel, tabEffort, activeChatId);
      chatListRef.current?.scrollToBottom();
      navigate(location.pathname, { replace: true, state: { ...location.state, initialPrompt: undefined } });
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      sendInitialPrompt();
    } else if (ws) {
      const handleOpen = () => {
        sendInitialPrompt();
      };
      ws.addEventListener('open', handleOpen);
      return () => ws.removeEventListener('open', handleOpen);
    }
  }, [location.state, activeChatId, ws, tabCli, tabModel, tabEffort, dispatchMessage, navigate, location.pathname]);

  const handleSendMessage = () => {
    const hasText = Boolean(inputPrompt.trim());
    const hasAttachments = pendingAttachments.length > 0;
    if ((!hasText && !hasAttachments) || !activeChatId || !ws || isUploading) return;
    const prompt = inputPrompt.trim() || 'Please inspect the attached file(s).';

    // Request notification permission if still default on explicit user send action
    requestNotificationPermissionOnUserGesture();

    const isBusy =
      isStreamingRef.current ||
      chatsRef.current.find((c) => c.id === activeChatId)?.status === 'running';

    if (isBusy) {
      // Put message in a queue, send immediately after agent finish replying
      const queuedId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const newQueuedItem: QueuedMessage = {
        id: queuedId,
        sessionId: activeChatId,
        prompt,
        attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
        agentCli: tabCli,
        model: tabModel,
        thinkingEffort: tabEffort,
        createdAt: Date.now(),
      };

      const updated = [...queuedMessagesRef.current, newQueuedItem];
      queuedMessagesRef.current = updated;
      setQueuedMessages(updated);
      setCachedQueuedMessages(activeChatId, updated);
      setCachedTaskQueuedCount(task.id, updated.length);

      clearTaskDraft(task.id);
      setInputPrompt('');
      setPendingAttachments([]);
      setUploadError(null);
      return;
    }

    const currentAttachments = [...pendingAttachments];
    clearTaskDraft(task.id);
    setInputPrompt('');
    setPendingAttachments([]);
    setUploadError(null);

    dispatchMessage(prompt, currentAttachments, tabCli, tabModel, tabEffort);
    chatListRef.current?.scrollToBottom();
  };

  const handleSteer = useCallback(
    (item: QueuedMessage) => {
      if (!activeChatId || !ws) return;

      // 1. Remove this item from the queue
      const remaining = queuedMessagesRef.current.filter((m) => m.id !== item.id);
      queuedMessagesRef.current = remaining;
      setQueuedMessages(remaining);
      setCachedQueuedMessages(activeChatId, remaining);
      setCachedTaskQueuedCount(task.id, remaining.length);

      // 2. Set isSteering flag so the incoming 'aborted' broadcast from the cancelled turn is ignored
      isSteeringRef.current = true;

      // 3. Dispatch this message immediately
      dispatchMessage(item.prompt, item.attachments, item.agentCli, item.model, item.thinkingEffort, activeChatId);
      chatListRef.current?.scrollToBottom();
    },
    [activeChatId, ws, dispatchMessage, task.id]
  );

  const handleDeleteQueuedMessage = useCallback(
    (id: string) => {
      if (!activeChatId) return;
      const remaining = queuedMessagesRef.current.filter((item) => item.id !== id);
      queuedMessagesRef.current = remaining;
      setQueuedMessages(remaining);
      setCachedQueuedMessages(activeChatId, remaining);
      setCachedTaskQueuedCount(task.id, remaining.length);
    },
    [activeChatId, task.id]
  );

  const handleUpdateQueuedPrompt = useCallback(
    (id: string, newPrompt: string) => {
      if (!activeChatId) return;
      const updated = queuedMessagesRef.current.map((item) => (item.id === id ? { ...item, prompt: newPrompt } : item));
      queuedMessagesRef.current = updated;
      setQueuedMessages(updated);
      setCachedQueuedMessages(activeChatId, updated);
    },
    [activeChatId]
  );

  const handleAbort = useCallback(() => {
    if (!ws || !activeChatId) return;
    isSteeringRef.current = false;
    ws.send(JSON.stringify({ type: 'abort', sessionId: activeChatId }));
    setIsStreaming(false);
    setStreamingChunk('');
  }, [ws, activeChatId]);

  const handleSwitchCliAndRetry = useCallback(async (targetCli: string, userPrompt: string, failedAssistantMsgId: string) => {
    if (!activeChatId || !ws || isStreaming) return;

    // 1. Remove the failed assistant message from DB and local state
    try {
      await deleteChatMessage(failedAssistantMsgId);
    } catch {}

    const remainingMessages = messages.filter((m) => m.id !== failedAssistantMsgId);

    // 2. Resolve default model and effort for targetCli
    let targetModels = getCachedModels(targetCli) || [];
    if (targetModels.length === 0) {
      try {
        targetModels = await getModels(targetCli);
        setCachedModels(targetCli, targetModels);
      } catch {}
    }

    const { modelId: newModel, effort: newEffort } = resolveModelAndEffort(targetCli, targetModels);

    // 3. Update tab state and session in DB
    setTabCli(targetCli);
    setTabModel(newModel);
    setTabEffort(newEffort);
    setAvailableModels(targetModels);

    try {
      await updateChatSession(activeChatId, {
        agent_cli: targetCli,
        model: newModel,
        thinking_effort: newEffort,
      });
      setCachedProviderPreference(targetCli, newModel, newEffort);
    } catch {}

    // 4. Send message with the new CLI immediately
    const effectivePrompt =
      userPrompt ||
      (remainingMessages.length > 0 && remainingMessages[remainingMessages.length - 1].role === 'user'
        ? remainingMessages[remainingMessages.length - 1].content
        : '');

    const now = Date.now();
    const optimisticAssistantMessage: ChatMessage = {
      id: `pending-${now}`,
      session_id: activeChatId,
      role: 'assistant',
      content: '',
      timestamp: now + 1,
    };

    const nextMessages = [...remainingMessages, optimisticAssistantMessage];
    setMessages(nextMessages);
    setCachedMessages(activeChatId, nextMessages);
    setIsStreaming(true);
    setStreamingChunk('');
    chatListRef.current?.scrollToBottom();

    ws.send(
      JSON.stringify({
        type: 'send_chat_message',
        sessionId: activeChatId,
        messageId:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        prompt: effectivePrompt || 'Continue with this task.',
        agentCli: targetCli,
        model: newModel,
        thinkingEffort: newEffort,
      })
    );
  }, [activeChatId, ws, isStreaming, messages]);

  const handleRetryPrompt = useCallback(
    async (userPrompt: string, failedAssistantMsgId: string) => {
      if (!activeChatId || !ws || isStreaming) return;

      // 1. Remove the failed assistant message from DB and local state
      try {
        await deleteChatMessage(failedAssistantMsgId);
      } catch {}

      const remainingMessages = messages.filter((m) => m.id !== failedAssistantMsgId);

      // 2. Use current agent CLI and model
      const currentCliToUse = tabCli || settings?.agent_cli || 'claude';
      const currentModelToUse = tabModel;
      const currentEffortToUse = tabEffort;

      // 3. Resolve effective prompt
      const effectivePrompt =
        userPrompt ||
        (remainingMessages.length > 0 && remainingMessages[remainingMessages.length - 1].role === 'user'
          ? remainingMessages[remainingMessages.length - 1].content
          : '');

      const now = Date.now();
      const optimisticAssistantMessage: ChatMessage = {
        id: `pending-${now}`,
        session_id: activeChatId,
        role: 'assistant',
        content: '',
        timestamp: now + 1,
      };

      const nextMessages = [...remainingMessages, optimisticAssistantMessage];
      setMessages(nextMessages);
      setCachedMessages(activeChatId, nextMessages);
      setIsStreaming(true);
      setStreamingChunk('');
      chatListRef.current?.scrollToBottom();

      ws.send(
        JSON.stringify({
          type: 'send_chat_message',
          sessionId: activeChatId,
          messageId:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          prompt: effectivePrompt || 'Continue with this task.',
          agentCli: currentCliToUse,
          model: currentModelToUse,
          thinkingEffort: currentEffortToUse,
        })
      );
    },
    [activeChatId, ws, isStreaming, messages, tabCli, settings?.agent_cli, tabModel, tabEffort]
  );

  const handleOpenSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSkillsPopup && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev + 1) % filteredSkills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredSkills[selectedSkillIndex]) {
          selectSkill(filteredSkills[selectedSkillIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSkillsPopup(false);
        return;
      }
    }

    if (showConfig && e.key === 'Escape') {
      e.preventDefault();
      setShowConfig(false);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent min-w-0 overflow-hidden">
      {/* Top Header: Tabs + Quick Action Buttons */}
      <div className="h-11 px-3 border-b border-cozy-border bg-cozy-surface flex items-center justify-between shrink-0 select-none gap-2">
        {/* Chat Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar flex-1 mr-2 touch-pan-x">
          {chats.length === 0 && loadingChats ? (
            <div className="flex items-center gap-1.5 py-1">
              <div className="w-20 h-6 rounded-lg bg-cozy-subtle animate-pulse" />
              <div className="w-16 h-6 rounded-lg bg-cozy-subtle/60 animate-pulse" />
            </div>
          ) : (
            chats.map((c) => {
            const isActive = c.id === activeChatId;
            const isEditing = editingChatId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors border shrink-0 ${
                  isActive
                    ? 'bg-cozy-subtle dark:bg-[#282828] text-cozy-text border-cozy-border font-medium'
                    : 'bg-transparent border-transparent text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/50'
                }`}
              >
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleSaveRename(c.id)}
                    onKeyDown={(e) => handleRenameKeyDown(c.id, e)}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-cozy-surface text-cozy-text border border-teal-500 rounded-md px-1.5 py-0.5 text-xs outline-none w-24"
                    autoFocus
                  />
                ) : (
                  <>
                    <span
                      className="truncate max-w-[90px] sm:max-w-[120px]"
                      onDoubleClick={(e) => handleStartRename(c, e)}
                      title="Double-click to rename"
                    >
                      {c.title}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(c, e)}
                      className="p-0.5 rounded text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-cozy-text transition-opacity"
                      title="Rename chat"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {chats.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteChat(c.id, e)}
                        className="p-0.5 rounded text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                        title="Close chat"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          }))}
          <button
            onClick={handleCreateChat}
            className="w-6 h-6 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle flex items-center justify-center transition-colors shrink-0"
            title="Open new chat agent tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Desktop Action Buttons: Scripts & Submit */}
        <div className="hidden sm:flex items-center space-x-1.5 shrink-0">
          {onOpenScripts && (
            <button
              onClick={onOpenScripts}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium bg-cozy-subtle border border-cozy-border text-cozy-text hover:bg-cozy-subtle/80 transition-colors"
              title="Run project scripts or custom terminal commands"
            >
              <Terminal className="w-3.5 h-3.5 text-teal-500" />
              <span>Scripts</span>
            </button>
          )}

          <button
            onClick={onOpenSubmit}
            disabled={submitDisabled}
            className="h-7 flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-teal-500 hover:bg-teal-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-teal-500"
            title={submitDisabled ? 'No changes to commit or push' : 'Submit changes: commit and push'}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Submit</span>
          </button>

          {onTogglePreview && (
            <button
              type="button"
              onClick={onTogglePreview}
              className={`hidden min-[1200px]:flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                isPreviewOpen
                  ? 'bg-teal-500/10 border-teal-500/30 text-teal-600 dark:text-teal-400 font-medium'
                  : 'bg-cozy-subtle hover:bg-cozy-subtle/80 border-cozy-border text-cozy-muted hover:text-cozy-text'
              }`}
              title={isPreviewOpen ? 'Hide preview pane' : 'Open preview pane'}
            >
              <Globe className="w-3.5 h-3.5 text-teal-500" />
              <span>Preview</span>
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  isDevRunning
                    ? 'bg-emerald-500'
                    : 'bg-zinc-400/50'
                }`}
                title={isDevRunning ? 'Dev server is running' : 'Dev server is offline'}
              />
            </button>
          )}
        </div>

        {/* Mobile Dropdown Action Menu */}
        <div className="relative sm:hidden shrink-0" ref={mobileActionsRef}>
          <button
            type="button"
            onClick={() => setShowMobileActionsMenu((prev) => !prev)}
            className="p-1.5 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border border-cozy-border/60 transition-colors"
            title="Task actions"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMobileActionsMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl popup-surface bg-white dark:bg-[#1a1d2e] py-1.5 z-30 flex flex-col text-xs overflow-hidden">
              {onOpenScripts && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileActionsMenu(false);
                    onOpenScripts();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cozy-subtle text-cozy-text transition-colors"
                >
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span>Scripts</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowMobileActionsMenu(false);
                  onOpenSubmit();
                }}
                disabled={submitDisabled}
                className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cozy-subtle text-sky-400 transition-colors font-medium border-t border-cozy-border/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Submit Changes</span>
              </button>
              {onDeleteTask && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileActionsMenu(false);
                    onDeleteTask();
                  }}
                  disabled={isDeletingTask}
                  className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-red-500/10 text-red-500 transition-colors font-medium border-t border-cozy-border/40 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  <span>Delete Task</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      {loadingChats && messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {/* User message skeleton */}
          <div className="flex items-start gap-3 justify-end">
            <div className="w-2/5 rounded-2xl p-4 bg-teal-500/10 border border-teal-500/20 animate-pulse space-y-2">
              <div className="h-3.5 bg-teal-500/20 rounded w-4/5" />
              <div className="h-3 bg-teal-500/15 rounded w-1/2" />
            </div>
            <div className="w-8 h-8 rounded-full bg-teal-500/20 animate-pulse shrink-0" />
          </div>

          {/* Assistant message skeleton */}
          <div className="flex items-start gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-cozy-subtle animate-pulse shrink-0" />
            <div className="w-3/5 rounded-2xl p-4 bg-cozy-subtle/70 border border-cozy-border/60 animate-pulse space-y-2.5">
              <div className="h-3.5 bg-cozy-muted/20 rounded w-5/6" />
              <div className="h-3.5 bg-cozy-muted/20 rounded w-full" />
              <div className="h-3.5 bg-cozy-muted/15 rounded w-3/4" />
              <div className="h-3 bg-cozy-muted/15 rounded w-2/5 pt-1" />
            </div>
          </div>

          {/* Second User message skeleton */}
          <div className="flex items-start gap-3 justify-end">
            <div className="w-1/3 rounded-2xl p-4 bg-teal-500/10 border border-teal-500/20 animate-pulse space-y-2">
              <div className="h-3.5 bg-teal-500/20 rounded w-3/4" />
            </div>
            <div className="w-8 h-8 rounded-full bg-teal-500/20 animate-pulse shrink-0" />
          </div>
        </div>
      ) : (
        <ChatMessageList
          ref={chatListRef}
          messages={messages}
          isSyncing={(syncingChats || syncingActiveChat) && messages.length > 0}
          liveStreamingChunk={streamingChunk}
          isStreaming={isStreaming}
          taskId={task.id}
          sessionId={activeChatId || undefined}
          clis={clis}
          currentCli={tabCli || settings?.agent_cli || 'codex'}
          activeHitl={activeChatId ? activeHitl[activeChatId] : null}
          onHitlSubmitted={() => {
            if (activeChatId) {
              setActiveHitl((prev) => {
                const copy = { ...prev };
                delete copy[activeChatId];
                return copy;
              });
            }
          }}
          onRetryPrompt={handleRetryPrompt}
          onSwitchCliAndRetry={handleSwitchCliAndRetry}
          onOpenSettings={handleOpenSettings}
          onAbort={handleAbort}
        />
      )}
      {/* Input Area */}
      <div
        className="relative w-full pb-3 pt-1 px-3 sm:px-4 bg-transparent shrink-0"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="max-w-3xl lg:max-w-4xl mx-auto w-full relative">
          {/* Floating Queue Drawer */}
          <ChatQueueDrawer
            queue={queuedMessages}
            onSteer={handleSteer}
            onDelete={handleDeleteQueuedMessage}
            onUpdatePrompt={handleUpdateQueuedPrompt}
          />

          {/* Drag and Drop Overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-40 m-2 rounded-2.5xl bg-teal-500/15 backdrop-blur-md border-2 border-dashed border-teal-400 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150 pointer-events-none">
              <div className="p-3.5 rounded-2xl bg-cozy-surface shadow-xl text-teal-500 mb-2 border border-teal-400/30">
                <UploadCloud className="w-8 h-8 animate-bounce text-teal-500" />
              </div>
              <p className="text-sm font-semibold text-cozy-text">Drop files to attach to this message</p>
              <p className="text-xs text-cozy-muted mt-1">Images, code, documents up to 50MB (max 10 files)</p>
            </div>
          )}
          {/* Hidden File Picker Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleUploadFiles(e.target.files);
              }
            }}
          />

          {/* Upload Error Banner */}
          {uploadError && (
            <div className="mb-2 p-2 px-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-500 text-xs flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="p-1 hover:bg-red-500/20 rounded-md transition-colors"
                title="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Editor Box */}
          <div className="relative flex flex-col rounded-3xl bg-cozy-surface dark:bg-[#2f2f2f] border border-cozy-border focus-within:border-cozy-muted/60 shadow-sm transition-all p-3">
          {/* Skills Autocompletion Popup */}
          {showSkillsPopup && (
            <div
              ref={skillsPopupRef}
              className="absolute bottom-full left-0 right-0 mb-2.5 rounded-2xl popup-surface bg-white dark:bg-[#0c1322] overflow-hidden z-30 transition-all border border-cozy-border/60"
            >
              <div className="px-3.5 py-2.5 bg-cozy-subtle/70 border-b border-cozy-border/50 flex items-center justify-between text-xs text-cozy-muted">
                <div className="flex items-center space-x-2 font-medium text-cozy-text">
                  <Sparkles className="w-4 h-4 text-teal-500" />
                  <span>Custom Skills</span>
                </div>
                <div className="text-[11px] text-cozy-muted">
                  {filteredSkills.length} available
                </div>
              </div>

              <div ref={popupListRef} className="max-h-60 overflow-y-auto py-1 px-1.5 space-y-0.5">
                {filteredSkills.length > 0 ? (
                  filteredSkills.map((skill, idx) => {
                    const isSelected = idx === selectedSkillIndex;
                    return (
                      <div
                        key={skill.id || `${skill.name}-${idx}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSkill(skill);
                        }}
                        onMouseEnter={() => setSelectedSkillIndex(idx)}
                        className={`px-3 py-2 cursor-pointer transition-all rounded-xl flex items-center justify-between gap-2.5 ${
                          isSelected
                            ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 font-medium'
                            : 'hover:bg-cozy-subtle/60 text-cozy-muted hover:text-cozy-text'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 bg-cozy-subtle border border-cozy-border/60">
                            <Sparkles className="w-3.5 h-3.5 text-teal-500" />
                          </div>
                          <span className={`font-mono text-xs font-semibold flex-shrink-0 ${isSelected ? 'text-teal-600 dark:text-teal-400' : 'text-cozy-text'}`}>
                            /{skill.name}
                          </span>
                          {skill.description && (
                            <span className="text-xs text-cozy-muted truncate">
                              {skill.description}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-center text-xs text-cozy-muted">
                    {skills.length === 0 ? (
                      <span>No custom skills configured yet. Add skills in Settings to use them here.</span>
                    ) : (
                      <span>No skills found matching <span className="font-mono text-cozy-text">/{activeSlashToken?.query}</span></span>
                    )}
                  </div>
                )}
              </div>

              <div className="px-3.5 py-2 bg-cozy-subtle/50 border-t border-cozy-border/50 text-[11px] text-cozy-muted/80 flex items-center justify-between">
                <span><kbd className="font-mono px-1.5 py-0.5 bg-cozy-surface rounded-md border border-cozy-border/60 text-[10px]">↑↓</kbd> Navigate</span>
                <span><kbd className="font-mono px-1.5 py-0.5 bg-cozy-surface rounded-md border border-cozy-border/60 text-[10px]">Tab</kbd> / <kbd className="font-mono px-1.5 py-0.5 bg-cozy-surface rounded-md border border-cozy-border/60 text-[10px]">Enter</kbd> Select</span>
                <span><kbd className="font-mono px-1.5 py-0.5 bg-cozy-surface rounded-md border border-cozy-border/60 text-[10px]">Esc</kbd> Dismiss</span>
              </div>
            </div>
          )}

          {/* Pending Attachments List */}
          {(pendingAttachments.length > 0 || isUploading) && (
            <div className="mb-2 flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin">
              {pendingAttachments.map((att) => {
                const isImg = isImageAttachment(att);
                return (
                  <div
                    key={att.id}
                    className="group relative flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-xl bg-cozy-subtle border border-cozy-border/80 shadow-soft-sm text-xs text-cozy-text shrink-0 max-w-[220px]"
                  >
                    {isImg ? (
                      <img
                        src={att.url}
                        alt={att.name}
                        className="w-7 h-7 object-cover rounded-lg border border-cozy-border shrink-0 bg-black/10"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-cozy-surface border border-cozy-border flex items-center justify-center text-teal-500 shrink-0">
                        {getFileIcon(att, 'w-3.5 h-3.5')}
                      </div>
                    )}
                    <div className="flex flex-col min-w-0 pr-1">
                      <span className="font-medium truncate text-[11px] leading-tight">
                        {att.name}
                      </span>
                      <span className="text-[10px] text-cozy-muted font-mono leading-tight">
                        {formatFileSize(att.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="p-1 rounded-md text-cozy-muted hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0 ml-auto"
                      title="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              {isUploading && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-teal-500/10 border border-teal-400/30 text-teal-600 dark:text-teal-400 text-xs shrink-0 animate-pulse font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading...</span>
                </div>
              )}
            </div>
          )}

          {/* Editor Textarea */}
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={(e) => {
              const val = e.target.value;
              setInputPrompt(val);
              checkSlashTrigger(val, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const target = e.target as HTMLTextAreaElement;
              checkSlashTrigger(target.value, target.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isStreaming
                ? `Queue message for ${tabCli || 'AI agent'} on ${task.branch}... (Press Enter to queue)`
                : `Message ${tabCli || 'AI agent'} on ${task.branch}... (Type / for skills, Enter to send)`
            }
            rows={2}
            className="w-full bg-transparent border-0 text-sm text-cozy-text placeholder-cozy-muted/60 resize-none focus:outline-none px-2 py-1 leading-relaxed min-h-[48px] max-h-48"
          />

          {/* Bottom Toolbar: Model switch on left, Attachment & Send buttons on right */}
          <div className="flex items-center justify-between gap-2 pt-1.5 px-0.5">
            {/* Model Switch - Bottom Left */}
            <div className="relative shrink-0 min-w-0">
              <button
                ref={configBtnRef}
                type="button"
                onClick={() => setShowConfig((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-colors group max-w-full min-w-0 ${
                  showConfig
                    ? 'bg-cozy-subtle border-cozy-border text-cozy-text'
                    : 'bg-transparent hover:bg-cozy-subtle border-transparent hover:border-cozy-border text-cozy-muted hover:text-cozy-text'
                }`}
                title={tabCli?.toLowerCase() === 'alpha' ? 'Click to configure agent' : 'Click to configure agent, model, and reasoning effort'}
              >
                <Sliders className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                <span className="font-semibold text-cozy-text shrink-0">{tabCli || 'agy'}</span>
                {tabCli?.toLowerCase() !== 'alpha' && (
                  <>
                    <span className="text-cozy-muted/40 shrink-0">·</span>
                    <span className="truncate max-w-[120px] sm:max-w-[180px]">
                      {availableModels.find((m) => m.id === tabModel)?.name || tabModel || 'Default'}
                    </span>
                    {tabEffort && (
                      <>
                        <span className="text-cozy-muted/40 shrink-0">·</span>
                        <span className="text-cozy-muted capitalize shrink-0">{tabEffort}</span>
                      </>
                    )}
                  </>
                )}
                <ChevronDown className={`w-3 h-3 text-cozy-muted ml-0.5 transition-transform shrink-0 ${showConfig ? 'rotate-180 text-cozy-text' : ''}`} />
              </button>

              {/* Model / Agent Config Popover */}
              {showConfig && (
                <div
                  ref={configRef}
                  className="absolute bottom-full left-0 mb-2 p-3.5 rounded-2xl popup-surface bg-white dark:bg-[#1f1f1f] border border-cozy-border shadow-xl z-30 transition-all space-y-2.5 min-w-[280px] sm:min-w-[360px] max-w-[calc(100vw-3rem)]"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-cozy-border/50 text-[11px] font-medium text-cozy-muted">
                    <span className="flex items-center gap-2 text-cozy-text font-semibold">
                      <Sliders className="w-3.5 h-3.5 text-teal-500" />
                      {tabCli?.toLowerCase() === 'alpha' ? 'Agent Configuration' : 'Agent & Model Configuration'}
                    </span>
                    <div className="flex items-center gap-1">
                      {differsFromGlobal && (
                        <button
                          type="button"
                          onClick={handleResetToGlobal}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-cozy-muted hover:text-teal-600 hover:bg-cozy-subtle transition-colors text-[11px]"
                          title={`Reset to global default (${[globalCli, globalModel, globalEffort].filter(Boolean).join(' · ')})`}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset to default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowConfig(false)}
                        className="p-1 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors text-xs"
                        title="Close configuration"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 text-xs text-cozy-muted pt-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-cozy-text shrink-0">Agent:</span>
                      <select
                        value={tabCli}
                        onChange={(e) => handleCliChange(e.target.value)}
                        className="bg-cozy-surface border border-cozy-border/80 rounded-full pl-3 pr-8 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400 cursor-pointer"
                      >
                        {clis.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}{' '}
                            {!c.available &&
                              (c.isCloudProvider || c.name === 'alpha'
                                ? '(setup needed)'
                                : '(not found)')}
                          </option>
                        ))}
                      </select>
                    </div>

                    {tabCli?.toLowerCase() !== 'alpha' && (
                      <>
                        <div className="flex items-center space-x-2 flex-1 min-w-[160px]">
                          <span className="font-medium text-cozy-text shrink-0">Model:</span>
                          <select
                            value={tabModel}
                            onChange={(e) => handleModelChange(e.target.value)}
                            disabled={availableModels.length === 0}
                            className="w-full bg-cozy-surface border border-cozy-border/80 rounded-full pl-3 pr-8 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400 truncate disabled:opacity-60 cursor-pointer"
                          >
                            {availableModels.length === 0 ? (
                              <option value={tabModel || ''}>
                                {tabModel || 'Loading models...'}
                              </option>
                            ) : (
                              availableModels.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))
                            )}
                          </select>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <span className="font-medium text-cozy-text shrink-0">Effort:</span>
                          <select
                            value={tabEffort}
                            onChange={(e) => handleEffortChange(e.target.value)}
                            className="bg-cozy-surface border border-cozy-border/80 rounded-full pl-3 pr-8 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400 capitalize cursor-pointer"
                          >
                            {(() => {
                              const current = availableModels.find((m) => m.id === tabModel);
                              const efforts = current?.reasoningEfforts && current.reasoningEfforts.length > 0
                                ? current.reasoningEfforts
                                : ['none', 'low', 'medium', 'high', 'max'];
                              return efforts.map((eff) => (
                                <option key={eff} value={eff}>
                                  {eff.charAt(0).toUpperCase() + eff.slice(1)}
                                </option>
                              ));
                            })()}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Right: Attachment Button + Send / Stop Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Paperclip Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-8 h-8 rounded-full text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle flex items-center justify-center transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
                title="Attach files (images, code, documents) or paste with Cmd/Ctrl+V"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Send / Abort Buttons */}
              {isStreaming ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleAbort}
                    className="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-xs"
                    title="Stop generation"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>

                  {(Boolean(inputPrompt.trim()) || pendingAttachments.length > 0) && (
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      disabled={isUploading}
                      className="w-8 h-8 rounded-full bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-sm animate-in fade-in duration-150"
                      title="Queue message (will send after agent finishes reply)"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={(!inputPrompt.trim() && pendingAttachments.length === 0) || isUploading}
                  className="w-8 h-8 rounded-full bg-cozy-text text-cozy-bg hover:opacity-90 disabled:opacity-20 flex items-center justify-center transition-all shrink-0 cursor-pointer"
                  title="Send message"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
