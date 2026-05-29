// api/meta-lead.js
// Webhook Meta Lead Ads
// GET  → verificação do endpoint pelo Meta (hub.challenge)
// POST → novo lead gerado; busca dados no Graph API e salva na fila KV

const KV_KEY   = 'leads_pendentes';
const CRM_URL  = 'https://crm-lcfo.vercel.app';
const EMAIL_TO = 'lcfoadvogados@gmail.com';

// ─── KV (Upstash pipeline) ────────────────────────────────────────────────────

function kvCreds() {
  return {
    url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function kvPush(lead) {
  const { url, token } = kvCreds();
  if (!url || !token) { console.warn('[KV] Credenciais ausentes'); return false; }
  const res = await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([['LPUSH', KV_KEY, JSON.stringify(lead)]]),
  });
  console.log('[KV] LPUSH status:', res.status);
  return res.ok;
}

// ─── Graph API — busca dados do lead pelo leadgen_id ─────────────────────────

async function fetchLeadData(leadgenId) {
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageToken) {
    console.warn('[Meta] META_PAGE_ACCESS_TOKEN não configurado — impossível buscar dados do lead.');
    return null;
  }
  const url = `https://graph.facebook.com/v21.0/${leadgenId}?fields=field_data,created_time,ad_id,form_id&access_token=${pageToken}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[Meta] Erro ao buscar leadgen ${leadgenId}: ${res.status}`);
    return null;
  }
  return res.json();
}

// ─── Mapeamento de campos ────────────────────────────────────────────────────

function extrairCampos(fieldData = []) {
  const map = {};
  for (const f of fieldData) {
    const key = (f.name || '').toLowerCase().replace(/[\s\-]/g, '_');
    map[key] = (f.values || [])[0] || '';
  }
  return {
    nome:     map.full_name || map.nome || map.name || [map.first_name, map.last_name].filter(Boolean).join(' ') || '',
    telefone: map.phone_number || map.telefone || map.celular || map.whatsapp || '',
    email:    map.email || map.e_mail || map.email_address || '',
    cpf:      map.cpf || '',
    cidade:   map.city || map.cidade || '',
    estado:   map.state || map.estado || '',
    obs:      map.message || map.mensagem || map.observacao || '',
  };
}

// ─── E-mail de aviso (via Resend — opcional) ──────────────────────────────────

async function enviarAviso(lead) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    await resend.emails.send({
      from:    'LCFO Sistema <onboarding@resend.dev>',
      to:      EMAIL_TO,
      subject: `Novo lead Meta Ads${lead.nome ? ' - ' + lead.nome : ''}`,
      html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#f2f4f8;padding:24px">
  <div style="background:#1D3461;color:#fff;border-radius:10px 10px 0 0;padding:20px 26px">
    <h2 style="margin:0;font-size:18px">Novo lead no CRM!</h2>
    <p style="margin:5px 0 0;opacity:.7;font-size:13px">Importado automaticamente via Meta Ads</p>
  </div>
  <div style="background:#fff;padding:20px 26px;border:1px solid #dde3ef;border-top:none;border-radius:0 0 10px 10px">
    ${lead.nome  ? `<p style="margin:6px 0"><strong>Nome:</strong> ${lead.nome}</p>` : ''}
    ${lead.tel   ? `<p style="margin:6px 0"><strong>WhatsApp:</strong> ${lead.tel}</p>` : ''}
    ${lead.email ? `<p style="margin:6px 0"><strong>E-mail:</strong> ${lead.email}</p>` : ''}
    ${lead.end   ? `<p style="margin:6px 0"><strong>Cidade:</strong> ${lead.end}</p>` : ''}
    <div style="margin-top:18px;text-align:center">
      <a href="${CRM_URL}" style="background:#1D3461;color:#fff;padding:11px 26px;border-radius:7px;text-decoration:none;font-weight:700;font-size:13px">Abrir CRM &rarr;</a>
    </div>
  </div>
</div>`,
    });
    console.log('[Meta] E-mail de aviso enviado para', EMAIL_TO);
  } catch(e) {
    console.warn('[Meta] Erro ao enviar e-mail:', e.message);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── GET: verificação do webhook ──
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const myToken   = process.env.META_WEBHOOK_VERIFY_TOKEN || 'lcfo2025';

    if (mode === 'subscribe' && token === myToken) {
      console.log('[Meta] Webhook verificado com sucesso.');
      return res.status(200).send(challenge);
    }
    console.warn('[Meta] Verificação falhou. Token recebido:', token);
    return res.status(403).json({ error: 'Token inválido' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // ── POST: novo lead ──
  try {
    const entries = (req.body || {}).entry || [];
    let importados = 0;

    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;

        const val       = change.value || {};
        const leadgenId = val.leadgen_id;
        if (!leadgenId) { console.warn('[Meta] leadgen_id ausente'); continue; }

        console.log(`[Meta] Novo lead recebido: leadgen_id=${leadgenId}`);

        // Busca dados reais no Graph API
        const data   = await fetchLeadData(leadgenId);
        const campos = extrairCampos(data?.field_data || []);

        const lead = {
          id:       Date.now() + importados,
          meta_leadgen_id: leadgenId,
          nome:     campos.nome,
          tel:      campos.telefone,
          tel2:     '',
          email:    campos.email,
          cpf:      '',
          rg:       '',
          nasc:     '',
          gen:      '',
          civil:    '',
          prof:     '',
          end:      [campos.cidade, campos.estado].filter(Boolean).join(' — '),
          obs:      campos.obs || `Lead via formulário Meta Ads (form ${val.form_id || ''})`.trim(),
          etapa:    'Leads de Entrada',
          origem:   'Meta Ads',
          criado:   new Date().toLocaleDateString('pt-BR'),
          followup: '',
          divida:   'Não informado',
          banco:    '',
          valor:    '',
          tags:     [],
        };

        await kvPush(lead);
        await enviarAviso(lead);
        importados++;
        console.log(`[Meta] Lead salvo na fila: ${lead.nome || lead.telefone || leadgenId}`);
      }
    }

    return res.status(200).json({ ok: true, importados });
  } catch(e) {
    console.error('[Meta] Erro:', e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
