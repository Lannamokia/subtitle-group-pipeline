import { schedule, type ScheduledTask } from "node-cron";

export type JobFunction = () => Promise<void>;

export interface JobConfig {
  name: string;
  cronExpression: string;
  job: JobFunction;
  runOnStart?: boolean;
}

export class JobScheduler {
  private jobs: Map<string, ScheduledTask> = new Map();
  private jobConfigs: Map<string, JobConfig> = new Map();
  private isRunning = false;

  register(config: JobConfig): void {
    if (this.jobConfigs.has(config.name)) {
      console.warn(`[Scheduler] Job "${config.name}" is already registered. Skipping.`);
      return;
    }
    this.jobConfigs.set(config.name, config);
    console.log(`[Scheduler] Registered job: ${config.name} (${config.cronExpression})`);
  }

  start(): void {
    if (this.isRunning) {
      console.warn("[Scheduler] Already running.");
      return;
    }

    for (const [name, config] of this.jobConfigs) {
      const task = schedule(config.cronExpression, async () => {
        console.log(`[Scheduler] Running job: ${name}`);
        const startTime = Date.now();
        try {
          await config.job();
          const duration = Date.now() - startTime;
          console.log(`[Scheduler] Job "${name}" completed in ${duration}ms`);
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Scheduler] Job "${name}" failed after ${duration}ms:`, error);
        }
      }, {
        scheduled: true,
        timezone: "UTC",
      });

      this.jobs.set(name, task);

      if (config.runOnStart) {
        console.log(`[Scheduler] Running job "${name}" on startup...`);
        config.job().catch((error) => {
          console.error(`[Scheduler] Startup job "${name}" failed:`, error);
        });
      }
    }

    this.isRunning = true;
    console.log(`[Scheduler] Started ${this.jobs.size} job(s)`);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    for (const [name, task] of this.jobs) {
      task.stop();
      console.log(`[Scheduler] Stopped job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;
    console.log("[Scheduler] All jobs stopped");
  }

  async stopGracefully(): Promise<void> {
    console.log("[Scheduler] Graceful shutdown initiated...");
    this.stop();
  }

  getStatus(): { name: string; running: boolean }[] {
    return Array.from(this.jobConfigs.keys()).map((name) => ({
      name,
      running: this.jobs.has(name),
    }));
  }
}

export const scheduler = new JobScheduler();
