import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  feedbackRequestSchema,
  feedbackScreenshotMaxBytes,
  type FeedbackScreenshot,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { appVersion } from '../../version.js';
import { writeReportFolder } from './folder.js';

/** Version of `report.json`; a change to its shape raises it. */
const reportVersion = 1;

/** Room for a 3 MB picture as base64 and the rest of the report. */
const bodyLimitBytes = 5 * 1024 * 1024;

const signatures: Record<FeedbackScreenshot['type'], Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

const fileNames: Record<FeedbackScreenshot['type'], string> = {
  'image/jpeg': 'screenshot.jpg',
  'image/png': 'screenshot.png',
};

/**
 * Registers `POST /api/feedback` (FBK-3): each report becomes a folder of
 * files in `feedbackDir` for the host's own tooling. Nothing about a report
 * is kept in the database, and its text and picture are never logged (SEC-6).
 */
export const feedbackRoutes: FastifyPluginAsync<{
  /** Folder of the reports; without one every report answers 503. */
  feedbackDir?: string;
  /** Commit the copy was built from, written into each report. */
  appCommit: string;
  clock?: Clock;
}> = async (app, options) => {
  const clock = options.clock ?? systemClock;

  app.post(
    '/api/feedback',
    { bodyLimit: bodyLimitBytes },
    async (request, reply) => {
      const parsed = feedbackRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply);
      const body = parsed.data;

      let screenshot: { name: string; data: Buffer } | null = null;
      if (body.screenshot) {
        const data = Buffer.from(body.screenshot.data, 'base64');
        const signature = signatures[body.screenshot.type];
        if (
          data.length > feedbackScreenshotMaxBytes ||
          data.length < signature.length ||
          !data.subarray(0, signature.length).equals(signature)
        ) {
          return sendInvalid(reply);
        }
        screenshot = { name: fileNames[body.screenshot.type], data };
      }

      const { memberId, memberName } = request.authContext!;
      const report = {
        version: reportVersion,
        id: body.clientId,
        kind: body.kind,
        text: body.text,
        writtenAt: body.writtenAt,
        receivedAt: clock.now().toISOString(),
        profile: { id: memberId, name: memberName },
        app: { version: appVersion, commit: options.appCommit },
        device: body.device,
        screenshot: screenshot?.name ?? null,
      };

      const details = {
        feedbackId: body.clientId,
        kind: body.kind,
        screenshot: screenshot !== null,
      };
      let result: 'created' | 'duplicate';
      try {
        if (!options.feedbackDir) throw new Error('No feedback folder is set.');
        result = await writeReportFolder(options.feedbackDir, {
          id: body.clientId,
          report,
          screenshot,
        });
      } catch (error) {
        request.log.error(
          { ...details, err: error },
          'Feedback could not be written',
        );
        return reply.code(503).send({
          error: {
            code: 'unavailable',
            message: 'Could not save your feedback.',
          },
        });
      }
      request.log.info(
        { ...details, duplicate: result === 'duplicate' },
        'Feedback received',
      );
      return reply
        .code(result === 'created' ? 201 : 200)
        .send({ id: body.clientId });
    },
  );
};

function sendInvalid(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: 'invalid', message: 'This feedback cannot be sent.' },
  });
}
