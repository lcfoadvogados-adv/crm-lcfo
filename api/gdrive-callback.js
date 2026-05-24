// api/gdrive-callback.js
// Recebe o code do OAuth, troca por tokens e salva no Vercel KV

async function kvSet(key, value) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return false;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(value),
  });
  return res.ok;
}

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    console.error('[GDrive] Erro OAuth:', error);
    return res.redirect('/?gdrive=error&msg=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.status(400).send('Código de autorização ausente.');
  }

  const clientId     = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const redirectUri  = process.env.GDRIVE_REDIRECT_URI
    || 'https://crm-lcfo.vercel.app/api/gdrive-callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    // Adiciona timestamp de expiração
    tokens.expiry_date = Date.now() + (tokens.expires_in || 3600) * 1000;

    // Salva no KV como string JSON
    await kvSet('gdrive_tokens', JSON.stringify(tokens));

    console.log('[GDrive] ✅ Tokens salvos. Drive conectado com sucesso.');
    return res.redirect('/?gdrive=ok');
  } catch (e) {
    console.error('[GDrive] Erro ao trocar tokens:', e.message);
    return res.redirect('/?gdrive=error&msg=' + encodeURIComponent(e.message));
  }
}
