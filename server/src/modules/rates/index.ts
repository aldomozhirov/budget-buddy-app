import type { FastifyPluginAsync } from 'fastify';
import { ratesStatusResponseSchema } from '@budget-buddy/shared';
import { FamilyNotSetUpError, type RatesService } from '../../rates/service.js';

/** Registers the read-only exchange-rate status route (CUR-4). */
export const ratesRoutes: FastifyPluginAsync<{
  rates: Pick<RatesService, 'status'>;
}> = async (app, { rates }) => {
  app.get('/api/rates/status', async (_request, reply) => {
    try {
      return ratesStatusResponseSchema.parse(rates.status());
    } catch (error) {
      // The only expected failure is a family that has not been set up yet.
      if (error instanceof FamilyNotSetUpError) {
        return reply.code(403).send({
          error: { code: 'forbidden_state', message: error.message },
        });
      }
      throw error;
    }
  });
};
