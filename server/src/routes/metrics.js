import { Router } from 'express';

import { computeMetrics } from '../domain/metrics.js';

export function createMetricsRoutes({ registry, taskStore, dispatcher }) {
  const router = Router();

  /** GET /api/metrics - audit aggregates for the dashboard summary cards. */
  router.get('/', (req, res) => {
    res.json(computeMetrics({ registry, taskStore, dispatcher }));
  });

  return router;
}
