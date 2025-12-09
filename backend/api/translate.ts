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

    const systemPrompt = [
      'You are a professional medical translator, specialized in translation from Spanish into English.',
      'Your translations have very high quality, and you always respect the adequacy and fluency of the translations.',
      'Your task is to convert medical texts from Spanish to English, doing an appropriate translation for technical and specialised concepts.',
      '',
      'Key Instructions:',
      'Terminology adherence: Use validated equivalent concepts (E.g.: "hipertensión arterial" -> "hypertension", "taquicardia sinusal" -> "sinus tachycardia").',
      'Do not change the format: Transform the abbreviations, if applicable (E.g.: HTA -> HTN), the codes like ICD-10 (not CIE-10), the numerical values (E.g.: 160 mg/dL) and the structure of the document (sections, bullet points).',
      'Clinical context: Use appropriate medical terms in the English clinical world (E.g.: "edema maleolar" -> "ankle edema" instead of "swelling").',
      'Trademarks:',
      'Drugs: Keep the scientific names (E.g.: "enalapril" -> "enalapril", without using trademarks).',
      'Ambiguities: If a term has multiple translations, keep the most common one in formal contexts (E.g.: "disnea" -> "dyspnea" instead of "shortness of breath").',
      'Additional notes:',
      'Avoid making personal interpretations or summarising.',
      'Mark between brackets [ ] any potential translation in which you have doubts.',
      'Only output the translation, nothing else before or after.',
    ].join('\n');

    const userPrompt = `Translate the following health record into English, keeping all the format and structure. Text: ${payload.data.text}`;

    const translation = await callChatLLM({
      provider: base.provider,
      model: base.model,
      temperature: base.temperature,
      systemPrompt,
      userPrompt,
    });

    return res.status(200).json({ translation });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return sendError(res, 500, message);
  }
}
