import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolStepInfo, truncateOutput } from './agentRunner.js';

test('formatToolStepInfo standardizes Claude tools correctly', () => {
  // 1. Bash tool
  const bashStep = formatToolStepInfo('Bash', { command: 'npm test' });
  assert.equal(bashStep.category, 'command');
  assert.equal(bashStep.title, 'Run: npm test');
  assert.equal(bashStep.detail, 'npm test');

  // 2. Read / View tool
  const readStep = formatToolStepInfo('Read', { file_path: 'server/src/index.ts' });
  assert.equal(readStep.category, 'file_read');
  assert.equal(readStep.title, 'Read: index.ts');
  assert.equal(readStep.detail, 'server/src/index.ts');

  // 3. Edit / Write tool
  const editStep = formatToolStepInfo('Edit', { file_path: 'client/src/App.tsx' });
  assert.equal(editStep.category, 'file_write');
  assert.equal(editStep.title, 'Edit: App.tsx');
  assert.equal(editStep.detail, 'client/src/App.tsx');

  // 4. WebSearch tool
  const searchStep = formatToolStepInfo('WebSearch', { query: 'vitest configuration' });
  assert.equal(searchStep.category, 'search');
  assert.equal(searchStep.title, 'Search: "vitest configuration"');
  assert.equal(searchStep.detail, 'vitest configuration');

  // 5. WebFetch tool
  const fetchStep = formatToolStepInfo('WebFetch', { url: 'https://docs.anthropic.com' });
  assert.equal(fetchStep.category, 'file_read');
  assert.equal(fetchStep.title, 'Fetch: https://docs.anthropic.com');
  assert.equal(fetchStep.detail, 'https://docs.anthropic.com');
});

