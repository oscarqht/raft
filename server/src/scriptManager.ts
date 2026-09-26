import { spawn, execSync, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import { getCrossPlatformEnv } from './agentRunner.js';

export type ScriptExecutionStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface ScriptExecution {
  id: string;
  taskId: string;
  projectId: string;
  scriptName: string;
  command: string;
  worktreePath: string;
  status: ScriptExecutionStatus;
  output: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  cancelRequested: boolean;
  dismissed?: boolean;
  proc: ChildProcess | null;
}

export type ScriptExecutionPayload = Omit<ScriptExecution, 'proc'>;

const MAX_OUTPUT_LENGTH = 500_000;

class ScriptManager extends EventEmitter {
  private executions: Map<string, ScriptExecution> = new Map();

  public toPayload(item: ScriptExecution): ScriptExecutionPayload {
    const { proc, ...rest } = item;
    return rest;
  }

  public getExecution(id: string): ScriptExecution | undefined {
    return this.executions.get(id);
  }

  public getExecutions(filter?: { taskId?: string; projectId?: string }): ScriptExecutionPayload[] {
    const all = Array.from(this.executions.values());
    const filtered = all.filter((item) => {
      if (filter?.taskId && item.taskId !== filter.taskId) return false;
      if (filter?.projectId && item.projectId !== filter.projectId) return false;
      return true;
    });

    // Sort descending by startedAt
    filtered.sort((a, b) => b.startedAt - a.startedAt);
    return filtered.map((item) => this.toPayload(item));
  }

  public startExecution(params: {
    taskId: string;
    projectId: string;
    scriptName: string;
    command: string;
    worktreePath: string;
    customId?: string;
  }): ScriptExecutionPayload {
    const id = params.customId || uuidv4();
    const isWin = process.platform === 'win32';

    const execution: ScriptExecution = {
      id,
      taskId: params.taskId,
      projectId: params.projectId,
      scriptName: params.scriptName,
      command: params.command,
      worktreePath: params.worktreePath,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      cancelRequested: false,
      proc: null,
    };

    const env = {
      ...getCrossPlatformEnv(),
      FORCE_COLOR: '1',
    };

    try {
      const proc = spawn(params.command, {
        cwd: params.worktreePath,
        shell: true,
        env,
        detached: !isWin, // detached on POSIX for process group kill
      });

      execution.proc = proc;

      const appendLog = (chunk: string) => {
        execution.output += chunk;
        if (execution.output.length > MAX_OUTPUT_LENGTH) {
          execution.output = execution.output.slice(execution.output.length - MAX_OUTPUT_LENGTH);
        }
        this.emit(`log:${id}`, chunk);
        this.emit('global_log', { id, chunk });
      };

      appendLog(`$ ${params.command}\n[Started at ${new Date(execution.startedAt).toLocaleTimeString()}]\n\n`);

      proc.stdout?.on('data', (data: Buffer) => {
        appendLog(data.toString('utf-8'));
      });

      proc.stderr?.on('data', (data: Buffer) => {
        appendLog(data.toString('utf-8'));
      });

      proc.on('close', (code, signal) => {
        if (execution.dismissed) {
          return;
        }
        execution.exitCode = code;
        execution.finishedAt = Date.now();
        execution.proc = null;

        if (execution.cancelRequested) {
          execution.status = 'canceled';
          appendLog(`\n[Process canceled by user]\n`);
        } else if (code === 0) {
          execution.status = 'completed';
          appendLog(`\n[Process completed successfully with exit code 0]\n`);
        } else {
          execution.status = 'failed';
          appendLog(`\n[Process finished with exit code ${code ?? signal}]\n`);
        }

        const payload = this.toPayload(execution);
        this.emit(`state:${id}`, payload);
        this.emit('global_state', payload);
      });

      proc.on('error', (err) => {
        if (execution.dismissed) {
          return;
        }
        execution.status = 'failed';
        execution.finishedAt = Date.now();
        execution.proc = null;
        appendLog(`\n[Process execution error: ${err.message}]\n`);

        const payload = this.toPayload(execution);
        this.emit(`state:${id}`, payload);
        this.emit('global_state', payload);
      });
    } catch (err: any) {
      execution.status = 'failed';
      execution.finishedAt = Date.now();
      execution.output = `Failed to spawn process: ${err.message}\n`;
    }

    this.executions.set(id, execution);
    const payload = this.toPayload(execution);
    this.emit(`state:${id}`, payload);
    this.emit('global_state', payload);
    return payload;
  }

  public cancelExecution(executionId: string, force = false): boolean {
    const item = this.executions.get(executionId);
    if (!item || item.status !== 'running') {
      return false;
    }

    item.cancelRequested = true;
    const proc = item.proc;
    if (!proc || !proc.pid) {
      item.status = 'canceled';
      item.finishedAt = Date.now();
      const payload = this.toPayload(item);
      this.emit(`state:${executionId}`, payload);
      this.emit('global_state', payload);
      return true;
    }

    try {
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
        } catch {}
      } else {
        try {
          process.kill(-proc.pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          try {
            proc.kill(force ? 'SIGKILL' : 'SIGTERM');
          } catch {}
        }
      }
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }

    return true;
  }

  public rerunExecution(executionId: string): ScriptExecutionPayload | null {
    const old = this.executions.get(executionId);
    if (!old) return null;

    // If still running, cancel old first
    if (old.status === 'running') {
      this.cancelExecution(executionId, true);
    }

    // Start anew
    return this.startExecution({
      taskId: old.taskId,
      projectId: old.projectId,
      scriptName: old.scriptName,
      command: old.command,
      worktreePath: old.worktreePath,
      customId: executionId, // reuse execution ID for rerun
    });
  }

  public dismissExecution(executionId: string): boolean {
    const item = this.executions.get(executionId);
    if (!item) return false;

    item.dismissed = true;

    // If currently running, cancel first
    if (item.status === 'running') {
      this.cancelExecution(executionId, true);
    }

    this.executions.delete(executionId);
    this.emit(`dismissed:${executionId}`);
    this.emit('global_dismissed', { id: executionId });
    return true;
  }
}

export const scriptManager = new ScriptManager();
