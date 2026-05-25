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

  const hasPdf = images.some(img => img.type === 'application/pdf');

  // PDFs use content type "document"; images use "image"
  const msgContent = [
    ...images.map(img => {
      if (img.type === 'application/pdf') {
        return {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: img.data }
        };
      } else {
        return {
          type: 'image',
          source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.data }
        };
      }
    }),
    {
      type: 'text',
      text: `Analise estes documentos brasileiros (RG, CPF, CNH, comprovante de residencia) e extraia os dados.
Retorne SOMENTE o JSON abaixo, sem nenhum texto antes ou depois, usando exatamente estas chaves:
{
  "nome": "nome completo da pessoa",
  "cpf": "000.000.000-00",
  "rg": "numero do RG com orgao emissor",
  "nascimento": "YYYY-MM-DD",
  "genero": "Masculino ou Feminino",
  "profissao": "profissao ou ocupacao",
  "nacionalidade": "Brasileiro ou Brasileira",
  "endereco": "Rua X, 123, Bairro, Cidade - UF, CEP 00000-000",
  "email": "email se houver",
  "telefone": "telefone se houver"
}
Use null para campos nao encontrados. O campo "endereco" deve ser uma unica string de texto, nunca um objeto.`
    }
  ];

  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };

  // Beta header required for PDF document blocks
  if (hasPdf) {
    headers['anthropic-beta'] = 'pdfs-2024-09-25';
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 1024,
        messages: [{ role: 'user', content: msgContent }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(500).json({ error: 'Erro na API Claude', details: err });
    }

    const data = await response.json();
    const text = data.content[0].text.trim();

    try {
      const match = text.match(/\{[\s\S]*\}/);
      const json = JSON.parse(match ? match[0] : text);
      return res.json({ success: true, dados: json });
    } catch (e) {
      console.error('JSON parse error:', text);
      return res.status(500).json({ error: 'Erro ao processar resposta', raw: text });
    }
  } catch (e) {
    console.error('Fetch error:', e);
    return res.status(500).json({ error: 'Erro de conexao com a API' });
  }
}
