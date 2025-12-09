import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { addCors, callChatLLM, normalizeBaseInput, parseRequestBody, sendError } from './_shared.js';

const payloadSchema = z.object({
  originalText: z.string().min(1, 'Original text is required'),
  translatedText: z.string().min(1, 'Translated text is required'),
  simplifiedText: z.string().min(1, 'Simplified text is required'),
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
      'You are an expert bilingual (Spanish-English) medical translation quality evaluator.',
      'Your task is to analyze a simplified English version against the original Spanish text and the initial technical English translation.',
      'Provide a quality score percentage (0-100%) based on the following criteria:',
      '',
      '1. Accuracy (Weight: 50%): Does the simplification faithfully represent ALL critical medical facts, diagnoses, measurements, dosages, and instructions from the original Spanish text, without distortion or omission? Check against the original Spanish AND the technical English translation.',
      '2. Clarity & Simplicity (Weight: 30%): Is the language clear, simple, and easily understandable for a layperson, while still being medically correct? Are complex terms appropriately simplified?',
      '3. Completeness (Weight: 20%): Are all essential pieces of information from the original text present in the simplified version? Were any non-critical details reasonably omitted for clarity, or were important details lost?',
      '',
      'Instructions:',
      '- Deduct points significantly for any factual inaccuracies, especially regarding diagnoses, treatments, or dosages. A single critical error might justify a score below 50%.',
      '- Consider the target audience (patient) when evaluating clarity.',
      "- Output ONLY the final numerical percentage score (e.g., '82'). Do not include the '%' sign or any other text.",
    ].join('\n');

    const userPrompt = [
      'Original Spanish Text:',
      payload.data.originalText,
      '',
      'Technical English Translation:',
      payload.data.translatedText,
      '',
      'Simplified English Text to Evaluate:',
      payload.data.simplifiedText,
      '',
      'Provide the quality score (0-100):',
    ].join('\n');

    const rawScore = await callChatLLM({
      provider: base.provider,
      model: base.model,
      temperature: base.temperature,
      systemPrompt,
      userPrompt,
    });

    const match = rawScore.match(/\d+/);
    if (!match) {
      return sendError(res, 422, `Could not parse QE score from response: '${rawScore}'`);
    }
    const scoreNum = Number(match[0]);
    if (Number.isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      return sendError(res, 422, `QE score '${match[0]}' outside 0-100 range. Raw: '${rawScore}'`);
    }

    return res.status(200).json({ score: scoreNum });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return sendError(res, 500, message);
  }
}
