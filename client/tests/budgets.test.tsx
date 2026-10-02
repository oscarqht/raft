import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AgentUsageCard } from '../src/components/AgentUsageCard';
import { HeaderBudgets } from '../src/components/HeaderBudgets';
import { SettingsPage } from '../src/pages/SettingsPage';
import { setCachedAgentUsages } from '../src/cache';
import type { AgentUsageSnapshot, CliInfo } from '../src/types';

const clis: CliInfo[] = [
  { name: 'codex', path: '/bin/codex', available: true },
  { name: 'claude', path: '/bin/claude', available: true },
  { name: 'agy', path: '', available: false },
  { name: 'alpha', path: '', available: true, isCloudProvider: true },
];

function cacheSnapshots(error?: string) {
  setCachedAgentUsages(Object.fromEntries(clis.map((cli) => [cli.name, {
    cli: cli.name,
    providerName: `${cli.name} budget account`,
    isAvailable: cli.available,
    updatedAt: Date.now(),
    error,
    costLimit: { used: 10, limit: 100, currency: 'USD', remainingPercent: 90 },
  } satisfies AgentUsageSnapshot])));
}

function renderSettings(tab: string, agentCli = 'alpha') {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}>
      <SettingsPage
        settings={{ agent_cli: agentCli, default_model: '', thinking_effort: 'medium', theme: 'auto' }}
        clis={clis}
        onUpdateSettings={() => {}}
      />
    </MemoryRouter>
  );
}

test('shows every non-Alpha provider together, including unavailable CLIs', () => {
  cacheSnapshots();
  const html = renderToStaticMarkup(<AgentUsageCard clis={clis} />);
  for (const provider of ['codex', 'claude', 'agy']) {
    assert.ok(html.includes(`${provider} budget account`));
  }
  assert.ok(!html.includes('alpha budget account'));
  assert.equal(html.match(/Refresh Quotas/g)?.length, 1);
  assert.equal(html.match(/90% remaining/g)?.length, 3);
  assert.ok(html.includes('CLI Not in PATH'));
});

test('shows one shared installation banner when CodexBar is missing', () => {
  cacheSnapshots('CodexBar CLI not found');
  const html = renderToStaticMarkup(<AgentUsageCard clis={clis} />);
  assert.equal(html.match(/CodexBar CLI Not Detected/g)?.length, 1);
});

test('budgets URL opens provider budgets even when Alpha is the default agent', () => {
  cacheSnapshots();
  const html = renderSettings('budgets');
  assert.ok(html.includes('AI Provider Budgets'));
  assert.ok(html.includes('codex budget account'));
  assert.ok(html.includes('claude budget account'));
  assert.ok(!html.includes('alpha budget account'));
  assert.ok(!html.includes('Default AI Agent Provider'));
});

test('AI Agents tab no longer contains provider budgets', () => {
  cacheSnapshots();
  const html = renderSettings('agents', 'codex');
  assert.ok(html.includes('Default AI Agent Provider'));
  assert.ok(!html.includes('codex budget account'));
  assert.ok(!html.includes('Refresh Quotas'));
});

test('header shows one-line budget summary linking to budgets tab', () => {
  cacheSnapshots();
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <HeaderBudgets />
    </MemoryRouter>
  );
  assert.ok(html.includes('href="/settings?tab=budgets"'));
  assert.equal(html.match(/>90%</g)?.length, 3);
  assert.equal(html.match(/>\|</g)?.length, 2);
  assert.ok(!html.includes('alpha budget account'));
});

test('Claude budget and spend warning show the relative reset description like Codex', () => {
  setCachedAgentUsages({ claude: {
    cli: 'claude', providerName: 'Claude Code', isAvailable: true, updatedAt: Date.now(),
    statusMessage: 'Monthly spend cap reached',
    costLimit: {
      used: 200, limit: 200, currency: 'USD', remainingPercent: 0,
      resetsAt: '2026-11-01T00:00:00.000Z', resetDescription: 'Resets in 30d',
    },
  } });
  const html = renderSettings('budgets');
  assert.equal(html.match(/Resets in 30d/g)?.length, 2);
  assert.ok(!html.includes('Resets soon'));
});

