// api/leads-sync.js
// Frontend chama este endpoint a cada 30s para buscar leads novos do Meta Ads
// Retorna os leads pendentes e limpa a fila do KV

const KV_KEY = 'leads_pendentes';

async function kvGetAll() {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return [];

  // lrange retorna todos os itens da lista
  const res = await fetch(`${url}/lrange/${KV_KEY}/0/-1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.result || []).map(item => {
    try { return typeof item === 'string' ? JSON.parse(item) : item; }
    catch { return null; }
  }).filter(Boolean);
}

async function kvClear() {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(`${url}/del/${KV_KEY}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const leads = await kvGetAll();
    if (leads.length > 0) await kvClear(); // Limpa após entregar
    return res.status(200).json({ ok: true, leads });
  } catch(e) {
    console.error('[Sync] Erro:', e.message);
    return res.status(200).json({ ok: true, leads: [] }); // Nunca quebra o frontend
  }
}
