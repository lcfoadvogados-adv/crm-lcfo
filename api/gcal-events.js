// api/gcal-events.js
// Busca eventos do Google Calendar do mês solicitado
// GET /api/gcal-events?start=YYYY-MM-DD&end=YYYY-MM-DD

function kvCreds() {
  return {
    url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function kvGet(key) {
  const { url, token } = kvCreds();
  if (!url || !token) return null;
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', key]]),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0]?.result ?? null;
}

async function kvSet(key, value) {
  const { url, token } = kvCreds();
  if (!url || !token) return false;
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, value]]),
  });
  return res.ok;
}

async function getAccessToken() {
  const raw = await kvGet('gdrive_tokens');
  if (!raw) throw new Error('Google não conectado. Acesse /api/gdrive-auth para autorizar.');
  const tokens = JSON.parse(raw);
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date > Date.now() + 90_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new Error('Refresh token ausente. Reconecte em /api/gdrive-auth.');
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GDRIVE_CLIENT_ID,
      client_secret: process.env.GDRIVE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const novo = await refreshRes.json();
  if (novo.error) throw new Error('Erro ao renovar token: ' + novo.error);
  const atualizado = { ...tokens, access_token: novo.access_token, expiry_date: Date.now() + (novo.expires_in || 3600) * 1000 };
  await kvSet('gdrive_tokens', JSON.stringify(atualizado));
  return atualizado.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ ok: false, erro: 'Informe start e end (YYYY-MM-DD)' });

  try {
    const accessToken = await getAccessToken();

    // Busca calendários: primary + todos listados
    const calListRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=25',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const calList = await calListRes.json();
    const calendars = (calList.items || []).filter(c => c.selected !== false);

    const timeMin = encodeURIComponent(start + 'T00:00:00-03:00');
    const timeMax = encodeURIComponent(end   + 'T23:59:59-03:00');

    // Busca eventos de todos os calendários em paralelo
    const results = await Promise.all(
      calendars.map(cal =>
        fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
          + `?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        .then(r => r.json())
        .then(data => (data.items || []).map(ev => ({
          ...ev,
          calendarId:    cal.id,
          calendarName:  cal.summary,
          calendarColor: cal.backgroundColor || '#1a73e8',
        })))
        .catch(() => [])
      )
    );

    const events = results.flat().filter(ev => ev.status !== 'cancelled');
    console.log(`[GCal] ${events.length} eventos de ${calendars.length} calendários (${start} → ${end})`);
    return res.json({ ok: true, events });
  } catch (e) {
    const semScope = /calendar/i.test(e.message) || e.message.includes('insufficientPermissions');
    const naoConectado = /não conectado|Reconecte/i.test(e.message);
    console.error('[GCal] Erro:', e.message);
    return res.status(naoConectado || semScope ? 401 : 500).json({
      ok: false, erro: e.message, naoConectado: naoConectado || semScope,
    });
  }
}
