// api/transcrever.js
// Transcrição de áudio/vídeo via Groq Whisper API
// Env var: GROQ_API_KEY  (gratuito em console.groq.com)
// Body: { audio: "<base64 WAV>", filename: "audio.wav" }

export const config = {
  api: { bodyParser: { sizeLimit: '26mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(200).json({ ok: false, erro: 'GROQ_API_KEY não configurado no Vercel' });

  try {
    const { audio, filename = 'audio.wav' } = req.body || {};
    if (!audio) return res.status(400).json({ ok: false, erro: 'Campo "audio" não fornecido' });

    const buffer = Buffer.from(audio, 'base64');
    const blob   = new Blob([buffer], { type: 'audio/wav' });

    const form = new FormData();
    form.append('file', blob, filename);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}` },
      body:    form,
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[Transcrever] Groq erro:', r.status, err);
      return res.status(200).json({ ok: false, erro: `Groq retornou ${r.status}` });
    }

    const texto = (await r.text()).trim();
    console.log(`[Transcrever] OK — ${texto.length} caracteres`);
    return res.status(200).json({ ok: true, texto });
  } catch(e) {
    console.error('[Transcrever] Erro:', e.message);
    return res.status(200).json({ ok: false, erro: e.message });
  }
}
