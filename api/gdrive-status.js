// api/gdrive-status.js — diagnóstico temporário, remover após correção
export default async function handler(req, res) {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  const status = {
    kv_url_present: !!url,
    kv_token_present: !!token,
    kv_url_prefix: url ? url.substring(0, 50) : null,
    gdrive_client_id: !!process.env.GDRIVE_CLIENT_ID,
    gdrive_client_secret: !!process.env.GDRIVE_CLIENT_SECRET,
  };

  if (!url || !token) {
    return res.json({ ...status, kv_test: 'SKIP - sem credenciais', tokens_saved: false });
  }

  // Testa SET
  try {
    const setRes = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', 'lcfo_test', 'ok']]),
    });
    const setBody = await setRes.json();
    status.kv_set_status = setRes.status;
    status.kv_set_result = setBody;
  } catch (e) {
    status.kv_set_error = e.message;
  }

  // Testa GET de tokens
  try {
    const getRes = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['GET', 'gdrive_tokens']]),
    });
    const getBody = await getRes.json();
    const raw = getBody[0]?.result;
    status.tokens_saved = !!raw;
    status.tokens_preview = raw ? raw.substring(0, 80) + '...' : null;
  } catch (e) {
    status.kv_get_error = e.message;
  }

  return res.json(status);
}
