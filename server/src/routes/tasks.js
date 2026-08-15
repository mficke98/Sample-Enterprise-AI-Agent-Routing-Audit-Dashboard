import { Router } from 'express';

import { ingestTask } from '../domain/ingestion.js';
import { executeTask } from '../domain/execution.js';
import { toPublicTask } from '../domain/serializers.js';
import { readJsonc } from '../lib/jsonc.js';

export function createTaskRoutes({ registry, taskStore, paths, dispatcher }) {
  const router = Router();

  /** POST /api/tasks - ingest a task, assign an agent, set status PENDING. */
  router.post('/', (req, res, next) => {
    try {
      const task = ingestTask(req.body, { registry, taskStore });
      dispatcher?.kick();
      res.status(201).json(toPublicTask(task));
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/tasks?status=&type=&limit= */
  router.get('/', (req, res) => {
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    const tasks = taskStore.list({
      status: req.query.status,
      type: req.query.type,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ count: tasks.length, tasks: tasks.map(toPublicTask) });
  });

  /** GET /api/tasks/:id */
  router.get('/:id', (req, res) => {
    const task = taskStore.get(req.params.id);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: `No task with id "${req.params.id}".` } });
    }
    res.json(toPublicTask(task));
  });

  /**
   * POST /api/tasks/:id/execute - run the task now and await the result.
   *
   * Retained alongside the background dispatcher because the spec names it
   * explicitly, and because it gives a caller a synchronous way to observe one
   * task end-to-end (including any fallback) in a single response.
   */
  router.post('/:id/execute', async (req, res, next) => {
    try {
      const task = await executeTask(req.params.id, { registry, taskStore });
      res.json(toPublicTask(task));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/tasks/seed - bulk-ingest the provided sample_tasks.json. */
  router.post('/seed/sample', (req, res, next) => {
    try {
      const samples = readJsonc(paths.sampleTasks);
      const created = samples.map((sample) => toPublicTask(ingestTask(sample, { registry, taskStore })));
      dispatcher?.kick();
      res.status(201).json({ count: created.length, tasks: created });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
