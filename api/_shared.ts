import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

export type Provider = 'openai' | 'google' | 'groq' | 'fireworks';

const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'https://hcailt.awordz.com,http://localhost:5173,http://localhost:5174')
  .split(/[,\s]+/)
  .map((o) => o.trim())
  .filter(Boolean);

// Helper to check if origin is allowed
const isOriginAllowed = (origin: string | undefined) => {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  return origin.endsWith('.vercel.app'); // Allow dynamic Vercel deployments
};

provider: z.enum(['openai', 'google', 'groq', 'fireworks']).default('openai'),
  model: z.string().min(1, 'Model is required'),
    temperature: z.number().min(0).max(1).default(0.3),
});

const ensureNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number') return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeBaseInput = (data: unknown) => {
  const parsed = baseSchema.safeParse({
    ...((data as Record<string, unknown>) || {}),
    temperature: ensureNumber((data as Record<string, unknown>)?.temperature, 0.3),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
};

const ensureApiKey = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`${name} is missing. Set it as an environment variable.`);
  }
  return value;
};

export async function callChatLLM(params: {
  provider: Provider;
  model: string;
  temperature: number;
  systemPrompt: string;
  userPrompt: string;
}) {
  const { provider, model, temperature, systemPrompt, userPrompt } = params;
  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: ensureApiKey(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY') });

    // gpt-5-mini (likely o1-mini based) only passes with temperature=1
    const finalTemperature = model === 'gpt-5-mini' ? 1 : temperature;

    const completion = await client.chat.completions.create({
      model,
      temperature: finalTemperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const content = completion.choices[0]?.message?.content?.trim() || '';
    const clean = content.replace(/<tool_call>[\s\S]*?<\/think>/g, '').trim();
    return clean || (content ? `⚠️ Model only output reasoning (no final answer found):\n\n${content}` : '');
  }

  if (provider === 'groq') {
    const client = new Groq({ apiKey: ensureApiKey(process.env.GROQ_API_KEY, 'GROQ_API_KEY') });
    const completion = await client.chat.completions.create({
      model,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const content = completion.choices[0]?.message?.content?.trim() || '';
    const clean = content.replace(/<tool_call>[\s\S]*?<\/think>/g, '').trim();
    return clean || (content ? `⚠️ Model only output reasoning (no final answer found):\n\n${content}` : '');
  }

  if (provider === 'google') {
    const key = ensureApiKey(process.env.GOOGLE_API_KEY, 'GOOGLE_API_KEY');
    const genAI = new GoogleGenerativeAI(key);
    const modelClient = genAI.getGenerativeModel({ model });
    // Google models do not support separate system prompts in the same way; merge prompts.
    const content = `${systemPrompt}\n\n${userPrompt}`;

    let lastError: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await modelClient.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: content }],
            },
          ],
          generationConfig: {
            temperature,
          },
        });
        const text = result.response.text()?.trim() || '';
        const clean = text.replace(/<tool_call>[\s\S]*?<\/think>/g, '').trim();
        return clean || (text ? `⚠️ Model only output reasoning (no final answer found):\n\n${text}` : '');
      } catch (error: any) {
        lastError = error;
        // Check for 503 Service Unavailable or "overloaded" messages
        const errorMessage = error.toString().toLowerCase();
        const isRetryable = errorMessage.includes('503') || errorMessage.includes('overloaded');

        if (isRetryable && attempt < 3) {
          console.warn(`Google 503/Overloaded. Retrying attempt ${attempt + 1}...`);
          // Exponential backoff: 1s, 2s
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  if (provider === 'fireworks') {
    const apiKey = ensureApiKey(process.env.FIREWORKS_API_KEY, 'FIREWORKS_API_KEY');
    const resp = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Fireworks error ${resp.status}: ${errText}`);
    }
    const json = (await resp.json()) as any;
    const contentRaw = json?.choices?.[0]?.message?.content;
    const content = typeof contentRaw === 'string' ? contentRaw.trim() : Array.isArray(contentRaw) ? contentRaw.join('\n').trim() : '';
    const clean = content.replace(/<tool_call>[\s\S]*?<\/think>/g, '').trim();
    return clean || (content ? `⚠️ Model only output reasoning (no final answer found):\n\n${content}` : '');
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export const addCors = (req: VercelRequest, res: VercelResponse) => {
  const reqOrigin = req.headers.origin;
  const originToAllow = isOriginAllowed(reqOrigin) ? reqOrigin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', originToAllow || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Debug-Origin', originToAllow);
  res.setHeader('X-Debug-Allowed', allowedOrigins.join('|'));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
};

export const sendError = (res: VercelResponse, status: number, message: string) => {
  res.status(status).json({ error: message });
};

export const parseRequestBody = (req: VercelRequest) => {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body as string);
  } catch (e) {
    return {};
  }
};