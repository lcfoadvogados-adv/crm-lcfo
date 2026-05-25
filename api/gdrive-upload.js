// api/gdrive-upload.js
// Faz upload de arquivos (base64) para uma pasta do Google Drive

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
  if (!raw) throw new Error('Google Drive não conectado.');
  const tokens = JSON.parse(raw);
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date > Date.now() + 90_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new Error('Refresh token ausente. Reconecte o Google Drive.');
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { folderId, files } = req.body || {};
  if (!folderId || !files || !files.length) {
    return res.status(400).json({ ok: false, erro: 'folderId e files são obrigatórios' });
  }

  try {
    const accessToken = await getAccessToken();
    const results = [];

    for (const file of files) {
      try {
        const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
        const fileBuffer = Buffer.from(file.data, 'base64');
        const boundary = `lcfo_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const pre = Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
          'utf-8'
        );
        const post = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
        const body = Buffer.concat([pre, fileBuffer, post]);

        const uploadRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary="${boundary}"`,
            },
            body,
          }
        );

        const data = await uploadRes.json();
        console.log(`[Drive Upload] ${file.name}:`, data.id ? 'OK' : JSON.stringify(data.error));
        results.push({ name: file.name, ok: !!data.id, id: data.id });
      } catch (e) {
        console.error(`[Drive Upload] Erro em ${file.name}:`, e.message);
        results.push({ name: file.name, ok: false, erro: e.message });
      }
    }

    return res.json({ ok: results.some(r => r.ok), results });
  } catch (e) {
    console.error('[Drive Upload] Erro geral:', e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
