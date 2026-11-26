import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, nowIso } from '../db.js';
import { fail, route } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { requireUser } from './me.js';

export const router = Router();

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const MAX_CONTENT = 8000;
const MAX_HISTORY = 30;
const MAX_CONVERSATIONS = 60;

const SYSTEM_PROMPT = [
  'You are Chatter AI, the assistant built into the Chatter community platform.',
  'Be concise, friendly and useful. Use short paragraphs and markdown lists when they help.',
  'You only receive the messages the user deliberately sends in this conversation.',
].join(' ');

router.use(requireUser);
router.use((req, _res, next) => {
  req.rateLimitKey = req.user.id;
  next();
});

function provider() {
  const key = (process.env.GROQ_API_KEY || '').trim();
  const model = (process.env.GROQ_MODEL || '').trim() || DEFAULT_MODEL;
  return { key, model, configured: key.length > 0 };
}

function conversationFor(userId, id) {
  const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) fail(404, 'ai_conversation_not_found', 'That AI conversation is no longer available.');
  return row;
}

function messageView(row) {
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at };
}

function conversationView(row) {
  const stats = db
    .prepare('SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = ?')
    .get(row.id);
  const last = db
    .prepare("SELECT content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(row.id);
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: stats?.count ?? 0,
    preview: last ? String(last.content).slice(0, 140) : null,
  };
}

router.get('/status', (req, res) => {
  const config = provider();
  res.json({
    provider: 'groq',
    configured: config.configured,
    model: config.model,
    defaultModel: DEFAULT_MODEL,
    streaming: true,
    limits: { maxContent: MAX_CONTENT, maxHistory: MAX_HISTORY, maxConversations: MAX_CONVERSATIONS },
    configuredBy: config.configured ? 'environment' : null,
    user: req.user.id,
  });
});

router.get('/conversations', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(req.user.id, MAX_CONVERSATIONS);
  res.json({ conversations: rows.map(conversationView) });
});

router.post(
  '/conversations',
  route(async (req, res) => {
    const data = z
      .object({ title: z.string().trim().min(1).max(80).optional() })
      .parse(req.body ?? {});
    const existing = db
      .prepare('SELECT COUNT(*) AS count FROM ai_conversations WHERE user_id = ?')
      .get(req.user.id).count;
    if (existing >= MAX_CONVERSATIONS) {
      fail(429, 'ai_conversation_limit', `You have reached ${MAX_CONVERSATIONS} AI conversations. Delete an old one to start a new chat.`);
    }
    const id = randomUUID();
    const now = nowIso();
    db.prepare(
      'INSERT INTO ai_conversations (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, req.user.id, data.title || 'New chat', provider().model, now, now);
    const row = conversationFor(req.user.id, id);
    res.status(201).json({ conversation: conversationView(row) });
  }),
);

router.get(
  '/conversations/:id',
  route(async (req, res) => {
    const conversation = conversationFor(req.user.id, req.params.id);
    const messages = db
      .prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(conversation.id);
    res.json({ conversation: conversationView(conversation), messages: messages.map(messageView) });
  }),
);

router.delete(
  '/conversations/:id',
  route(async (req, res) => {
    const conversation = conversationFor(req.user.id, req.params.id);
    db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(conversation.id);
    res.json({ ok: true });
  }),
);

const sendLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyPrefix: 'ai-message',
  message: 'Chatter AI is receiving a lot of messages from you. Wait a moment and try again.',
});

/**
 * Streams a Groq completion as Server-Sent Events.
 * Event shapes: {type:'delta', text} | {type:'done', message} | {type:'error', message, code}
 */
router.post(
  '/conversations/:id/messages',
  sendLimit,
  route(async (req, res) => {
    const conversation = conversationFor(req.user.id, req.params.id);
    const data = z
      .object({ content: z.string().trim().min(1, 'Write a message first.').max(MAX_CONTENT, `Messages are limited to ${MAX_CONTENT} characters.`) })
      .parse(req.body ?? {});
    const config = provider();

    const now = nowIso();
    const userMessageId = randomUUID();
    db.prepare(
      'INSERT INTO ai_messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userMessageId, conversation.id, 'user', data.content, null, now);

    const firstExchange = db
      .prepare('SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = ?')
      .get(conversation.id).count;
    const title =
      firstExchange <= 1
        ? data.content.replace(/\s+/g, ' ').slice(0, 60) || 'New chat'
        : conversation.title;
    db.prepare('UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, conversation.id);

    if (!config.configured) {
      res.status(503).json({
        error: {
          code: 'ai_not_configured',
          message:
            'Chatter AI is not configured yet. Add GROQ_API_KEY in Settings → Environment variables, then restart the app.',
        },
      });
      return;
    }

    const history = db
      .prepare('SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(conversation.id, MAX_HISTORY)
      .reverse()
      .map((row) => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content }));

    const controller = new AbortController();
    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
      controller.abort();
    });

    let upstream;
    try {
      upstream = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          temperature: 0.7,
          max_tokens: 1024,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (!clientGone) {
        fail(502, 'ai_unreachable', 'Chatter AI could not reach Groq. Check the server connection and try again.');
      }
      return;
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      const status = upstream.status;
      let code = 'ai_provider_error';
      let message = 'Groq rejected the request. Try again in a moment.';
      if (status === 401 || status === 403) {
        code = 'ai_invalid_key';
        message = 'The configured Groq API key was rejected. Update GROQ_API_KEY in Settings → Environment variables.';
      } else if (status === 429) {
        code = 'ai_rate_limited';
        message = 'Groq rate limit reached. Wait a moment and try again.';
      } else if (status === 404) {
        code = 'ai_model_unavailable';
        message = 'The configured Groq model is not available. Check GROQ_MODEL or remove it to use the default model.';
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[chatter] groq ${status}: ${detail.slice(0, 400)}`);
      }
      fail(status === 429 ? 429 : 502, code, message);
      return;
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (payload) => {
      if (clientGone) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({ type: 'start', model: config.model, userMessageId });

    let answer = '';
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for await (const chunk of upstream.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const text = parsed?.choices?.[0]?.delta?.content;
            if (typeof text === 'string' && text.length > 0) {
              answer += text;
              send({ type: 'delta', text });
            }
          } catch {
            // Ignore keep-alive or malformed fragments from the provider.
          }
        }
      }
    } catch (error) {
      if (!clientGone) {
        send({
          type: 'error',
          code: 'ai_stream_interrupted',
          message: 'The Groq response was interrupted. The partial reply was kept in this conversation.',
        });
      }
    }

    if (answer.trim().length > 0) {
      const assistantId = randomUUID();
      db.prepare(
        'INSERT INTO ai_messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(assistantId, conversation.id, 'assistant', answer, config.model, nowIso());
      db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversation.id);
      send({
        type: 'done',
        message: { id: assistantId, role: 'assistant', content: answer, createdAt: nowIso() },
      });
    } else if (!clientGone) {
      send({ type: 'error', code: 'ai_empty_reply', message: 'Groq returned an empty reply. Try sending your message again.' });
    }

    if (!clientGone) res.end();
  }),
);
