// Monthly AI visibility check. Asks an AI assistant (Claude, with web search) the fixed traveler questions in
// ai_visibility_questions, exactly as a traveler would — without naming Dos Búhos — and records whether the answer
// recommends Dos Búhos, where, how it is described, and which websites it cited. One run per month; hard cost cap.
// This measures one assistant (Claude); ChatGPT and Gemini would need their own APIs and accounts.
import Anthropic from '@anthropic-ai/sdk';
import { costMicroUsd } from './claude.ts';

export const MENTION = /dos\s*b[uú]hos/i;
export const WEB_SEARCH_COST_MICRO_USD = 10_000; // $10 per 1,000 searches (Claude API pricing reference)
const SYSTEM = 'You are a knowledgeable travel assistant. Answer the traveler’s question the way you normally would: search the web, then recommend specific places by name with one or two lines on why. Answer in the language of the question.';

export interface Question { id: string; lang: string; question: string }
export interface Analysis { mentioned: boolean; rank: number | null; excerpt: string; cited: string[]; dosbuhosCited: boolean }

/** Pull the facts out of an answer: mention, rank among listed recommendations, the sentence that mentions us. */
export function analyzeAnswer(answer: string, cited: string[]): Analysis {
  const mentioned = MENTION.test(answer);
  // Recommendations are usually numbered lines, bullets, or bold names at line start; rank = first item naming us.
  const items = answer.split('\n').map(l => l.trim()).filter(l => /^(\d+[.)]|[-*•]|#{1,4}\s|\*\*)/.test(l));
  const idx = items.findIndex(l => MENTION.test(l));
  const sentence = mentioned ? (answer.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).find(s => MENTION.test(s)) ?? '') : answer.split('\n').filter(Boolean).slice(0, 3).join(' ');
  const uniq = [...new Set(cited)];
  return { mentioned, rank: mentioned && idx >= 0 ? idx + 1 : null, excerpt: sentence.slice(0, 600), cited: uniq.slice(0, 30), dosbuhosCited: uniq.some(u => /dosbuhos\.com/i.test(u)) };
}

type Create = (body: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** Ask one question, following pause_turn continuations (server tools can pause long turns). */
export async function askOne(create: Create, model: string, q: Question): Promise<{ answer: string; cited: string[]; searches: number; cost: number }> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: q.question }];
  let answer = '', searches = 0, cost = 0;
  const cited: string[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await create({
      model, max_tokens: 4000, system: SYSTEM, messages,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'San Miguel de Allende', region: 'Guanajuato', country: 'MX', timezone: 'America/Mexico_City' } }],
    });
    const n = (res.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0;
    searches += n;
    cost += costMicroUsd(res.model, res.usage.input_tokens, res.usage.output_tokens) + n * WEB_SEARCH_COST_MICRO_USD;
    for (const b of res.content) {
      if (b.type === 'text') { answer += b.text; for (const c of b.citations ?? []) if (c.type === 'web_search_result_location') cited.push(c.url); }
    }
    if (res.stop_reason === 'refusal') throw new Error('The assistant declined this question');
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  return { answer: answer.trim(), cited, searches, cost };
}

export async function runVisibilityCheck(opts: { db: D1Database; apiKey: string; model: string; runKey: string; now: number; maxCostMicroUsd?: number; create?: Create }): Promise<{ asked: number; mentioned: number; costMicroUsd: number; stoppedForCost: boolean }> {
  const maxCost = opts.maxCostMicroUsd ?? 2_000_000; // US$2 per run, hard stop
  const create: Create = opts.create ?? ((body) => new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 }).messages.create(body));
  const qs = (await opts.db.prepare('SELECT id, lang, question FROM ai_visibility_questions WHERE active = 1 ORDER BY sort').all<Question>()).results;
  let spent = 0, asked = 0, mentioned = 0, stoppedForCost = false;
  for (const q of qs) {
    if (spent >= maxCost) { stoppedForCost = true; break; }
    try {
      const r = await askOne(create, opts.model, q);
      const a = analyzeAnswer(r.answer, r.cited);
      spent += r.cost; asked++; if (a.mentioned) mentioned++;
      await opts.db.prepare(`INSERT OR REPLACE INTO ai_visibility_results (run_key, question_id, assistant, mentioned, rank, excerpt, answer, cited_json, dosbuhos_cited, searches, cost_micro_usd, error, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).bind(opts.runKey, q.id, opts.model, a.mentioned ? 1 : 0, a.rank, a.excerpt, r.answer.slice(0, 6000), JSON.stringify(a.cited), a.dosbuhosCited ? 1 : 0, r.searches, r.cost, opts.now).run();
    } catch (e) {
      await opts.db.prepare(`INSERT OR REPLACE INTO ai_visibility_results (run_key, question_id, assistant, mentioned, excerpt, error, checked_at) VALUES (?, ?, ?, 0, '', ?, ?)`)
        .bind(opts.runKey, q.id, opts.model, (e as Error).message.slice(0, 300), opts.now).run();
    }
  }
  return { asked, mentioned, costMicroUsd: spent, stoppedForCost };
}
