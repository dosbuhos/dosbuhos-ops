// Monthly AI visibility check: mention/rank/citation analysis, pause_turn continuation, cost cap, failures recorded.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { analyzeAnswer, runVisibilityCheck } from '../src/ai/visibility.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(binds as never[])); return { meta: { changes: 1 } }; },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(readFileSync(new URL('../migrations/0005_ai_visibility.sql', import.meta.url), 'utf8'));
  return d;
}

const ANSWER = `Here are some great options:\n\n1. **Viñedo San Lucas** – large estate with a restaurant.\n2. **Cuna de Tierra** – pioneering Guanajuato winery.\n3. **Dos Búhos** – a family organic winery with guided tours and a pairing menu.\n\nBook ahead on weekends.`;
const msg = (over: Partial<Anthropic.Message>): Anthropic.Message => ({
  id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 300, server_tool_use: { web_search_requests: 2 } } as Anthropic.Usage,
  content: [{ type: 'text', text: ANSWER, citations: [{ type: 'web_search_result_location', url: 'https://www.tripadvisor.com/x', title: 't', cited_text: 'x', encrypted_index: 'e' }, { type: 'web_search_result_location', url: 'https://dosbuhos.com/wine-tour/', title: 'd', cited_text: 'y', encrypted_index: 'e' }] }] as Anthropic.ContentBlock[],
  ...over,
} as Anthropic.Message);

describe('AI visibility check', () => {
  it('finds the mention, its rank in the list, the sentence, and whether dosbuhos.com was cited', () => {
    const a = analyzeAnswer(ANSWER, ['https://www.tripadvisor.com/x', 'https://dosbuhos.com/wine-tour/', 'https://www.tripadvisor.com/x']);
    expect(a).toMatchObject({ mentioned: true, rank: 3, dosbuhosCited: true });
    expect(a.excerpt).toMatch(/family organic winery/);
    expect(a.cited).toHaveLength(2);
    expect(analyzeAnswer('Try Viñedo San Lucas or Cuna de Tierra.', []).mentioned).toBe(false);
    expect(analyzeAnswer('Viñedo Dos Buhos is lovely.', []).rank).toBeNull(); // mentioned, but not in a list
  });

  it('asks every active question without naming Dos Búhos, follows pause_turn, records cost', async () => {
    const d = db();
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
    let n = 0;
    const create = async (body: Anthropic.MessageCreateParamsNonStreaming) => { sent.push(body); n++; return n === 1 ? msg({ stop_reason: 'pause_turn', content: [] }) : msg({}); };
    const r = await runVisibilityCheck({ db: fakeD1(d), apiKey: 'k', model: 'claude-opus-5-5', runKey: 'ai_visibility:2026-11', now: 1, create });
    expect(r.asked).toBe(10);
    expect(r.mentioned).toBe(10);
    expect(sent.length).toBe(11); // one continuation after pause_turn
    expect(sent.every(b => !MENTION_IN(b))).toBe(true);
    const row = d.prepare("SELECT mentioned, rank, dosbuhos_cited, searches FROM ai_visibility_results WHERE question_id = 'en_best_wineries'").get();
    expect(row).toEqual({ mentioned: 1, rank: 3, dosbuhos_cited: 1, searches: 4 });
    expect(r.costMicroUsd).toBeGreaterThan(0);
  });

  it('stops at the cost cap and records failures as errors, not as "not mentioned"', async () => {
    const d = db();
    let n = 0;
    const create = async () => { n++; if (n === 2) throw new Error('overloaded'); return msg({}); };
    const r = await runVisibilityCheck({ db: fakeD1(d), apiKey: 'k', model: 'claude-opus-5-5', runKey: 'r', now: 1, create, maxCostMicroUsd: 1 });
    expect(r.stoppedForCost).toBe(true);
    expect(r.asked).toBe(1);
    const failed = d.prepare("SELECT COUNT(*) AS n FROM ai_visibility_results WHERE error IS NOT NULL").get() as { n: number };
    expect(failed.n).toBe(0); // the cap stopped it before the failing call
    const d2 = db(); n = 0;
    await runVisibilityCheck({ db: fakeD1(d2), apiKey: 'k', model: 'claude-opus-5-5', runKey: 'r', now: 1, create });
    expect(d2.prepare("SELECT error FROM ai_visibility_results WHERE question_id = 'en_tasting_lunch'").get()).toEqual({ error: 'overloaded' });
  });
});

const MENTION_IN = (b: Anthropic.MessageCreateParamsNonStreaming) => /dos\s*b[uú]hos/i.test(JSON.stringify([b.system, b.messages[0]]));
