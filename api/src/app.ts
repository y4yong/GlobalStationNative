import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { login, loginSchema } from './auth.js';
import { listDramas } from './catalogRepository.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN }));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'globalstation-api' });
});

app.get('/api/v1/dramas', async (_request, response, next) => {
  try {
    response.json(await listDramas());
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/login', async (request, response, next) => {
  try {
    const input = loginSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid email and password are required.' });
      return;
    }
    const result = await login(input.data.email, input.data.password);
    if (!result) {
      response.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      return;
    }
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' });
});