test('missing reset dates are not presented as an imminent reset', () => {
  cacheSnapshots();
  const html = renderToStaticMarkup(<AgentUsageCard clis={clis} />);
  assert.equal(html.match(/Reset date unavailable/g)?.length, 3);
  assert.ok(!html.includes('Resets soon'));
});

test('renders daily speed and remaining daily budget for Codex and Claude', () => {
  setCachedAgentUsages({
    codex: {
      cli: 'codex', providerName: 'OpenAI Codex', isAvailable: true, updatedAt: Date.now(),
      costLimit: {
        used: 48.96, limit: 1200, currency: 'Credits', remaining: 1151.04, remainingPercent: 96,
        resetsAt: '2026-11-01T00:00:00.000Z', resetDescription: 'Resets in 29d 18h',
        dailySpeed: 39.83, dailyRemainingBudget: 38.66,
      },
    },
    claude: {
      cli: 'claude', providerName: 'Claude Code', isAvailable: true, updatedAt: Date.now(),
      costLimit: {
        used: 29.48, limit: 200, currency: 'USD', remaining: 170.52, remainingPercent: 85,
        resetsAt: '2026-11-01T00:00:00.000Z', resetDescription: 'Resets in 29d 18h',
        dailySpeed: 24.04, dailyRemainingBudget: 5.73,
      },
    },
  });

  const html = renderSettings('budgets');
  // Daily speed labels and values
  assert.ok(html.includes('Daily speed:'));
  assert.ok(html.includes('39.83'));
  assert.ok(html.includes('Credits'));
  assert.ok(html.includes('$24.04'));

  assert.ok(html.includes('Remaining daily budget:'));
  assert.ok(html.includes('38.66'));
  assert.ok(html.includes('$5.73'));
  assert.ok(html.includes('/ day'));
});

test('AgentUsageCard renders unsupported placeholder on Windows', () => {
  cacheSnapshots();
  const html = renderToStaticMarkup(<AgentUsageCard clis={clis} isWindows={true} />);
  assert.ok(html.includes('Not Supported on Windows'));
  assert.ok(html.includes('macOS Only'));
  assert.ok(html.includes('CodexBar is a macOS-only tool and is not supported on Windows'));
  assert.ok(html.includes('AI agents and tasks continue to run normally'));
  assert.ok(!html.includes('Refresh Quotas'));
  assert.ok(!html.includes('codex budget account'));
});

test('SettingsPage renders unsupported placeholder on Windows platform in budgets tab', () => {
  cacheSnapshots();
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/settings?tab=budgets']}>
      <SettingsPage
        settings={{ agent_cli: 'codex', default_model: '', thinking_effort: 'medium', theme: 'auto', platform: 'win32' }}
        clis={clis}
        onUpdateSettings={() => {}}
      />
    </MemoryRouter>
  );
  assert.ok(html.includes('AI Provider Budgets'));
  assert.ok(html.includes('Not Supported on Windows'));
  assert.ok(html.includes('macOS Only'));
  assert.ok(!html.includes('Refresh Quotas'));
  assert.ok(!html.includes('codex budget account'));
});

test('AgentUsageCard renders unsupported placeholder if snapshot error indicates CodexBar is macOS only', () => {
  setCachedAgentUsages({
    codex: {
      cli: 'codex',
      providerName: 'OpenAI Codex',
      isAvailable: true,
      updatedAt: Date.now(),
      error: 'CodexBar is macOS only and is not supported on Windows.',
    },
  });
  const html = renderToStaticMarkup(<AgentUsageCard clis={clis} />);
  assert.ok(html.includes('Not Supported on Windows'));
  assert.ok(html.includes('macOS Only'));
  assert.ok(!html.includes('Refresh Quotas'));
});

