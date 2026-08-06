import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './health.js';
import { registerTenantRoutes } from '../modules/tenants/index.js';
import { registerFacturaRoutes } from '../modules/facturas/index.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerHealthRoutes(app);
  await registerTenantRoutes(app);
  await registerFacturaRoutes(app);
}
