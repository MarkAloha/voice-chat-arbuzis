import './load-env.ts';
import express from 'express';
import { createApiRouter } from './src/api/routes.ts';

const app = express();
const port = Number(process.env['API_PORT'] ?? 3000);

app.use('/api', createApiRouter());

app.listen(port, () => {
  console.log(`API: http://localhost:${port}/api`);
});
