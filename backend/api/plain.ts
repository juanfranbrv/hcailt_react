import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { addCors, callChatLLM, normalizeBaseInput, parseRequestBody, sendError } from './_shared.js';

const payloadSchema = z.object({
  originalText: z.string().min(1, 'Original text is required'),
  translatedText: z.string().min(1, 'Translated text is required'),
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

    const systemPrompt = [
      'You are a professional plain language editor.',
      'Your task is to adapt a technical English medical text into plain English understandable by a non-specialist audience (like a patient), while preserving all critical medical information, dosages, and instructions accurately.',
      'Compare with the original Spanish text for context if needed.',
      '',
      'Key Instructions:',
      '- Simplify complex medical terms (e.g., "myocardial infarction" -> "heart attack").',
      '- Rephrase complex sentences into shorter, clearer ones.',
      '- Maintain all diagnoses, measurements, drug names, dosages, and instructions accurately.',
      '- Use active voice where possible.',
      '- Organize information logically, perhaps using bullet points for instructions or lists.',
      '- Do NOT omit any critical information.',
      '- Refer to the original Spanish text if the initial English translation is ambiguous or unclear.',
      '- Only output the simplified plain English text.',
    ].join('\n');

    const userPrompt = `Please simplify the following technical English medical text for a patient.\nOriginal Spanish Text for context: ${payload.data.originalText}\n\nTechnical English Translation: ${payload.data.translatedText}`;

    const plainText = await callChatLLM({
      provider: base.provider,
      model: base.model,
      temperature: base.temperature,
      systemPrompt,
      userPrompt,
    });

    return res.status(200).json({ plainText });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return sendError(res, 500, message);
  }
}
