import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { addCors, callChatLLM, normalizeBaseInput, parseRequestBody, sendError } from './_shared.js';

const payloadSchema = z.object({
  text: z.string().min(1, 'Text is required'),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (addCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendError(res, 405, 'Method not allowed');
  }

  try {
    const body = parseRequestBody(req);
    const base = normalizeBaseInput(body);
    const payload = payloadSchema.safeParse(body);
    if (!payload.success) {
      return sendError(res, 400, payload.error.issues.map((i) => i.message).join(', '));
    }

    const systemPrompt =
      'You are an expert in identifying medical domain texts. Analyze the following text and determine if it belongs to the medical domain. Respond with "yes" if it is medical, or "no" if it is not. Only output "yes" or "no".';
    const userPrompt = `Text: ${payload.data.text}`;

    const response = await callChatLLM({
      provider: base.provider,
      model: base.model,
      temperature: base.temperature,
      systemPrompt,
      userPrompt,
    });

    const normalized = response.trim().toLowerCase();
    const isMedical = normalized.includes('yes');
    return res.status(200).json({ isMedical, raw: response });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return sendError(res, 500, message);
  }
}
