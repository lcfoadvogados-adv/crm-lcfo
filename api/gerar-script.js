// api/gerar-script.js
// Gera script para vídeo usando Claude AI
// Body: { titulo, tema, linkRef }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ ok: false, erro: 'ANTHROPIC_API_KEY não configurado' });

  const { titulo = '', tema = '', linkRef = '' } = req.body || {};
  if (!titulo && !tema && !linkRef)
    return res.status(400).json({ ok: false, erro: 'Informe ao menos o tema ou link de referência' });

  const contextoParts = [];
  if (titulo)  contextoParts.push(`Título do roteiro: ${titulo}`);
  if (tema)    contextoParts.push(`Tema / assunto: ${tema}`);
  if (linkRef) contextoParts.push(`Link de referência (use como inspiração de formato e abordagem): ${linkRef}`);

  const prompt = `Você é um assistente de conteúdo jurídico para o escritório LCFO Advogados, especializado em negociação e revisão de dívidas. Seu cliente é Dr. Leonardo, advogado que produz vídeos curtos (Reels/TikTok) para atrair clientes.

${contextoParts.join('\n')}

Crie um script completo para um vídeo de 60 a 90 segundos seguindo este formato:

**[GANCHO — 0 a 5s]**
(frase que para o scroll imediatamente, apresenta o problema do espectador)

**[DESENVOLVIMENTO — 5 a 70s]**
(explica o problema, apresenta a solução jurídica de forma simples e empática, 2-3 pontos principais)

**[CTA — últimos 10s]**
(chamada clara para ação: clicar no link da bio, mandar mensagem no WhatsApp, etc.)

Instruções:
- Português brasileiro, tom profissional mas acessível e empático
- Escreva exatamente o que deve ser dito na câmera (sem descrições de cena)
- Se o link de referência for de Instagram/TikTok/YouTube, inspire-se no formato e ritmo desse tipo de vídeo
- Não inclua comentários fora do script`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-opus-4-5',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[GerarScript] Anthropic erro:', r.status, err);
      return res.status(200).json({ ok: false, erro: `Erro na API: ${r.status}` });
    }

    const data  = await r.json();
    const texto = data.content?.[0]?.text?.trim() || '';
    console.log(`[GerarScript] OK — ${texto.length} chars`);
    return res.status(200).json({ ok: true, texto });
  } catch(e) {
    console.error('[GerarScript] Erro:', e.message);
    return res.status(200).json({ ok: false, erro: e.message });
  }
}
