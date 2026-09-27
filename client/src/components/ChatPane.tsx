import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, X, Send, Square, GitMerge, UploadCloud, Sliders, ChevronDown, ChevronUp, Pencil,
  Terminal, Sparkles, MessageSquareQuote, Target, Clock, Globe, ListTodo, HelpCircle, BookOpen, Layers, MoreVertical,
  Paperclip, Loader2, AlertCircle
} from 'lucide-react';
import { Task, ChatSession, ChatMessage, Settings, CliInfo, ModelOption, AgentSkill, FileAttachment } from '../types';
import { ChatMessageList } from './ChatMessageList';
import { getTaskChats, createChatSession, updateChatSession, deleteChatSession, getChatMessages, getModels, getSkills, uploadTaskAttachments } from '../api';
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
} from '../cache';

interface ChatPaneProps {
  task: Task;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
  onOpenRebase: () => void;
  onOpenSubmit: () => void;
  onOpenScripts?: () => void;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  task,
  settings,
  clis,
  ws,
  onOpenRebase,
  onOpenSubmit,
  onOpenScripts,
}) => {
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
      const customEvent = e as CustomEvent<FileAttachment[]>;
      if (customEvent.detail && Array.isArray(customEvent.detail) && customEvent.detail.length > 0) {
        setPendingAttachments((prev) => [...prev, ...customEvent.detail]);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 80);
      }
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

  useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChatId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      setTabCli(currentChat.agent_cli || settings?.agent_cli || 'agy');
      setTabModel(currentChat.model || settings?.default_model || '');
      setTabEffort(currentChat.thinking_effort || settings?.thinking_effort || 'medium');
      if (currentChat.status === 'running') {
        setIsStreaming(true);
      } else {
        setIsStreaming(false);
      }
    }
  }, [activeChatId, chats, settings]);

  // Load messages when active chat changes (instant cached + revalidate in background)
  useEffect(() => {
    if (!activeChatId) return;
    setCachedActiveChatId(task.id, activeChatId);

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
    getModels(cli).then(setAvailableModels).catch(() => {});
  }, [tabCli, settings?.agent_cli]);

  // Load skills for current agent CLI
  useEffect(() => {
    const cli = tabCli || settings?.agent_cli || 'agy';
    let isCurrent = true;
    getSkills(cli, task.worktree_path, task.id)
      .then((data) => {
        if (isCurrent && Array.isArray(data)) {
          setSkills(data);
        }
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [tabCli, task.id, task.worktree_path, settings?.agent_cli]);

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
                  timestamp: Date.now(),
                },
              ];
            });
          } else if (msg.type === 'chat_turn_complete') {
            setIsStreaming(false);
            setStreamingChunk('');
            setMessages((prev) => {
              let existingIdx = prev.findIndex((m) => m.id === msg.message.id);
              if (existingIdx === -1 && prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                existingIdx = prev.length - 1;
              }
              let next: ChatMessage[];
              if (existingIdx !== -1) {
                const updated = [...prev];
                updated[existingIdx] = msg.message;
                next = updated;
              } else {
                next = [...prev, msg.message];
              }
              setCachedMessages(eventSessionId, next);
              return next;
            });
          } else if (msg.type === 'aborted') {
            setIsStreaming(false);
            setStreamingChunk('');
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

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingChunk]);

  const handleCreateChat = async () => {
    const newTitle = `Chat ${chats.length + 1}`;
    const newChat = await createChatSession(
      task.id,
      newTitle,
      tabCli || settings?.agent_cli,
      tabModel || settings?.default_model,
      tabEffort || settings?.thinking_effort
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
    if (activeChatId) {
      const nextChats = chats.map((c) => (c.id === activeChatId ? { ...c, agent_cli: newCli } : c));
      setChats(nextChats);
      setCachedChats(task.id, nextChats);
      updateChatSession(activeChatId, { agent_cli: newCli }).catch(() => {});
    }
  };

  const handleModelChange = (newModel: string) => {
    setTabModel(newModel);
    const found = availableModels.find((m) => m.id === newModel);
    let nextEffort = tabEffort;
    if (found?.reasoningEfforts && found.reasoningEfforts.length > 0) {
      if (!found.reasoningEfforts.map((s) => s.toLowerCase()).includes(tabEffort.toLowerCase())) {
        nextEffort = found.defaultEffort || found.reasoningEfforts[0];
        setTabEffort(nextEffort);
      }
    }
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

  const handleSendMessage = () => {
    const hasText = Boolean(inputPrompt.trim());
    const hasAttachments = pendingAttachments.length > 0;
    if ((!hasText && !hasAttachments) || !activeChatId || !ws || isStreaming || isUploading) return;
    const prompt = inputPrompt.trim() || 'Please inspect the attached file(s).';
    const newMsgId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();

    const currentAttachments = [...pendingAttachments];

    const optimisticUserMessage: ChatMessage = {
      id: newMsgId,
      session_id: activeChatId,
      role: 'user',
      content: prompt,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      timestamp: now,
    };

    const optimisticAssistantMessage: ChatMessage = {
      id: `pending-${now}`,
      session_id: activeChatId,
      role: 'assistant',
      content: '',
      timestamp: now + 1,
    };

    const updatedMessages = [...messages, optimisticUserMessage, optimisticAssistantMessage];
    setMessages(updatedMessages);
    setCachedMessages(activeChatId, updatedMessages);
    setInputPrompt('');
    setPendingAttachments([]);
    setUploadError(null);
    setIsStreaming(true);
    setStreamingChunk('');

    ws.send(
      JSON.stringify({
        type: 'send_chat_message',
        sessionId: activeChatId,
        messageId: newMsgId,
        prompt,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        agentCli: tabCli,
        model: tabModel,
        thinkingEffort: tabEffort,
      })
    );
  };

  const handleAbort = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'abort', sessionId: activeChatId }));
    setIsStreaming(false);
    setStreamingChunk('');
  };

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

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent min-w-0 overflow-hidden">
      {/* Top Header: Tabs + Quick Action Buttons */}
      <div className="min-h-[64px] py-3.5 px-4 sm:px-5 border-b border-cozy-border/50 bg-cozy-surface/40 backdrop-blur-md flex items-center justify-between shrink-0 select-none gap-3">
        {/* Chat Tabs */}
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar flex-1 mr-2 touch-pan-x">
          {chats.map((c) => {
            const isActive = c.id === activeChatId;
            const isEditing = editingChatId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`group flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all border shrink-0 ${
                  isActive
                    ? 'bg-teal-500/10 border-teal-400/40 text-teal-600 dark:text-teal-400 shadow-soft-sm font-semibold'
                    : 'bg-cozy-subtle/50 border-transparent text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/80'
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
                    className="bg-cozy-surface text-cozy-text border border-teal-400 rounded-full px-2 py-0.5 text-xs outline-none w-24"
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
                      className="p-0.5 rounded text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-teal-500 transition-opacity"
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
            className="w-7 h-7 rounded-full text-cozy-muted hover:text-teal-500 bg-cozy-subtle/60 hover:bg-cozy-subtle border border-cozy-border/50 flex items-center justify-center transition-all shrink-0"
            title="Open new chat agent tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Desktop Action Buttons: Scripts, Sync/Rebase & Submit */}
        <div className="hidden sm:flex items-center space-x-2 shrink-0">
          {onOpenScripts && (
            <button
              onClick={onOpenScripts}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle/80 border border-cozy-border/70 text-cozy-text hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-400 transition-all shadow-soft-sm"
              title="Run project scripts or custom terminal commands"
            >
              <Terminal className="w-3.5 h-3.5 text-teal-500" />
              <span>Scripts</span>
            </button>
          )}

          <button
            onClick={onOpenRebase}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 transition-all shadow-soft-sm"
            title="Rebase branch and resolve conflicts"
          >
            <GitMerge className="w-3.5 h-3.5 text-amber-500" />
            <span>Rebase</span>
          </button>

          <button
            onClick={onOpenSubmit}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-teal-500 hover:bg-teal-600 text-white transition-all shadow-glow-ocean"
            title="Submit changes: commit and push"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Submit</span>
          </button>
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
            <div className="absolute right-0 top-full mt-1.5 w-44 rounded-2xl popup-surface bg-white dark:bg-[#1a1d2e] py-1.5 z-30 flex flex-col text-xs overflow-hidden">
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
      />
      <div ref={messagesEndRef} />
      {/* Input Area */}
      <div
        className="relative p-4 sm:p-5 border-t border-cozy-border/50 bg-cozy-surface/50 backdrop-blur-md"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
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
        {/* Agent / Model / Effort Selector (collapsible above editor) */}
        {showConfig ? (
          <div className="mb-3 p-3.5 rounded-2xl bg-cozy-subtle/90 border border-cozy-border/80 shadow-soft-sm transition-all space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-cozy-border/50 text-[11px] font-medium text-cozy-muted">
              <span className="flex items-center gap-2 text-cozy-text font-semibold">
                <Sliders className="w-3.5 h-3.5 text-teal-500" />
                Agent & Model Configuration
              </span>
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface transition-colors text-xs"
                title="Collapse configuration"
              >
                <span>Collapse</span>
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-cozy-muted pt-0.5">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-cozy-text shrink-0">Agent:</span>
                <select
                  value={tabCli}
                  onChange={(e) => handleCliChange(e.target.value)}
                  className="bg-cozy-surface border border-cozy-border/80 rounded-full px-3 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400"
                >
                  {clis.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} {!c.available && '(not found)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2 flex-1 min-w-[200px]">
                <span className="font-medium text-cozy-text shrink-0">Model:</span>
                <select
                  value={tabModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full bg-cozy-surface border border-cozy-border/80 rounded-full px-3 py-1 text-cozy-text text-xs focus:outline-none focus:border-teal-400 truncate"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
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
                    const efforts = current?.reasoningEfforts || ['none', 'low', 'medium', 'high', 'max'];
                    return efforts.map((eff) => (
                      <option key={eff} value={eff}>
                        {eff.charAt(0).toUpperCase() + eff.slice(1)}
                      </option>
                    ));
                  })()}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-2.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowConfig(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border/70 hover:border-teal-400/40 text-cozy-muted hover:text-cozy-text shadow-soft-sm transition-all group max-w-full min-w-0"
              title="Click to configure agent, model, and reasoning effort"
            >
              <Sliders className="w-3.5 h-3.5 text-teal-500 shrink-0" />
              <span className="font-semibold text-teal-600 dark:text-teal-400 shrink-0">{tabCli || 'agy'}</span>
              <span className="text-cozy-muted/50 shrink-0">·</span>
              <span className="truncate max-w-[130px] sm:max-w-[220px]">
                {availableModels.find((m) => m.id === tabModel)?.name || tabModel || 'Default Model'}
              </span>
              {tabEffort && (
                <>
                  <span className="text-cozy-muted/50">·</span>
                  <span className="text-cozy-muted capitalize">{tabEffort}</span>
                </>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-cozy-muted group-hover:text-teal-500 ml-0.5 transition-transform" />
            </button>
          </div>
        )}

        {/* Upload Error Banner */}
        {uploadError && (
          <div className="mb-2.5 p-2 px-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-500 text-xs flex items-center justify-between">
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

        {/* Pending Attachments List */}
        {(pendingAttachments.length > 0 || isUploading) && (
          <div className="mb-2.5 flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin">
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

        <div className="relative flex items-end rounded-2xl bg-cozy-surface/90 dark:bg-slate-900/80 border border-cozy-border/80 focus-within:border-teal-400/60 focus-within:ring-2 focus-within:ring-teal-400/20 shadow-soft-sm transition-all p-2.5">
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

          {/* Paperclip Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || isUploading}
            className="p-2 mb-0.5 rounded-xl text-cozy-muted hover:text-teal-500 hover:bg-cozy-subtle transition-colors disabled:opacity-40 shrink-0"
            title="Attach files (images, code, documents) or paste with Cmd/Ctrl+V"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Skills Autocompletion Popup */}
          {showSkillsPopup && (
            <div
              ref={skillsPopupRef}
              className="absolute bottom-full left-0 right-0 mb-2.5 rounded-2xl popup-surface bg-white dark:bg-[#0c1322] overflow-hidden z-30 transition-all border border-cozy-border/60"
            >
              <div className="px-3.5 py-2.5 bg-cozy-subtle/70 border-b border-cozy-border/50 flex items-center justify-between text-xs text-cozy-muted">
                <div className="flex items-center space-x-2 font-medium text-cozy-text">
                  <Sparkles className="w-4 h-4 text-teal-500" />
                  <span>Skills & Commands for <span className="text-teal-600 dark:text-teal-400 font-semibold uppercase font-mono">{tabCli || 'agy'}</span></span>
                </div>
                <div className="text-[11px] text-cozy-muted">
                  {filteredSkills.length} available
                </div>
              </div>

              <div ref={popupListRef} className="max-h-60 overflow-y-auto py-1 px-1.5 space-y-0.5">
                {filteredSkills.length > 0 ? (
                  filteredSkills.map((skill, idx) => {
                    const isSelected = idx === selectedSkillIndex;
                    const getSkillIcon = () => {
                      switch (skill.name) {
                        case 'btw':
                          return <MessageSquareQuote className="w-3.5 h-3.5 text-sky-400" />;
                        case 'goal':
                          return <Target className="w-3.5 h-3.5 text-amber-400" />;
                        case 'schedule':
                          return <Clock className="w-3.5 h-3.5 text-emerald-400" />;
                        case 'browser':
                          return <Globe className="w-3.5 h-3.5 text-indigo-400" />;
                        case 'plan':
                          return <ListTodo className="w-3.5 h-3.5 text-blue-400" />;
                        case 'grill-me':
                          return <HelpCircle className="w-3.5 h-3.5 text-teal-400" />;
                        case 'learn':
                          return <BookOpen className="w-3.5 h-3.5 text-amber-400" />;
                        case 'review':
                          return <Sparkles className="w-3.5 h-3.5 text-teal-400" />;
                        default:
                          if (skill.source === 'workspace') {
                            return <Layers className="w-3.5 h-3.5 text-emerald-400" />;
                          }
                          return <Terminal className="w-3.5 h-3.5 text-teal-400" />;
                      }
                    };

                    return (
                      <div
                        key={`${skill.name}-${skill.source}`}
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
                            {getSkillIcon()}
                          </div>
                          <span className={`font-mono text-xs font-semibold flex-shrink-0 ${isSelected ? 'text-teal-600 dark:text-teal-400' : 'text-cozy-text'}`}>
                            {skill.name}
                          </span>
                          {skill.description && (
                            <span className="text-xs text-cozy-muted truncate">
                              {skill.description}
                            </span>
                          )}
                        </div>
                        {skill.source === 'workspace' && (
                          <span className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 flex-shrink-0">
                            workspace
                          </span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-center text-xs text-cozy-muted">
                    No skills found matching <span className="font-mono text-cozy-text">/{activeSlashToken?.query}</span>
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
            placeholder={`Message ${tabCli || 'AI agent'} on ${task.branch}... (Type / for skills, Enter to send)`}
            rows={2}
            className="flex-1 bg-transparent border-0 text-sm text-cozy-text placeholder-cozy-muted/60 resize-none focus:outline-none px-2 py-1 leading-relaxed"
          />

          <div className="flex items-center space-x-1.5 pl-2 pb-0.5">
            {isStreaming ? (
              <button
                onClick={handleAbort}
                className="p-2.5 rounded-full bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-all"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSendMessage}
                disabled={(!inputPrompt.trim() && pendingAttachments.length === 0) || isUploading}
                className="p-2.5 rounded-full bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-35 disabled:hover:bg-teal-500 transition-all shadow-glow-ocean"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-cozy-muted/70 px-1">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            Branch: <span className="text-cozy-text font-medium">{task.branch}</span>
          </span>
          <span>Base: <span className="text-cozy-muted font-medium">{task.base_branch}</span></span>
        </div>
      </div>
    </div>
  );
};
