// api/meta-lead.js
// Recebe leads do Meta Lead Ads (formulário de campanha)
// GET  → verificação do webhook pelo Meta
// POST → novo lead chegou

const EMAIL_TO  = 'lcfoadvogados@gmail.com';
const CRM_URL   = 'https://crm-lcfo.vercel.app';

// ─── Verificação do webhook (Meta exige isso na configuração) ─────────────────

function handleVerify(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const myToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'lcfo2025';

  if (mode === 'subscribe' && token === myToken) {
    console.log('[Meta] Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Token inválido' });
}

// ─── Extrai campos do formulário Meta ────────────────────────────────────────

function extrairCampos(fieldData = []) {
  const map = {};
  for (const f of fieldData) {
    const key = (f.name || '').toLowerCase().replace(/\s+/g, '_');
    map[key] = (f.values || [])[0] || '';
  }

  // Normaliza variações de nome de campo que o Meta pode usar
  return {
    nome:     map.full_name  || map.nome       || map.name        || '',
    telefone: map.phone_number || map.telefone || map.celular      || map.whatsapp || '',
    email:    map.email      || map.e_mail     || map.email_address || '',
    cpf:      map.cpf        || '',
    cidade:   map.city       || map.cidade     || '',
    estado:   map.state      || map.estado     || '',
    obs:      map.message    || map.mensagem   || map.observacao   || '',
  };
}

// ─── Monta link "importar com 1 clique" ──────────────────────────────────────

function montarLinkImport(lead) {
  const payload = Buffer.from(JSON.stringify(lead)).toString('base64');
  return `${CRM_URL}?lead=${encodeURIComponent(payload)}`;
}

// ─── E-mail de notificação ────────────────────────────────────────────────────

async function enviarNotificacao(lead, linkImport, meta) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('[Meta] RESEND_API_KEY ausente — pulando e-mail.'); return; }

  const { Resend } = await import('resend');
  const resend = new Resend(key);

  const linhas = [
    lead.nome     && `<tr><td style="padding:4px 0;color:#8695a7;font-size:12px">Nome</td><td style="padding:4px 0;font-size:13px;font-weight:600">${lead.nome}</td></tr>`,
    lead.telefone && `<tr><td style="padding:4px 0;color:#8695a7;font-size:12px">WhatsApp</td><td style="padding:4px 0;font-size:13px">${lead.telefone}</td></tr>`,
    lead.email    && `<tr><td style="padding:4px 0;color:#8695a7;font-size:12px">E-mail</td><td style="padding:4px 0;font-size:13px">${lead.email}</td></tr>`,
    lead.cidade   && `<tr><td style="padding:4px 0;color:#8695a7;font-size:12px">Cidade</td><td style="padding:4px 0;font-size:13px">${lead.cidade}${lead.estado?' — '+lead.estado:''}</td></tr>`,
    lead.obs      && `<tr><td style="padding:4px 0;color:#8695a7;font-size:12px">Mensagem</td><td style="padding:4px 0;font-size:13px">${lead.obs}</td></tr>`,
    meta.form_id  && `<tr><td style="padding:4px 0;color:#8695a7;font-size:12px">Formulário</td><td style="padding:4px 0;font-size:11px;color:#aaa">${meta.form_id}</td></tr>`,
  ].filter(Boolean).join('');

  await resend.emails.send({
    from:    'LCFO Sistema <onboarding@resend.dev>',
    to:      EMAIL_TO,
    subject: `🔥 Novo lead Meta Ads${lead.nome ? ' — ' + lead.nome : ''}`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f2f4f8;padding:24px">
  <div style="background:#1D3461;color:#fff;border-radius:10px 10px 0 0;padding:22px 28px">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:.5;margin-bottom:4px">LCFO Advogados — Meta Lead Ads</div>
    <h1 style="margin:0;font-size:20px">🔥 Novo lead chegou!</h1>
    <p style="margin:6px 0 0;opacity:.75;font-size:13px">Via formulário de campanha do Meta</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #dde3ef;border-top:none">
    <table style="width:100%;border-collapse:collapse">${linhas}</table>
    <div style="margin-top:24px;text-align:center">
      <a href="${linkImport}"
         style="display:inline-block;background:#C9A84C;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
        ✅ Importar lead no CRM
      </a>
      <p style="margin-top:10px;font-size:11px;color:#aaa">Clique para abrir o CRM e cadastrar automaticamente</p>
    </div>
  </div>
  <p style="text-align:center;color:#bbb;font-size:11px;margin-top:12px">Enviado automaticamente pelo sistema CRM LCFO</p>
</div>`,
  });

  console.log(`[Meta] E-mail enviado para ${EMAIL_TO} — lead: ${lead.nome || lead.telefone}`);
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Verificação inicial do webhook
  if (req.method === 'GET') return handleVerify(req, res);
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body || {};
    const entries = body.entry || [];

    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const val = change.value || {};
        if (change.field !== 'leadgen') continue;

        const campos = extrairCampos(val.field_data || []);
        const lead = {
          nome:     campos.nome,
          telefone: campos.telefone,
          email:    campos.email,
          cpf:      campos.cpf,
          endereco: [campos.cidade, campos.estado].filter(Boolean).join(' — '),
          obs:      campos.obs || `Lead via Meta Ads — formulário ${val.form_id || ''}`.trim(),
          etapa:    'Leads de Entrada',
          origem:   'Meta Ads',
          criado:   new Date().toLocaleDateString('pt-BR'),
        };

        const linkImport = montarLinkImport(lead);
        console.log(`[Meta] Novo lead: ${lead.nome} ${lead.telefone}`);

        await enviarNotificacao(lead, linkImport, val);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[Meta] Erro:', e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
