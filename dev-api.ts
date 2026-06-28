import './load-env.ts';
import express from 'express';
import { createApiRouter } from './src/api/routes.ts';
import { getConfig } from './src/api/config.ts';

const app = express();
const port = Number(process.env['API_PORT'] ?? 3000);

app.use('/api', createApiRouter());

app.listen(port, () => {
    const config = getConfig();
    console.log(`API: http://localhost:${port}/api`);
    console.log(`  room=${config.roomName}, max=${config.roomMaxParticipants}, join-rate-limit=20/15min`);
});
