import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { clientIp, HttpError } from './lib/http.js';
import { router as authRouter } from './routes/auth.js';
import { router as meRouter } from './routes/me.js';
import { router as usersRouter, statsRouter } from './routes/users.js';
import { router as mediaRouter } from './routes/media.js';
import { router as friendsRouter } from './routes/friends.js';
import { router as conversationsRouter, messagesRouter } from './routes/conversations.js';
import { router as attachmentsRouter } from './routes/attachments.js';
import { router as realtimeRouter } from './routes/realtime.js';
import { router as serversRouter } from './routes/servers.js';
import { router as invitesRouter } from './routes/invites.js';
import { router as callsRouter } from './routes/calls.js';
import { router as adminRouter } from './routes/admin.js';
import { router as notificationsRouter } from './routes/notifications.js';
import { router as aiRouter } from './routes/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- Security headers -------------------------------------------------------
app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    // Inline styles are required for dynamic accent colours and Vite's injected styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  res.set({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// --- Body parsing -----------------------------------------------------------
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// --- CSRF: same-origin check for state-changing requests ---------------------
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next(); // non-browser clients have no Origin; cookie is SameSite=Lax
  try {
    const originHost = new URL(origin).host;
    const expected = req.headers.host;
    if (originHost !== expected) {
      return res.status(403).json({ error: { code: 'csrf_rejected', message: 'This request came from an untrusted origin.' } });
    }
  } catch {
    return res.status(403).json({ error: { code: 'csrf_rejected', message: 'This request came from an untrusted origin.' } });
  }
  next();
});

// --- API --------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  let database = 'ok';
  try {
    db.prepare('SELECT 1').get();
  } catch {
    database = 'error';
  }
  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    app: 'Chatter',
    database,
    mailConfigured: Boolean(process.env.RESEND_API_KEY),
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/users', usersRouter);
app.use('/api', statsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/realtime', realtimeRouter);
app.use('/api/servers', serversRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/calls', callsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationsRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist.' } });
});

// --- Static client ----------------------------------------------------------
const clientDir = path.join(here, '..', 'client', 'dist');
const indexFile = path.join(clientDir, 'index.html');

if (fs.existsSync(indexFile)) {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (/\.(js|css|woff2?|png|svg|webp|ico)$/.test(filePath)) {
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.set('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
} else {
  app.get('/', (_req, res) => {
    res.status(503).type('html').send(
      `<!doctype html><html><body style="font-family:system-ui;background:#070d18;color:#e6eefc;padding:48px">
        <h1>Chatter API is running</h1>
        <p>The client bundle has not been built yet. Run <code>npm run build</code> and restart.</p>
      </body></html>`,
    );
  });
}

// --- Errors -----------------------------------------------------------------
app.use((error, req, res, _next) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { fields: error.details.fields } : {}) },
    });
  }
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'file_too_large', message: 'Images must be 5 MB or smaller.' } });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'The request body was not valid JSON.' } });
  }
  if (error?.status === 401 || error?.status === 403) {
    return res.status(error.status).json({ error: { code: error.code || 'forbidden', message: error.message } });
  }
  if (error?.status === 429) {
    return res.status(429).json({ error: { code: 'rate_limited', message: error.message } });
  }
  console.error(`[chatter] ${req.method} ${req.originalUrl} failed:`, error?.stack || error);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[chatter] listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  if (!process.env.RESEND_API_KEY) {
    console.warn('[chatter] RESEND_API_KEY is not set — verification and reset emails will not be delivered.');
  }
});

function shutdown(signal) {
  console.log(`[chatter] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, clientIp };
