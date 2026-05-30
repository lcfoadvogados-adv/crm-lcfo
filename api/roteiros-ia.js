// api/roteiros-ia.js
// Unifica: transcrição de áudio (Groq Whisper) + geração de script (Claude)
// Body: { action: 'transcrever', audio, filename }
//    ou { action: 'gerar', titulo, tema, linkRef }

export const config = {
  api: { bodyParser: { sizeLimit: '26mb' } },
};

// ─── Transcrição via Groq Whisper ────────────────────────────────────────────

async function transcrever({ audio, filename = 'audio.wav' }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, erro: 'GROQ_API_KEY não configurado no Vercel' };
  if (!audio) return { ok: false, erro: 'Campo "audio" não fornecido' };

  const buffer = Buffer.from(audio, 'base64');
  const blob   = new Blob([buffer], { type: 'audio/wav' });
  const form   = new FormData();
  form.append('file', blob, filename);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'pt');
  form.append('response_format', 'text');

  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}` },
    body:    form,
  });
  if (!r.ok) return { ok: false, erro: `Groq retornou ${r.status}` };
  const texto = (await r.text()).trim();
  console.log(`[Transcrever] OK — ${texto.length} chars`);
  return { ok: true, texto };
}

// ─── Geração de script via Claude ────────────────────────────────────────────

async function gerarScript({ titulo = '', tema = '', linkRef = '' }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, erro: 'ANTHROPIC_API_KEY não configurado' };
  if (!titulo && !tema && !linkRef)
    return { ok: false, erro: 'Informe ao menos o tema ou link de referência' };

  const ctx = [];
  if (titulo)  ctx.push(`Título do roteiro: ${titulo}`);
  if (tema)    ctx.push(`Tema / assunto: ${tema}`);
  if (linkRef) ctx.push(`Link de referência (inspire-se no formato e abordagem): ${linkRef}`);

  const prompt = `Você é um assistente de conteúdo jurídico para o escritório LCFO Advogados, especializado em negociação e revisão de dívidas. Seu cliente é Dr. Leonardo, advogado que produz vídeos curtos (Reels/TikTok) para atrair clientes.

${ctx.join('\n')}

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

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body:    JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) return { ok: false, erro: `Anthropic retornou ${r.status}` };
  const data  = await r.json();
  const texto = data.content?.[0]?.text?.trim() || '';
  console.log(`[GerarScript] OK — ${texto.length} chars`);
  return { ok: true, texto };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  try {
    const body   = req.body || {};
    const action = body.action;

    if (action === 'transcrever') {
      return res.status(200).json(await transcrever(body));
    }
    if (action === 'gerar') {
      return res.status(200).json(await gerarScript(body));
    }
    return res.status(400).json({ ok: false, erro: 'action deve ser "transcrever" ou "gerar"' });
  } catch(e) {
    console.error('[roteiros-ia] Erro:', e.message);
    return res.status(200).json({ ok: false, erro: e.message });
  }
}
