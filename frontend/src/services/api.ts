import axios from 'axios';
import type { Provider } from '../types';

const API_BASE_URL = import.meta.env.PROD
  ? 'https://hcailt-backend.vercel.app'
  : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function domainCheck(params: {
  text: string;
  provider: Provider;
  model: string;
  temperature: number;
}) {
  const { data } = await client.post('/api/domain-check', params);
  return data as { isMedical: boolean; raw?: string };
}

export async function translate(params: {
  text: string;
  provider: Provider;
  model: string;
  temperature: number;
}) {
  const { data } = await client.post('/api/translate', params);
  return data as { translation: string };
}

export async function simplify(params: {
  originalText: string;
  translatedText: string;
  provider: Provider;
  model: string;
  temperature: number;
}) {
  const { data } = await client.post('/api/plain', params);
  return data as { plainText: string };
}

export async function qualityEstimate(params: {
  originalText: string;
  translatedText: string;
  simplifiedText: string;
  provider: Provider;
  model: string;
  temperature: number;
}) {
  const { data } = await client.post('/api/qe', params);
  return data as { score: number };
}