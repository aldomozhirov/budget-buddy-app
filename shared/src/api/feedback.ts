import { z } from 'zod';

/** Fewest characters other than white space a report's text must hold. */
export const feedbackTextMinLength = 3;

/** Most characters a report's text may hold, counted after trimming. */
export const feedbackTextMaxLength = 4000;

/** Largest screenshot the server accepts, in bytes after decoding (FBK-5). */
export const feedbackScreenshotMaxBytes = 3 * 1024 * 1024;

/** What a report is about: something that went wrong, or an idea. */
export const feedbackKindSchema = z.enum(['problem', 'idea']);

/** Kind of a report. */
export type FeedbackKind = z.infer<typeof feedbackKindSchema>;

/**
 * Whether `text` holds enough characters other than white space to be sent;
 * the sheet's Send button and the server use the same rule.
 */
export function isFeedbackTextLongEnough(text: string): boolean {
  return text.replace(/\s/gu, '').length >= feedbackTextMinLength;
}

/**
 * The device a report was written on (FBK-2). It never holds anything from
 * the family's data: `fromScreen` is a path, with ids at most.
 */
export const feedbackDeviceSchema = z.object({
  type: z.enum(['iPhone', 'iPad', 'other']),
  os: z.string().max(40).nullable(),
  display: z.enum(['standalone', 'browser']),
  fromScreen: z.string().startsWith('/').max(200).nullable(),
  userAgent: z.string().max(400),
});

/** Device details sent with a report. */
export type FeedbackDevice = z.infer<typeof feedbackDeviceSchema>;

/** A picture attached to a report, as base64 of a JPEG or PNG file. */
export const feedbackScreenshotSchema = z.object({
  type: z.enum(['image/jpeg', 'image/png']),
  // Base64 of the largest picture allowed, with room for the padding.
  data: z.base64().max(Math.ceil(feedbackScreenshotMaxBytes / 3) * 4),
});

/** Screenshot attached to a report. */
export type FeedbackScreenshot = z.infer<typeof feedbackScreenshotSchema>;

/**
 * Body of `POST /api/feedback`. `clientId` is made on the device, so a report
 * sent twice from its outbox is written once. The text is trimmed.
 */
export const feedbackRequestSchema = z.object({
  clientId: z.uuid(),
  kind: feedbackKindSchema,
  text: z
    .string()
    .trim()
    .max(feedbackTextMaxLength)
    .refine(isFeedbackTextLongEnough),
  writtenAt: z.iso.datetime({ offset: true }),
  device: feedbackDeviceSchema,
  screenshot: feedbackScreenshotSchema.nullable(),
});

/** Feedback request body, as the device builds it. */
export type FeedbackRequest = z.input<typeof feedbackRequestSchema>;

/** Answer to a report written now (201) or already written before (200). */
export const feedbackResponseSchema = z.object({ id: z.uuid() });

/** Feedback answer. */
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
