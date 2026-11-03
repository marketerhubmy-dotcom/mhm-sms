import { createApp } from './app';
import type { Env } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => app.scheduled(event, env, ctx),
} satisfies ExportedHandler<Env>;
