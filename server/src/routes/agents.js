import { Router } from 'express';

export function createAgentRoutes({ registry }) {
  const router = Router();

  /** GET /api/agents - live status board data. */
  router.get('/', (req, res) => {
    const agents = registry.listPublic();
    res.json({ count: agents.length, agents });
  });

  router.get('/:id', (req, res) => {
    const agent = registry.get(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: `No agent with id "${req.params.id}".` } });
    }
    res.json(registry.toPublic(agent));
  });

  return router;
}