test('Claude stream-json simulation parses assistant tool_use, user tool_result, thinking, and final result', async () => {
  // Simulate lines emitted by `claude -p "..." --output-format stream-json --verbose --include-partial-messages`
  const eventsReceived: any[] = [];
  const onEvent = (ev: any) => eventsReceived.push(ev);

  let activeClaudeThinkingStepId: string | null = null;
  let accumulatedClaudeThinking = '';
  let hasStreamedDeltas = false;

  const mockLines = [
    // 1. System init event
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'test-session-uuid-1234',
      tools: ['Bash', 'Read', 'Edit'],
    }),

    // 2. Thinking tokens system event
    JSON.stringify({
      type: 'system',
      subtype: 'thinking_tokens',
      session_id: 'test-session-uuid-1234',
      estimated_tokens: 15,
    }),

    // 3. Streaming thinking deltas
    JSON.stringify({
      type: 'stream_event',
      session_id: 'test-session-uuid-1234',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
    }),
    JSON.stringify({
      type: 'stream_event',
      session_id: 'test-session-uuid-1234',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'I need to check the files first.' },
      },
    }),
    JSON.stringify({
      type: 'stream_event',
      session_id: 'test-session-uuid-1234',
      event: {
        type: 'content_block_stop',
        index: 0,
      },
    }),

    // 4. Assistant message with thinking and tool_use
    JSON.stringify({
      type: 'assistant',
      session_id: 'test-session-uuid-1234',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I need to check the files first.' },
          {
            type: 'tool_use',
            id: 'toolu_01Abcd',
            name: 'Bash',
            input: { command: 'ls -la' },
          },
        ],
      },
    }),

    // 5. User message with tool_result
    JSON.stringify({
      type: 'user',
      session_id: 'test-session-uuid-1234',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01Abcd',
            content: 'total 0\n-rw-r--r-- 1 user staff 0 package.json',
            is_error: false,
          },
        ],
      },
      tool_use_result: {
        stdout: 'total 0\n-rw-r--r-- 1 user staff 0 package.json',
        stderr: '',
        interrupted: false,
      },
    }),

    // 6. Streaming text deltas for final response
    JSON.stringify({
      type: 'stream_event',
      session_id: 'test-session-uuid-1234',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' },
      },
    }),
    JSON.stringify({
      type: 'stream_event',
      session_id: 'test-session-uuid-1234',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Files found successfully.' },
      },
    }),
    JSON.stringify({
      type: 'stream_event',
      session_id: 'test-session-uuid-1234',
      event: {
        type: 'content_block_stop',
        index: 1,
      },
    }),

    // 7. Result event
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'test-session-uuid-1234',
      result: 'Files found successfully.',
      is_error: false,
    }),
  ];

  // Process lines using the logic in agentRunner
  for (const line of mockLines) {
    const parsed = JSON.parse(line);
    const detectedConversationId = parsed.session_id;

    if (parsed.event === 'result' || parsed.type === 'result') {
      if (parsed.is_error || parsed.subtype === 'error') {
        const cleanMsg = typeof parsed.result === 'string' ? parsed.result : 'Agent execution failed';
        onEvent({ type: 'error', content: cleanMsg, conversationId: detectedConversationId });
      } else {
        const finalResponse = parsed.result?.response || (typeof parsed.result === 'string' ? parsed.result : undefined);
        if (finalResponse) {
          onEvent({
            type: 'chunk',
            content: finalResponse,
            metadata: { ...parsed, isFinalResult: true },
            conversationId: detectedConversationId,
          });
        }
      }
    } else if (parsed.type || parsed.role) {
      if (parsed.type === 'stream_event' && parsed.event) {
        const streamEv = parsed.event;
        if (streamEv.type === 'content_block_start') {
          const cb = streamEv.content_block;
          if (cb?.type === 'thinking') {
            activeClaudeThinkingStepId = `claude-think-${streamEv.index ?? Date.now()}`;
            accumulatedClaudeThinking = cb.thinking || '';
            onEvent({
              type: 'step',
              step: {
                id: activeClaudeThinkingStepId,
                type: 'thought',
                category: 'other',
                title: 'Reasoning',
                thought: accumulatedClaudeThinking,
                status: 'running',
              },
              metadata: parsed,
              conversationId: detectedConversationId,
            });
          }
        } else if (streamEv.type === 'content_block_delta') {
          const delta = streamEv.delta;
          if (delta?.type === 'thinking_delta' && delta.thinking) {
            accumulatedClaudeThinking += delta.thinking;
            if (!activeClaudeThinkingStepId) {
              activeClaudeThinkingStepId = `claude-think-${streamEv.index ?? Date.now()}`;
            }
            onEvent({
              type: 'thought',
              content: delta.thinking,
              metadata: parsed,
              conversationId: detectedConversationId,
            });
            onEvent({
              type: 'step',
              step: {
                id: activeClaudeThinkingStepId,
                type: 'thought',
                category: 'other',
                title: 'Reasoning',
                thought: accumulatedClaudeThinking,
                status: 'running',
              },
              metadata: parsed,
              conversationId: detectedConversationId,
            });
          } else if (delta?.type === 'text_delta' && delta.text) {
            hasStreamedDeltas = true;
            onEvent({
              type: 'chunk',
              content: delta.text,
              metadata: parsed,
              conversationId: detectedConversationId,
            });
          }
        } else if (streamEv.type === 'content_block_stop') {
          if (activeClaudeThinkingStepId) {
            onEvent({
              type: 'step',
              step: {
                id: activeClaudeThinkingStepId,
                type: 'thought',
                category: 'other',
                title: 'Reasoning',
                thought: accumulatedClaudeThinking || 'Thinking completed',
                status: 'completed',
              },
              metadata: parsed,
              conversationId: detectedConversationId,
            });
            activeClaudeThinkingStepId = null;
          }
        }
      } else if (parsed.type === 'assistant' && parsed.message?.content && Array.isArray(parsed.message.content)) {
        for (const block of parsed.message.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name || 'tool';
            const params = block.input || {};
            const { category, title, detail } = formatToolStepInfo(toolName, params);
            onEvent({
              type: 'step',
              step: {
                id: block.id || `claude-tool-${Date.now()}`,
                type: 'tool',
                toolName,
                category,
                title,
                detail,
                status: 'running',
                startTime: Date.now(),
              },
              metadata: parsed,
              conversationId: detectedConversationId,
            });
            onEvent({ type: 'thought', content: `→ ${title}\n`, metadata: parsed, conversationId: detectedConversationId });
          } else if (block.type === 'thinking') {
            const thinkText = block.thinking || accumulatedClaudeThinking || '';
            const thinkStepId = activeClaudeThinkingStepId || `claude-think-${Date.now()}`;
            onEvent({
              type: 'step',
              step: {
                id: thinkStepId,
                type: 'thought',
                category: 'other',
                title: 'Reasoning',
                thought: thinkText || 'Thinking completed',
                status: 'completed',
              },
              metadata: parsed,
              conversationId: detectedConversationId,
            });
            if (!hasStreamedDeltas && thinkText) {
              onEvent({ type: 'thought', content: thinkText + '\n', metadata: parsed, conversationId: detectedConversationId });
            }
            activeClaudeThinkingStepId = null;
          } else if (block.type === 'text' && block.text) {
            if (!hasStreamedDeltas) {
              onEvent({
                type: 'chunk',
                content: block.text,
                metadata: parsed,
                conversationId: detectedConversationId,
              });
            }
          }
        }
      } else if (parsed.type === 'user' && parsed.message?.content && Array.isArray(parsed.message.content)) {
        for (const block of parsed.message.content) {
          if (block.type === 'tool_result') {
            const isErr = Boolean(block.is_error);
            const rawOut = (parsed.tool_use_result ? (parsed.tool_use_result.stdout || parsed.tool_use_result.stderr) : undefined) ?? block.content ?? '';
            const cleanOut = truncateOutput(typeof rawOut === 'string' ? rawOut : JSON.stringify(rawOut));
            onEvent({
              type: 'step',
              step: {
                id: block.tool_use_id,
                type: 'tool',
                status: isErr ? 'failed' : 'completed',
                output: cleanOut,
              },
              metadata: parsed,
              conversationId: detectedConversationId,
            });
          }
        }
      } else if (parsed.type === 'system' && parsed.subtype === 'thinking_tokens') {
        if (!activeClaudeThinkingStepId) {
          activeClaudeThinkingStepId = `claude-think-${Date.now()}`;
          onEvent({
            type: 'step',
            step: {
              id: activeClaudeThinkingStepId,
              type: 'thought',
              category: 'other',
              title: 'Reasoning',
              thought: `Thinking... (${parsed.estimated_tokens || 0} tokens)`,
              status: 'running',
            },
            metadata: parsed,
            conversationId: detectedConversationId,
          });
        }
      }
    }
  }

  // 1. Verify thinking events
  const thinkingDeltas = eventsReceived.filter((e) => e.type === 'thought' && e.content.includes('I need to check'));
  assert.ok(thinkingDeltas.length > 0, 'Should have received thinking delta');

  // 2. Verify tool_use step
  const toolStepRunning = eventsReceived.find((e) => e.type === 'step' && e.step?.id === 'toolu_01Abcd' && e.step?.status === 'running');
  assert.ok(toolStepRunning, 'Should have emitted running tool step');
  assert.equal(toolStepRunning.step.toolName, 'Bash');
  assert.equal(toolStepRunning.step.category, 'command');
  assert.equal(toolStepRunning.step.title, 'Run: ls -la');

  // 3. Verify tool_result step
  const toolStepCompleted = eventsReceived.find((e) => e.type === 'step' && e.step?.id === 'toolu_01Abcd' && e.step?.status === 'completed');
  assert.ok(toolStepCompleted, 'Should have emitted completed tool step');
  assert.ok(toolStepCompleted.step.output.includes('package.json'), 'Tool output should match stdout');

  // 4. Verify streaming text deltas
  const textChunks = eventsReceived.filter((e) => e.type === 'chunk' && !e.metadata?.isFinalResult);
  assert.ok(textChunks.length > 0, 'Should have received streamed text deltas');
  assert.equal(textChunks[0].content, 'Files found successfully.');

  // 5. Verify final result
  const finalResult = eventsReceived.find((e) => e.type === 'chunk' && e.metadata?.isFinalResult);
  assert.ok(finalResult, 'Should have emitted final result');
  assert.equal(finalResult.content, 'Files found successfully.');
  assert.equal(finalResult.conversationId, 'test-session-uuid-1234');
});
