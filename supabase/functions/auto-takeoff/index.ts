// Supabase Edge Function: AI takeoff from construction drawings.
// Deploy:  supabase functions deploy auto-takeoff
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional: AUTO_TAKEOFF_DAILY_LIMIT=40)
//
// Two steps (see prompt.ts):
//   mode "views"   → identify plan / elevation / section / schedule views on each sheet
//   mode "takeoff" → ordered takeoff from those views, with queries for anything estimated
// The browser sends page images (tiled for legibility) + any PDF text. Progress streams back as NDJSON lines.

import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { ELEMENTS, TAKEOFF_SYSTEM, VIEWS_SYSTEM, takeoffContext, takeoffSchema, viewsSchema } from './prompt.ts';

const MODEL = 'claude-opus-5-5';
const DAILY_LIMIT = Number(Deno.env.get('AUTO_TAKEOFF_DAILY_LIMIT') ?? '40');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SheetIn = {
  index: number;
  name: string;
  overview: string; // base64 JPEG of the whole page
  tiles: Array<{ data: string; label: string }>; // base64 JPEG crops, labelled with their pixel position
  text: string; // "x,y,angle,text" lines from the PDF (may be empty)
};

type Body = {
  mode: 'views' | 'takeoff';
  sheets: SheetIn[];
  categories?: string[];
  projectName?: string;
  views?: unknown;
  answers?: Array<{ id: string; question: string; answer: string }>;
};

/** Per sheet: overview, labelled crops, extracted text. Shared by both steps. */
export function sheetContent(sheets: SheetIn[]): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const sh of sheets) {
    content.push({ type: 'text', text: `=== Sheet ${sh.index}: "${sh.name}" — overview of the whole page ===` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: sh.overview } });
    for (const t of sh.tiles) {
      content.push({ type: 'text', text: `Sheet ${sh.index} — enlarged crop: ${t.label}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: t.data } });
    }
    if (sh.text) content.push({ type: 'text', text: `Sheet ${sh.index} — text extracted from the PDF (x,y,angle,text in page pixels):\n${sh.text}` });
  }
  return content;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // ── Auth: only signed-in users (protects your API key from anonymous use) ──
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !userData.user) return json(401, { error: 'Please log in to use Auto takeoff.' });
  const userId = userData.user.id;

  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json(500, { error: 'Auto takeoff is not configured: the ANTHROPIC_API_KEY secret is missing (see SETUP.md).' });

  // ── Daily limit per user ──
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from('ai_runs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(429, { error: `Daily limit of ${DAILY_LIMIT} auto takeoff steps reached. Try again tomorrow.` });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }
  if (!body.sheets?.length || body.sheets.length > 8) return json(400, { error: 'Send between 1 and 8 sheets.' });
  const mode = body.mode === 'views' ? 'views' : 'takeoff';
  const categories = body.categories?.length ? body.categories : ['Other'];

  const { data: run } = await admin
    .from('ai_runs')
    .insert({ user_id: userId, sheets: body.sheets.length, status: 'running', model: `${MODEL} (${mode})` })
    .select('id')
    .single();

  const content = sheetContent(body.sheets);
  if (mode === 'views') {
    content.push({ type: 'text', text: `Project: ${body.projectName || '(unnamed)'}\nIdentify every view on every sheet.` });
  } else {
    content.push({
      type: 'text',
      text:
        `${takeoffContext(body.views ?? [], body.answers ?? [])}\n\n` +
        `Project: ${body.projectName || '(unnamed)'}\n` +
        `Elements (taking-off headings, in order): ${ELEMENTS.join(', ')}\n` +
        `Allowed bill sections: ${categories.join(', ')}\n\n` +
        `Produce the full takeoff in the required order, starting from the plan.`,
    });
  }

  const client = new Anthropic();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      send({ status: mode === 'views' ? 'Finding plans, elevations and sections…' : 'Measuring from the plan…' });
      const ping = setInterval(() => send({ ping: Date.now() }), 10000); // keep the connection alive
      try {
        const s = client.beta.messages.stream({
          model: MODEL,
          max_tokens: mode === 'views' ? 16000 : 64000,
          betas: ['server-side-fallback-2026-07-01'],
          // @ts-ignore — server-side fallback routing (newer than some SDK typings)
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: mode === 'views' ? 'medium' : 'high',
            format: { type: 'json_schema', schema: mode === 'views' ? viewsSchema() : takeoffSchema(categories) },
          },
          system: mode === 'views' ? VIEWS_SYSTEM : TAKEOFF_SYSTEM,
          messages: [{ role: 'user', content }],
        });
        let chars = 0;
        let lastReport = 0;
        s.on('text', (t: string) => {
          chars += t.length;
          if (chars - lastReport > 2000) {
            lastReport = chars;
            send({ status: mode === 'views' ? 'Labelling views…' : `Writing takeoff… (${Math.round(chars / 1000)}k characters)` });
          }
        });
        const msg = await s.finalMessage();
        clearInterval(ping);
        if (msg.stop_reason === 'refusal') throw new Error('The AI declined to process these drawings.');
        if (msg.stop_reason === 'max_tokens') throw new Error('The takeoff was too long to finish — try fewer sheets at once.');
        const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        const result = JSON.parse(text);
        send({ result });
        await admin
          .from('ai_runs')
          .update({ status: 'ok', input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, items: result.items?.length ?? result.views?.length ?? 0 })
          .eq('id', run?.id);
      } catch (e) {
        clearInterval(ping);
        const message =
          e instanceof Anthropic.RateLimitError
            ? 'The AI service is busy — please try again in a minute.'
            : e instanceof Anthropic.AuthenticationError
              ? 'Auto takeoff is misconfigured (invalid ANTHROPIC_API_KEY).'
              : e instanceof Anthropic.APIError
                ? `AI service error (${e.status}). Please try again.`
                : e instanceof Error
                  ? e.message
                  : 'Auto takeoff failed.';
        send({ error: message });
        await admin.from('ai_runs').update({ status: 'error', error: String(e).slice(0, 500) }).eq('id', run?.id);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { ...cors, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
});
