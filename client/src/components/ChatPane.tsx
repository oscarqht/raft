import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, X, Send, Square, GitMerge, UploadCloud, Sliders, ChevronDown, ChevronUp, Pencil,
  Terminal, Sparkles, MessageSquareQuote, Target, Clock, Globe, ListTodo, HelpCircle, BookOpen, Layers
} from 'lucide-react';
import { Task, ChatSession, ChatMessage, Settings, CliInfo, ModelOption, AgentSkill } from '../types';
import { ChatMessageList } from './ChatMessageList';
import { getTaskChats, createChatSession, updateChatSession, deleteChatSession, getChatMessages, getModels, getSkills } from '../api';
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

  const handleSendMessage = () => {
    if (!inputPrompt.trim() || !activeChatId || !ws || isStreaming) return;
    const prompt = inputPrompt.trim();
    const newMsgId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();

    const optimisticUserMessage: ChatMessage = {
      id: newMsgId,
      session_id: activeChatId,
      role: 'user',
      content: prompt,
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
    setIsStreaming(true);
    setStreamingChunk('');

    ws.send(
      JSON.stringify({
        type: 'send_chat_message',
        sessionId: activeChatId,
        messageId: newMsgId,
        prompt,
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
    <div className="flex-1 flex flex-col h-full bg-cozy-bg border-r border-cozy-border min-w-0 overflow-hidden">
      {/* Top Header: Tabs + Quick Action Buttons */}
      <div className="h-11 border-b border-cozy-border bg-cozy-surface/60 px-3 flex items-center justify-between shrink-0 select-none">
        {/* Chat Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar flex-1 mr-2">
          {chats.map((c) => {
            const isActive = c.id === activeChatId;
            const isEditing = editingChatId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-cozy-subtle border-cozy-border text-cozy-text shadow-sm'
                    : 'bg-transparent border-transparent text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle/40'
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
                    className="bg-cozy-surface text-cozy-text border border-sky-500 rounded px-1.5 py-0.5 text-xs outline-none w-24"
                    autoFocus
                  />
                ) : (
                  <>
                    <span
                      className="truncate max-w-[110px]"
                      onDoubleClick={(e) => handleStartRename(c, e)}
                      title="Double-click to rename"
                    >
                      {c.title}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(c, e)}
                      className="p-0.5 rounded text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-sky-400 transition-opacity"
                      title="Rename chat"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {chats.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteChat(c.id, e)}
                        className="p-0.5 rounded text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
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
            className="p-1 rounded-lg text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle transition-colors"
            title="Open new chat agent tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Action Buttons: Scripts, Sync/Rebase & Submit */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {onOpenScripts && (
            <button
              onClick={onOpenScripts}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-cozy-subtle border border-cozy-border text-cozy-text hover:border-sky-500/40 hover:text-sky-300 transition-all shadow-sm"
              title="Run project scripts or custom terminal commands"
            >
              <Terminal className="w-3.5 h-3.5 text-sky-400" />
              <span>Scripts</span>
            </button>
          )}

          <button
            onClick={onOpenRebase}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-cozy-subtle border border-cozy-border text-cozy-text hover:border-amber-500/40 hover:text-amber-300 transition-all shadow-sm"
            title="Rebase branch and resolve conflicts"
          >
            <GitMerge className="w-3.5 h-3.5 text-amber-400" />
            <span>Rebase</span>
          </button>

          <button
            onClick={onOpenSubmit}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
            title="Submit changes: commit and push"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Submit</span>
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <ChatMessageList
        messages={messages}
        liveStreamingChunk={streamingChunk}
        isStreaming={isStreaming}
      />
      <div ref={messagesEndRef} />

      {/* Input Area */}
      <div className="p-3 border-t border-cozy-border bg-cozy-surface/60">
        {/* Agent / Model / Effort Selector (collapsible above editor) */}
        {showConfig ? (
          <div className="mb-2.5 p-2.5 rounded-xl bg-cozy-subtle border border-cozy-border/80 shadow-sm transition-all space-y-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-cozy-border/50 text-[11px] font-medium text-cozy-muted">
              <span className="flex items-center gap-1.5 text-cozy-text font-semibold">
                <Sliders className="w-3.5 h-3.5 text-sky-400" />
                Agent & Model Configuration
              </span>
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-cozy-muted hover:text-cozy-text hover:bg-cozy-surface transition-colors text-xs"
                title="Collapse configuration"
              >
                <span>Collapse</span>
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-cozy-muted pt-0.5">
              <div className="flex items-center space-x-1.5">
                <span className="font-medium text-cozy-text shrink-0">Agent:</span>
                <select
                  value={tabCli}
                  onChange={(e) => handleCliChange(e.target.value)}
                  className="bg-cozy-surface border border-cozy-border rounded-lg px-2 py-1 text-cozy-text text-xs focus:outline-none focus:border-sky-500"
                >
                  {clis.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} {!c.available && '(not found)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-1.5 flex-1 min-w-[200px]">
                <span className="font-medium text-cozy-text shrink-0">Model:</span>
                <select
                  value={tabModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full bg-cozy-surface border border-cozy-border rounded-lg px-2 py-1 text-cozy-text text-xs focus:outline-none focus:border-sky-500 truncate"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-1.5 shrink-0">
                <span className="font-medium text-cozy-text shrink-0">Effort:</span>
                <select
                  value={tabEffort}
                  onChange={(e) => handleEffortChange(e.target.value)}
                  className="bg-cozy-surface border border-cozy-border rounded-lg px-2 py-1 text-cozy-text text-xs focus:outline-none focus:border-sky-500 capitalize"
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
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowConfig(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-cozy-subtle/80 hover:bg-cozy-subtle border border-cozy-border hover:border-cozy-border-hover text-cozy-muted hover:text-cozy-text transition-all group"
              title="Click to configure agent, model, and reasoning effort"
            >
              <Sliders className="w-3 h-3 text-sky-400/80" />
              <span className="font-medium text-cozy-text">{tabCli || 'agy'}</span>
              <span className="text-cozy-muted/50">·</span>
              <span className="truncate max-w-[220px]">
                {availableModels.find((m) => m.id === tabModel)?.name || tabModel || 'Default Model'}
              </span>
              {tabEffort && (
                <>
                  <span className="text-cozy-muted/50">·</span>
                  <span className="text-cozy-muted capitalize">{tabEffort}</span>
                </>
              )}
              <ChevronDown className="w-3 h-3 text-cozy-muted group-hover:text-cozy-text ml-0.5 transition-transform" />
            </button>
          </div>
        )}
        <div className="relative flex items-end rounded-xl bg-cozy-subtle border border-cozy-border focus-within:border-sky-500/50 shadow-sm transition-all p-2">
          {/* Skills Autocompletion Popup */}
          {showSkillsPopup && (
            <div
              ref={skillsPopupRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-cozy-surface/95 backdrop-blur border border-cozy-border rounded-xl shadow-2xl overflow-hidden z-30 transition-all"
            >
              <div className="px-3 py-2 bg-cozy-subtle/80 border-b border-cozy-border flex items-center justify-between text-xs text-cozy-muted">
                <div className="flex items-center space-x-1.5 font-medium text-cozy-text">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Skills & Commands for <span className="text-sky-400 uppercase font-mono">{tabCli || 'agy'}</span></span>
                </div>
                <div className="text-[11px] text-cozy-muted">
                  {filteredSkills.length} available
                </div>
              </div>

              <div ref={popupListRef} className="max-h-60 overflow-y-auto py-1 px-1">
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
                          return <HelpCircle className="w-3.5 h-3.5 text-violet-400" />;
                        case 'learn':
                          return <BookOpen className="w-3.5 h-3.5 text-amber-300" />;
                        case 'review':
                          return <Sparkles className="w-3.5 h-3.5 text-cyan-400" />;
                        default:
                          if (skill.source === 'workspace') {
                            return <Layers className="w-3.5 h-3.5 text-emerald-400" />;
                          }
                          return <Terminal className="w-3.5 h-3.5 text-sky-400" />;
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
                        className={`px-2.5 py-1.5 cursor-pointer transition-colors rounded-lg flex items-center justify-between gap-2.5 ${
                          isSelected
                            ? 'bg-sky-500/15 text-cozy-text'
                            : 'hover:bg-cozy-subtle/50 text-cozy-muted hover:text-cozy-text'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-cozy-bg/80 border border-cozy-border/50">
                            {getSkillIcon()}
                          </div>
                          <span className={`font-mono text-xs font-semibold flex-shrink-0 ${isSelected ? 'text-sky-400' : 'text-cozy-text'}`}>
                            {skill.name}
                          </span>
                          {skill.description && (
                            <span className="text-xs text-cozy-muted/80 truncate">
                              {skill.description}
                            </span>
                          )}
                        </div>
                        {skill.source === 'workspace' && (
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex-shrink-0">
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

              <div className="px-3 py-1.5 bg-cozy-subtle/50 border-t border-cozy-border text-[11px] text-cozy-muted/70 flex items-center justify-between">
                <span><kbd className="font-mono px-1 py-0.5 bg-cozy-bg rounded border border-cozy-border text-[10px]">↑↓</kbd> Navigate</span>
                <span><kbd className="font-mono px-1 py-0.5 bg-cozy-bg rounded border border-cozy-border text-[10px]">Tab</kbd> / <kbd className="font-mono px-1 py-0.5 bg-cozy-bg rounded border border-cozy-border text-[10px]">Enter</kbd> Select</span>
                <span><kbd className="font-mono px-1 py-0.5 bg-cozy-bg rounded border border-cozy-border text-[10px]">Esc</kbd> Dismiss</span>
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
            placeholder={`Message ${tabCli || 'AI agent'} on ${task.branch}... (Type / for skills, Enter to send)`}
            rows={2}
            className="flex-1 bg-transparent border-0 text-sm text-cozy-text placeholder-cozy-muted/60 resize-none focus:outline-none px-2 py-1"
          />

          <div className="flex items-center space-x-1.5 pl-2">
            {isStreaming ? (
              <button
                onClick={handleAbort}
                className="p-2 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSendMessage}
                disabled={!inputPrompt.trim()}
                className="p-2 rounded-lg bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 transition-colors shadow-sm"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-cozy-muted/60 px-1">
          <span>Branch: <span className="font-mono text-sky-400/80">{task.branch}</span></span>
          <span>Base: <span className="font-mono text-cozy-muted">{task.base_branch}</span></span>
        </div>
      </div>
    </div>
  );
};
