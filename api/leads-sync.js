// api/leads-sync.js
// Frontend chama este endpoint a cada 30s para buscar leads novos do Meta Ads
// Retorna os leads pendentes e limpa a fila do KV

const KV_KEY = 'leads_pendentes';

function kvCreds() {
  return {
    url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function kvGetAndClear() {
  const { url, token } = kvCreds();
  if (!url || !token) return [];

  // LRANGE + DEL em pipeline atômico
  const res = await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([
      ['LRANGE', KV_KEY, '0', '-1'],
      ['DEL', KV_KEY],
    ]),
  });
  if (!res.ok) return [];

  const data = await res.json();
  const raw  = data[0]?.result || [];
  return raw.map(item => {
    try { return typeof item === 'string' ? JSON.parse(item) : item; }
    catch { return null; }
  }).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  try {
    const leads = await kvGetAndClear();
    if (leads.length) console.log(`[Sync] ${leads.length} lead(s) entregue(s) ao frontend`);
    return res.status(200).json({ ok: true, leads });
  } catch(e) {
    console.error('[Sync] Erro:', e.message);
    return res.status(200).json({ ok: true, leads: [] }); // nunca quebra o frontend
  }
}
