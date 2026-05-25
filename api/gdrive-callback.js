// api/gdrive-callback.js
// Recebe o code do OAuth, troca por tokens e salva no KV

async function kvSet(key, value) {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error('[KV] kvSet: credenciais ausentes', { hasUrl: !!url, hasToken: !!token });
    return false;
  }
  console.log('[KV] kvSet url base:', url.substring(0, 40));
  // Usa formato pipeline do Upstash (mais confiável)
  const res = await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([['SET', key, value]]),
  });
  const body = await res.text();
  console.log('[KV] kvSet response:', res.status, body.substring(0, 100));
  return res.ok;
}

export default async function handler(req, res) {
  const { code, error } = req.query;

  console.log('[GDrive] callback chamado, code presente:', !!code, 'error:', error);

  if (error) {
    console.error('[GDrive] Erro OAuth recebido do Google:', error);
    return res.redirect('/?gdrive=error&msg=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.status(400).send('Código de autorização ausente.');
  }

  const clientId     = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const redirectUri  = process.env.GDRIVE_REDIRECT_URI
    || 'https://crm-lcfo.vercel.app/api/gdrive-callback';

  console.log('[GDrive] clientId presente:', !!clientId, 'clientSecret presente:', !!clientSecret);

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
    console.log('[GDrive] Token exchange status:', tokenRes.status, 'error:', tokens.error, 'has_access_token:', !!tokens.access_token, 'has_refresh_token:', !!tokens.refresh_token);

    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    tokens.expiry_date = Date.now() + (tokens.expires_in || 3600) * 1000;

    const saved = await kvSet('gdrive_tokens', JSON.stringify(tokens));
    console.log('[GDrive] Tokens salvos no KV:', saved);

    if (!saved) {
      console.error('[GDrive] Falha ao salvar tokens no KV!');
      return res.redirect('/?gdrive=error&msg=' + encodeURIComponent('Falha ao salvar tokens no KV'));
    }

    console.log('[GDrive] ✅ Drive conectado com sucesso.');
    return res.redirect('/?gdrive=ok');
  } catch (e) {
    console.error('[GDrive] Erro:', e.message);
    return res.redirect('/?gdrive=error&msg=' + encodeURIComponent(e.message));
  }
}
