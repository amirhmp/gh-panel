import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { basicAuth } from 'hono/basic-auth';
import { services } from './services.js';

const { PANEL_USERNAME, PANEL_PASSWORD, PANEL_PORT = 3000 } = process.env;
if (!PANEL_USERNAME || !PANEL_PASSWORD) throw new Error('PANEL_USERNAME and PANEL_PASSWORD must be set');

const app = new Hono();
app.use(basicAuth({ username: PANEL_USERNAME, password: PANEL_PASSWORD }));

app.get('/api/services', async (c) => {
  const entries = await Promise.all(Object.entries(services).map(async ([n, s]) => [n, await s.status()]));
  return c.json(Object.fromEntries(entries));
});

// POST /api/services/:name/(start|stop|restart)?port=1234
app.post('/api/services/:name/:action', async (c) => {
  const { name, action } = c.req.param();
  const s = services[name];
  if (!s || !['start', 'stop', 'restart'].includes(action)) return c.json({ error: 'not found' }, 404);
  try {
    if (action !== 'start') await s.stop();
    if (action !== 'stop') await s.start(c.req.query());
    return c.json(await s.status());
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/', (c) => c.html(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Panel</title>
<style>body{font:16px system-ui;max-width:640px;margin:2rem auto;padding:0 1rem}
.row{display:flex;gap:.5rem;align-items:center;padding:.6rem 0;border-bottom:1px solid #ddd}
.row b{flex:1}.dot{width:.7rem;height:.7rem;border-radius:50%;background:#c33}.on{background:#2a2}</style>
<h1>Services</h1><div id=list></div>
<script>
const act = async (n, a) => { const r = await fetch('/api/services/'+n+'/'+a, {method:'POST'}); if(!r.ok) alert((await r.json()).error); load(); };
const load = async () => {
  const d = await (await fetch('/api/services')).json();
  list.innerHTML = Object.entries(d).map(([n,s]) => '<div class=row><span class="dot '+(s.running?'on':'')+'"></span><b>'+n+'</b><small>'+s.info+'</small>'
    + ['start','stop','restart'].map(a => '<button onclick="act(\\''+n+'\\',\\''+a+'\\')">'+a+'</button>').join('') + '</div>').join('');
};
load(); setInterval(load, 5000);
</script>`));

serve({ fetch: app.fetch, port: Number(PANEL_PORT), hostname: '0.0.0.0' }, async () => {
  console.log(`Panel listening on :${PANEL_PORT}`);
  for (const [name, s] of Object.entries(services)) {
    if (!s.autostart) continue;
    try { await s.start(); console.log(`[${name}] started:`, (await s.status()).info); }
    catch (e) { console.error(`[${name}] failed to start:`, e.message); }
  }
});
