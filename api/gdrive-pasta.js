// api/gdrive-pasta.js
// Cria (ou encontra) pasta do cliente no Google Drive
// POST { nome, cpf }
// Retorna { ok, folderId, folderUrl, folderName }

// ─── Vercel KV ────────────────────────────────────────────────────────────────

async function kvGet(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result;
}

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

// ─── Gerenciamento de tokens OAuth ───────────────────────────────────────────

async function getAccessToken() {
  const raw = await kvGet('gdrive_tokens');
  if (!raw) throw new Error('Google Drive não conectado. Acesse /api/gdrive-auth para autorizar.');

  const tokens = JSON.parse(raw);

  // Token ainda válido (margem de 90 s)?
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date > Date.now() + 90_000) {
    return tokens.access_token;
  }

  // Precisa renovar
  if (!tokens.refresh_token) {
    throw new Error('Refresh token ausente. Reconecte o Google Drive em /api/gdrive-auth.');
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.GDRIVE_CLIENT_ID,
      client_secret: process.env.GDRIVE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  const novo = await refreshRes.json();
  if (novo.error) throw new Error('Erro ao renovar token: ' + novo.error);

  const atualizado = {
    ...tokens,
    access_token: novo.access_token,
    expiry_date:  Date.now() + (novo.expires_in || 3600) * 1000,
  };
  await kvSet('gdrive_tokens', JSON.stringify(atualizado));
  console.log('[GDrive] Token renovado.');
  return atualizado.access_token;
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

async function buscarOuCriarPasta(nome, parentId, accessToken) {
  const nomeSafe = nome.replace(/'/g, "\\'");
  const q = `name='${nomeSafe}' and '${parentId}' in parents `
    + `and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    console.log(`[GDrive] Pasta já existe: "${nome}"`);
    return searchData.files[0];
  }

  // Cria nova pasta
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name:     nome,
        mimeType: 'application/vnd.google-apps.folder',
        parents:  [parentId],
      }),
    }
  );
  const created = await createRes.json();
  console.log(`[GDrive] Pasta criada: "${nome}" → ${created.id}`);
  return created;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { nome, cpf } = req.body || {};
  if (!nome) return res.status(400).json({ ok: false, erro: 'Nome é obrigatório.' });

  try {
    const accessToken = await getAccessToken();

    // Pasta raiz: variável de ambiente ou "root" (Meu Drive)
    const raizId = process.env.GDRIVE_PASTA_CLIENTES || 'root';

    // Nome da pasta: "NOME COMPLETO — CPF" ou só "NOME COMPLETO"
    const nomeLimpo  = nome.trim().toUpperCase().replace(/[/\\?%*:|"<>]/g, '-');
    const nomePasta  = cpf ? `${nomeLimpo} — ${cpf}` : nomeLimpo;

    const pasta = await buscarOuCriarPasta(nomePasta, raizId, accessToken);

    if (!pasta || !pasta.id) throw new Error('Falha ao criar pasta — resposta inválida do Drive.');

    const folderUrl = pasta.webViewLink
      || `https://drive.google.com/drive/folders/${pasta.id}`;

    return res.status(200).json({ ok: true, folderId: pasta.id, folderUrl, folderName: nomePasta });
  } catch (e) {
    const naoConectado = /não conectado|Reconecte/i.test(e.message);
    console.error('[GDrive] Erro:', e.message);
    return res.status(naoConectado ? 401 : 500).json({
      ok: false, erro: e.message, naoConectado,
    });
  }
}
