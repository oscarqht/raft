import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, X, Send, Square, GitMerge, UploadCloud, Sliders, ChevronDown, ChevronUp, Pencil,
  Terminal, Sparkles, MessageSquareQuote, Target, Clock, Globe, ListTodo, HelpCircle, BookOpen, Layers, MoreVertical,
  Paperclip, Loader2, AlertCircle, Trash2, ArrowUp
} from 'lucide-react';
import { Task, ChatSession, ChatMessage, Settings, CliInfo, ModelOption, AgentSkill, FileAttachment, AlphaHitlPayload, QueuedMessage } from '../types';
import { ChatMessageList } from './ChatMessageList';
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
  deleteCachedChat,
  getCachedModels,
  setCachedModels,
  getCachedProviderPreference,
  setCachedProviderPreference,
  resolveModelAndEffort,
  getCachedQueuedMessages,
  setCachedQueuedMessages,
} from '../cache';

interface ChatPaneProps {
  task: Task;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
  onOpenRebase: () => void;
  onOpenSubmit: () => void;
  onOpenScripts?: () => void;
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
  onOpenRebase,
  onOpenSubmit,
  onOpenScripts,
  onDeleteTask,
  isDeletingTask,
  isPreviewOpen = false,
  onTogglePreview,
  isDevRunning = false,
}) => {
  const navigate = useNavigate();
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

  const [inputPrompt, setInputPrompt] = useState('');
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
  activeChatIdRef.current = activeChatId;

  const isSteeringRef = useRef(false);
  const dispatchMessageRef = useRef<
    | ((
        promptText: string,
        msgAttachments?: FileAttachment[],
        cliOverride?: string,
        modelOverride?: string,
        effortOverride?: string
      ) => void)
    | null
  >(null);

  // Tab overrides
  const [tabCli, setTabCli] = useState<string>('');
  const [tabModel, setTabModel] = useState<string>('');
  const [tabEffort, setTabEffort] = useState<string>('');

  // Tab rename state
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Mobile actions dropdown menu state
  const [showMobileActionsMenu, setShowMobileActionsMenu] = useState(false);

  // Attachments state
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileActionsRef = useRef<HTMLDivElement>(null);

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

  // Load chat sessions
  const loadChats = async () => {
    try {
      const data = await getTaskChats(task.id);
      setChats(data);
      setCachedChats(task.id, data);
      if (data.length > 0) {
        setActiveChatId((curr) => {
          if (curr && data.some((c) => c.id === curr)) {
            setCachedActiveChatId(task.id, curr);
            return curr;
          }
          const nextActive = data[0].id;
          setCachedActiveChatId(task.id, nextActive);
          return nextActive;
        });
      }
    } catch {}
  };

  useEffect(() => {
    loadChats();
  }, [task.id]);

  // Sync tab overrides when active chat or chats change
  useEffect(() => {
    if (!activeChatId) return;
    const currentChat = chats.find((c) => c.id === activeChatId);
    if (currentChat) {
      const cli = currentChat.agent_cli || settings?.agent_cli || 'agy';
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
        setTabModel(currentChat.model || settings?.default_model || '');
        setTabEffort(currentChat.thinking_effort || settings?.thinking_effort || 'medium');
      }

      if (currentChat.status === 'running') {
        setIsStreaming(true);
      } else {
        setIsStreaming(false);
      }
    }
  }, [activeChatId, chats, settings]);

  // Load messages and queued messages when active chat changes (instant cached + revalidate in background)
  useEffect(() => {
    if (!activeChatId) return;
    setCachedActiveChatId(task.id, activeChatId);
    setQueuedMessages(getCachedQueuedMessages(activeChatId));

    // If cached messages exist for this chat, display immediately
    const cached = getCachedMessages(activeChatId);
    if (cached && cached.length > 0) {
      setMessages(cached);
    }

    getChatMessages(activeChatId).then((fresh) => {
      setMessages(fresh);
      setCachedMessages(activeChatId, fresh);
    }).catch(() => {});
  }, [activeChatId, task.id]);

  // Load models when tab CLI changes
  useEffect(() => {
    const cli = tabCli || settings?.agent_cli || 'agy';
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
          const currentChat = chats.find((c) => c.id === activeChatId);
          const isCurrValid = currModel && data.some((m) => m.id === currModel);
          const isChatModelValid = currentChat?.model && data.some((m) => m.id === currentChat.model);
          const candidateModel = isCurrValid ? currModel : isChatModelValid ? currentChat?.model : undefined;

          const resolved = resolveModelAndEffort(cli, data, candidateModel, tabEffort);

          setTabEffort(resolved.effort);
          if (resolved.modelId) {
            setCachedProviderPreference(cli, resolved.modelId, resolved.effort);
          }

          if (
            activeChatId &&
            currentChat &&
            (currentChat.model !== resolved.modelId || currentChat.thinking_effort !== resolved.effort)
          ) {
            const nextChats = chats.map((c) =>
              c.id === activeChatId
                ? { ...c, model: resolved.modelId, thinking_effort: resolved.effort }
                : c
            );
            setChats(nextChats);
            setCachedChats(task.id, nextChats);
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
  }, [tabCli, settings?.agent_cli, activeChatId]);

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
            setStreamingChunk('');
            setActiveHitl((prev) => {
              const copy = { ...prev };
              delete copy[msg.sessionId || eventSessionId];
              return copy;
            });
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
            const targetSessionId = msg.sessionId || eventSessionId;
            const currentQueue = queuedMessagesRef.current;
            if (currentQueue && currentQueue.length > 0 && targetSessionId === activeChatIdRef.current) {
              const [nextItem, ...remaining] = currentQueue;
              setQueuedMessages(remaining);
              setCachedQueuedMessages(targetSessionId, remaining);
              setTimeout(() => {
                dispatchMessageRef.current?.(
                  nextItem.prompt,
                  nextItem.attachments,
                  nextItem.agentCli,
                  nextItem.model,
                  nextItem.thinkingEffort
                );
              }, 60);
            }
          } else if (msg.type === 'aborted') {
            if (isSteeringRef.current) {
              isSteeringRef.current = false;
              return;
            }
            setIsStreaming(false);
            setStreamingChunk('');
            setActiveHitl((prev) => {
              const copy = { ...prev };
              delete copy[msg.sessionId || eventSessionId];
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

    const newChat = await createChatSession(
      task.id,
      newTitle,
      cliToUse,
      modelId,
      effort
    );
    const nextChats = [...chats, newChat];
    setChats(nextChats);
    setActiveChatId(newChat.id);
    setCachedChats(task.id, nextChats);
    setCachedActiveChatId(task.id, newChat.id);
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

    setTabModel(nextModel);
    setTabEffort(nextEffort);
    if (nextModel) {
      setCachedProviderPreference(newCli, nextModel, nextEffort);
    }

    // 3. Update the active chat in DB and state with new CLI and resolved model/effort
    if (activeChatId) {
      const nextChats = chats.map((c) =>
        c.id === activeChatId
          ? { ...c, agent_cli: newCli, model: nextModel, thinking_effort: nextEffort }
          : c
      );
      setChats(nextChats);
      setCachedChats(task.id, nextChats);
      updateChatSession(activeChatId, {
        agent_cli: newCli,
        model: nextModel,
        thinking_effort: nextEffort,
      }).catch(() => {});
    }

    // 4. Fetch fresh models for new CLI from API
    getModels(newCli)
      .then((fresh) => {
        if (Array.isArray(fresh) && fresh.length > 0) {
          setAvailableModels(fresh);
          setCachedModels(newCli, fresh);
          const resolved = resolveModelAndEffort(newCli, fresh, nextModel, nextEffort);
          setTabModel(resolved.modelId);
          setTabEffort(resolved.effort);
          if (resolved.modelId) {
            setCachedProviderPreference(newCli, resolved.modelId, resolved.effort);
          }

          if (activeChatId && (resolved.modelId !== nextModel || resolved.effort !== nextEffort)) {
            const updatedChats = chats.map((c) =>
              c.id === activeChatId
                ? { ...c, model: resolved.modelId, thinking_effort: resolved.effort }
                : c
            );
            setChats(updatedChats);
            setCachedChats(task.id, updatedChats);
            updateChatSession(activeChatId, {
              model: resolved.modelId,
              thinking_effort: resolved.effort,
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  };

  const handleModelChange = (newModel: string) => {
    setTabModel(newModel);
    const found = availableModels.find((m) => m.id === newModel);
    let nextEffort = tabEffort;
    if (found?.reasoningEfforts && found.reasoningEfforts.length > 0) {
      if (!found.reasoningEfforts.map((s) => s.toLowerCase()).includes(tabEffort.toLowerCase())) {
        nextEffort = found.defaultEffort || found.reasoningEfforts[0] || 'medium';
        setTabEffort(nextEffort);
      }
    }
    setCachedProviderPreference(tabCli, newModel, nextEffort);
    if (activeChatId) {
      const nextChats = chats.map((c) =>
        c.id === activeChatId ? { ...c, model: newModel, thinking_effort: nextEffort } : c
      );
      setChats(nextChats);
      setCachedChats(task.id, nextChats);
      updateChatSession(activeChatId, { model: newModel, thinking_effort: nextEffort }).catch(() => {});
    }
  };

  const handleEffortChange = (newEffort: string) => {
    setTabEffort(newEffort);
    if (tabModel) {
      setCachedProviderPreference(tabCli, tabModel, newEffort);
    }
    if (activeChatId) {
      const nextChats = chats.map((c) =>
        c.id === activeChatId ? { ...c, thinking_effort: newEffort } : c
      );
      setChats(nextChats);
      setCachedChats(task.id, nextChats);
      updateChatSession(activeChatId, { thinking_effort: newEffort }).catch(() => {});
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
      effortOverride?: string
    ) => {
      const targetSessionId = activeChatIdRef.current;
      if (!targetSessionId || !ws) return;

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

      setMessages((prev) => {
        const next = [...prev, optimisticUserMessage, optimisticAssistantMessage];
        setCachedMessages(targetSessionId, next);
        return next;
      });

      setIsStreaming(true);
      setStreamingChunk('');

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
    },
    [skills, tabCli, tabModel, tabEffort, availableModels, ws]
  );
  dispatchMessageRef.current = dispatchMessage;

  const handleSendMessage = () => {
    const hasText = Boolean(inputPrompt.trim());
    const hasAttachments = pendingAttachments.length > 0;
    if ((!hasText && !hasAttachments) || !activeChatId || !ws || isUploading) return;
    const prompt = inputPrompt.trim() || 'Please inspect the attached file(s).';

    if (isStreaming) {
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

      setQueuedMessages((prev) => {
        const updated = [...prev, newQueuedItem];
        setCachedQueuedMessages(activeChatId, updated);
        return updated;
      });

      setInputPrompt('');
      setPendingAttachments([]);
      setUploadError(null);
      return;
    }

    const currentAttachments = [...pendingAttachments];
    setInputPrompt('');
    setPendingAttachments([]);
    setUploadError(null);

    dispatchMessage(prompt, currentAttachments, tabCli, tabModel, tabEffort);
  };

  const handleSteer = useCallback(
    (item: QueuedMessage) => {
      if (!activeChatId || !ws) return;

      // 1. Remove this item from the queue
      setQueuedMessages((prev) => {
        const remaining = prev.filter((m) => m.id !== item.id);
        setCachedQueuedMessages(activeChatId, remaining);
        return remaining;
      });

      // 2. Set isSteering flag so the incoming 'aborted' broadcast from the cancelled turn is ignored
      isSteeringRef.current = true;

      // 3. Dispatch this message immediately
      dispatchMessage(item.prompt, item.attachments, item.agentCli, item.model, item.thinkingEffort);
    },
    [activeChatId, ws, dispatchMessage]
  );

  const handleDeleteQueuedMessage = useCallback(
    (id: string) => {
      if (!activeChatId) return;
      setQueuedMessages((prev) => {
        const updated = prev.filter((item) => item.id !== id);
        setCachedQueuedMessages(activeChatId, updated);
        return updated;
      });
    },
    [activeChatId]
  );

  const handleUpdateQueuedPrompt = useCallback(
    (id: string, newPrompt: string) => {
      if (!activeChatId) return;
      setQueuedMessages((prev) => {
        const updated = prev.map((item) => (item.id === id ? { ...item, prompt: newPrompt } : item));
        setCachedQueuedMessages(activeChatId, updated);
        return updated;
      });
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

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent min-w-0 overflow-hidden">
      {/* Top Header: Tabs + Quick Action Buttons */}
      <div className="h-11 px-3 border-b border-cozy-border bg-cozy-surface flex items-center justify-between shrink-0 select-none gap-2">
        {/* Chat Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar flex-1 mr-2 touch-pan-x">
          {chats.map((c) => {
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
          })}
          <button
            onClick={handleCreateChat}
            className="w-6 h-6 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle flex items-center justify-center transition-colors shrink-0"
            title="Open new chat agent tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Desktop Action Buttons: Scripts, Sync/Rebase & Submit */}
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
            onClick={onOpenRebase}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 transition-colors"
            title="Rebase branch and resolve conflicts"
          >
            <GitMerge className="w-3.5 h-3.5 text-amber-500" />
            <span>Rebase</span>
          </button>

          <button
            onClick={onOpenSubmit}
            className="h-7 flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-teal-500 hover:bg-teal-600 text-white transition-colors"
            title="Submit changes: commit and push"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Submit</span>
          </button>

          {onTogglePreview && (
            <button
              type="button"
              onClick={onTogglePreview}
              className={`h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
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
              {onTogglePreview && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileActionsMenu(false);
                    onTogglePreview();
                  }}
                  className="flex items-center justify-between px-3 py-2 text-left hover:bg-cozy-subtle text-cozy-text transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-3.5 h-3.5 text-teal-500" />
                    <span>{isPreviewOpen ? 'Hide Preview' : 'Show Preview'}</span>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isDevRunning ? 'bg-emerald-400 shadow-glow-mint' : 'bg-zinc-400/40'
                    }`}
                  />
                </button>
              )}
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
                  onOpenRebase();
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cozy-subtle text-cozy-text transition-colors"
              >
                <GitMerge className="w-3.5 h-3.5 text-amber-400" />
                <span>Rebase Branch</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMobileActionsMenu(false);
                  onOpenSubmit();
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cozy-subtle text-sky-400 transition-colors font-medium border-t border-cozy-border/40"
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
      <ChatMessageList
        messages={messages}
        liveStreamingChunk={streamingChunk}
        isStreaming={isStreaming}
        taskId={task.id}
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
                    <button
                      type="button"
                      onClick={() => setShowConfig(false)}
                      className="p-1 rounded-md text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors text-xs"
                      title="Close configuration"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 text-xs text-cozy-muted pt-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-cozy-text shrink-0">Agent:</span>
                      <select
                        value={tabCli}
                        onChange={(e) => handleCliChange(e.target.value)}
                        className="bg-cozy-surface border border-cozy-border/80 rounded-full px-3 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400"
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
                            className="w-full bg-cozy-surface border border-cozy-border/80 rounded-full px-3 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400 truncate disabled:opacity-60"
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
                            className="bg-cozy-surface border border-cozy-border/80 rounded-full px-3 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400 capitalize"
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
