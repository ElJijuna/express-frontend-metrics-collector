// Demo: `npm run example`, open http://localhost:3000 and watch the terminal.
import express from 'express';
import { metricsCollector } from '../dist/server/index.js';

const app = express();

app.use(
  metricsCollector({
    enabled: true,
    client: {
      app: 'example-shell',
      env: 'local',
      batchSize: 5,
      flushInterval: 5_000,
      console: true,
    },
    onBatch: (batch) => {
      console.dir(batch, { depth: 4 });
    },
  }),
);
app.get('/api/ok', (_req, res) => {
  res.json({ ok: true });
});
app.get('/api/slow', (_req, res) => {
  setTimeout(() => res.json({ slow: true }), 800);
});
app.use(express.static(new URL('./public/', import.meta.url).pathname));

app.listen(3000, () => {
  console.log('Example running on http://localhost:3000');
});
