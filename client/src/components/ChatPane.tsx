import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Send, Square, GitMerge, UploadCloud, Sliders, ChevronDown } from 'lucide-react';
import { Task, ChatSession, ChatMessage, Settings, CliInfo, ModelOption } from '../types';
import { ChatMessageList } from './ChatMessageList';
import { getTaskChats, createChatSession, deleteChatSession, getChatMessages, getModels } from '../api';

interface ChatPaneProps {
  task: Task;
  settings: Settings | null;
  clis: CliInfo[];
  ws: WebSocket | null;
  onOpenRebase: () => void;
  onOpenSubmit: () => void;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  task,
  settings,
  clis,
  ws,
  onOpenRebase,
  onOpenSubmit,
}) => {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingChunk, setStreamingChunk] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [showConfig, setShowConfig] = useState(false);

  // Tab overrides
  const [tabCli, setTabCli] = useState<string>('');
  const [tabModel, setTabModel] = useState<string>('');
  const [tabEffort, setTabEffort] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat sessions
  const loadChats = async () => {
    try {
      const data = await getTaskChats(task.id);
      setChats(data);
      if (data.length > 0 && !activeChatId) {
        setActiveChatId(data[0].id);
      }
    } catch {}
  };

  useEffect(() => {
    loadChats();
  }, [task.id]);

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) return;
    const currentChat = chats.find((c) => c.id === activeChatId);
    if (currentChat) {
      setTabCli(currentChat.agent_cli || settings?.agent_cli || 'agy');
      setTabModel(currentChat.model || settings?.default_model || '');
      setTabEffort(currentChat.thinking_effort || settings?.thinking_effort || 'medium');
    }

    getChatMessages(activeChatId).then(setMessages).catch(() => {});
  }, [activeChatId, chats]);

  // Load models when tab CLI changes
  useEffect(() => {
    const cli = tabCli || settings?.agent_cli || 'agy';
    getModels(cli).then(setAvailableModels).catch(() => {});
  }, [tabCli, settings?.agent_cli]);

  // Listen to WebSocket messages
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.sessionId && msg.sessionId === activeChatId) {
          if (msg.type === 'message_saved') {
            setMessages((prev) => [...prev, msg.message]);
          } else if (msg.type === 'chat_stream') {
            setIsStreaming(true);
            if (msg.event?.content) {
              setStreamingChunk((prev) => prev + msg.event.content);
            }
          } else if (msg.type === 'chat_turn_complete') {
            setIsStreaming(false);
            setStreamingChunk('');
            setMessages((prev) => [...prev, msg.message]);
          } else if (msg.type === 'aborted') {
            setIsStreaming(false);
            setStreamingChunk('');
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
    setChats((prev) => [...prev, newChat]);
    setActiveChatId(newChat.id);
  };

  const handleDeleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (chats.length <= 1) return;
    await deleteChatSession(id);
    const nextChats = chats.filter((c) => c.id !== id);
    setChats(nextChats);
    if (activeChatId === id) {
      setActiveChatId(nextChats[0]?.id || null);
    }
  };

  const handleSendMessage = () => {
    if (!inputPrompt.trim() || !activeChatId || !ws || isStreaming) return;
    const prompt = inputPrompt.trim();
    setInputPrompt('');
    setIsStreaming(true);
    setStreamingChunk('');

    ws.send(
      JSON.stringify({
        type: 'send_chat_message',
        sessionId: activeChatId,
        prompt,
        agentCli: tabCli,
        model: tabModel,
        thinkingEffort: tabEffort,
      })
    );
  };

  const handleAbort = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'abort' }));
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
                <span className="truncate max-w-[100px]">{c.title}</span>
                {chats.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteChat(c.id, e)}
                    className="p-0.5 rounded text-cozy-muted opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
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

        {/* Action Buttons: Sync/Rebase & Submit */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded-lg text-xs transition-colors border ${
              showConfig
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : 'text-cozy-muted hover:text-cozy-text hover:bg-cozy-subtle border-transparent'
            }`}
            title="Configure Tab Agent CLI / Model"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>

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

      {/* Tab Agent Override Bar (collapsible) */}
      {showConfig && (
        <div className="px-4 py-2 bg-cozy-subtle/80 border-b border-cozy-border flex items-center space-x-3 text-xs text-cozy-muted">
          <div className="flex items-center space-x-1.5">
            <span className="font-medium text-cozy-text">Agent:</span>
            <select
              value={tabCli}
              onChange={(e) => setTabCli(e.target.value)}
              className="bg-cozy-surface border border-cozy-border rounded px-2 py-1 text-cozy-text focus:outline-none focus:border-sky-500"
            >
              {clis.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} {!c.available && '(not found)'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5 flex-1 max-w-xs">
            <span className="font-medium text-cozy-text">Model:</span>
            <select
              value={tabModel}
              onChange={(e) => {
                const nextModel = e.target.value;
                setTabModel(nextModel);
                const found = availableModels.find((m) => m.id === nextModel);
                if (found?.reasoningEfforts && found.reasoningEfforts.length > 0) {
                  if (!found.reasoningEfforts.map((s) => s.toLowerCase()).includes(tabEffort.toLowerCase())) {
                    setTabEffort(found.defaultEffort || found.reasoningEfforts[0]);
                  }
                }
              }}
              className="w-full bg-cozy-surface border border-cozy-border rounded px-2 py-1 text-cozy-text focus:outline-none focus:border-sky-500 truncate"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="font-medium text-cozy-text">Effort:</span>
            <select
              value={tabEffort}
              onChange={(e) => setTabEffort(e.target.value)}
              className="bg-cozy-surface border border-cozy-border rounded px-2 py-1 text-cozy-text focus:outline-none focus:border-sky-500 capitalize"
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
      )}

      {/* Messages Scroll Area */}
      <ChatMessageList
        messages={messages}
        liveStreamingChunk={streamingChunk}
        isStreaming={isStreaming}
      />
      <div ref={messagesEndRef} />

      {/* Input Area */}
      <div className="p-3 border-t border-cozy-border bg-cozy-surface/60">
        <div className="relative flex items-end rounded-xl bg-cozy-subtle border border-cozy-border focus-within:border-sky-500/50 shadow-sm transition-all p-2">
          <textarea
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${tabCli || 'AI agent'} on ${task.branch}... (Enter to send, Shift+Enter for newline)`}
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
