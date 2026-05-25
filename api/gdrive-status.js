// api/gdrive-status.js — diagnóstico, remover após correção
export default async function handler(req, res) {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const status = { kv_url_present: !!url, kv_token_present: !!token };
  if (!url || !token) return res.json({ ...status, erro: 'KV não configurado' });

  // Lê tokens do KV
  let tokens = null;
  try {
    const getRes = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['GET', 'gdrive_tokens']]),
    });
    const getBody = await getRes.json();
    const raw = getBody[0]?.result;
    status.tokens_saved = !!raw;
    if (raw) {
      tokens = JSON.parse(raw);
      status.has_access_token  = !!tokens.access_token;
      status.has_refresh_token = !!tokens.refresh_token;
      status.token_expires_in  = tokens.expiry_date
        ? Math.round((tokens.expiry_date - Date.now()) / 1000) + 's'
        : 'desconhecido';
      status.token_scope = tokens.scope || 'não informado';
    }
  } catch (e) { status.kv_error = e.message; }

  if (!tokens?.access_token) return res.json({ ...status, calendar_test: 'SKIP - sem token' });

  // Testa Drive
  try {
    const driveRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    status.drive_status = driveRes.status;
    if (driveRes.ok) { const d = await driveRes.json(); status.drive_user = d.user?.emailAddress; }
  } catch (e) { status.drive_error = e.message; }

  // Testa Calendar
  try {
    const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    status.calendar_status = calRes.status;
    if (calRes.ok) {
      const d = await calRes.json();
      status.calendar_count = (d.items || []).length;
      status.calendar_names = (d.items || []).map(c => c.summary).join(', ');
    } else {
      const err = await calRes.json().catch(() => ({}));
      status.calendar_error = err.error?.message || calRes.status;
    }
  } catch (e) { status.calendar_error = e.message; }

  return res.json(status);
}
