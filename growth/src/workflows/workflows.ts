// Durable Workflows for daily and weekly reviews. Each instance id is the logical run key, so a duplicate cron fire
// cannot start a second instance. Steps are checkpointed: a retry resumes after the last completed step, and the
// report step is independent of the model step (a model failure never blocks the report).
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import { writeReport, reviewAndPropose, finishJob, type ReviewParams } from './jobs.ts';

async function run(env: Env, event: WorkflowEvent<ReviewParams>, step: WorkflowStep) {
  const p = event.payload;
  const report = await step.do('write report', { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '5 minutes' }, () => writeReport(env, p, Date.now()));
  let review: Awaited<ReturnType<typeof reviewAndPropose>> | { summary: string; submitted: number; executed: string[]; usage: { in: number; out: number; cost: number } };
  try {
    // No retries: a model review that partly ran must not be repeated blindly (proposals are idempotent per
    // snapshot, but a fresh snapshot would be a new review).
    review = await step.do('review and propose', { retries: { limit: 0, delay: '1 second' }, timeout: '4 minutes' }, () => reviewAndPropose(env, p, Date.now()));
  } catch (e) {
    review = { summary: `Model review failed: ${(e as Error).message}`, submitted: 0, executed: [], usage: { in: 0, out: 0, cost: 0 } };
  }
  await step.do('finish', () => finishJob(env.DB, p.runKey, 'succeeded', JSON.stringify({ report: report.reportId, narrative: report.narrativeSource, review: review.summary.slice(0, 300), submitted: review.submitted, executed: review.executed }),
    { in: report.usage.in + review.usage.in, out: report.usage.out + review.usage.out, cost: report.usage.cost + review.usage.cost }));
  return { report: report.reportId };
}

export class DailyReviewWorkflow extends WorkflowEntrypoint<Env, ReviewParams> {
  override async run(event: WorkflowEvent<ReviewParams>, step: WorkflowStep) { return run(this.env, event, step); }
}
export class WeeklyReviewWorkflow extends WorkflowEntrypoint<Env, ReviewParams> {
  override async run(event: WorkflowEvent<ReviewParams>, step: WorkflowStep) { return run(this.env, event, step); }
}
