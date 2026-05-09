export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key nao configurada' });
  const { images } = req.body;
  if (!images || !images.length) return res.status(400).json({ error: 'Nenhum documento enviado' });
  const msgContent = [
    ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } })),
    { type: 'text', text: 'Analise estes documentos brasileiros e extraia: nome, cpf, rg, nascimento (YYYY-MM-DD), genero, profissao, nacionalidade, endereco, email, telefone. Retorne SOMENTE JSON valido com esses campos (null se nao encontrado).' }
  ];
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: msgContent }] })
  });
  if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: 'Erro na API Claude', details: err }); }
  const data = await response.json();
  const text = data.content[0].text.trim();
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const json = JSON.parse(match ? match[0] : text);
    return res.json({ success: true, dados: json });
  } catch (e) { return res.status(500).json({ error: 'Erro ao processar resposta', raw: text }); }
}
