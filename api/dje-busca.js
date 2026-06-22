// api/dje-busca.js
// Busca automática de intimações via DJEN — Diário de Justiça Eletrônico Nacional (CNJ)
// API pública oficial: https://comunicaapi.pje.jus.br
// Cron: toda segunda a sexta às 08:00 BRT (11:00 UTC)
//
// Roda em Edge Runtime: a API do DJEN bloqueia IPs de datacenter/AWS Lambda
// (usado pelas funções serverless Node padrão da Vercel) com HTTP 403.
// O Edge Runtime da Vercel usa uma rede diferente que não é bloqueada.
export const config = { runtime: 'edge' };

const OAB_NUM    = '331449';
const OAB_ESTADO = 'SP';
const EMAIL_TO   = 'lcfoadvogados@gmail.com';
const CRM_URL    = 'https://crm-lcfo.vercel.app';

// ─── helpers ────────────────────────────────────────────────────────────────

function getDataBr(date) {
  const d = date || new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function brToISO(dataBr) {
  const [dd, mm, yyyy] = dataBr.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── DJEN — Diário de Justiça Eletrônico Nacional (CNJ) ──────────────────────
// Fonte oficial nacional: cobre TJSP, TRF3 e qualquer outro tribunal que
// publique intimação para esta OAB, num único endpoint estruturado (JSON).

async function buscarDJEN(dataBr) {
  const dataISO = brToISO(dataBr);
  const url =
    `https://comunicaapi.pje.jus.br/api/v1/comunicacao` +
    `?numeroOab=${OAB_NUM}&ufOab=${OAB_ESTADO}` +
    `&dataDisponibilizacaoInicio=${dataISO}&dataDisponibilizacaoFim=${dataISO}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Origin':          'https://comunica.pje.jus.br',
      'Referer':         'https://comunica.pje.jus.br/',
    },
  });

  if (!res.ok) {
    console.warn(`[DJEN] HTTP ${res.status}`);
    return [];
  }

  const data = await res.json();
  if (data.status !== 'success' || !Array.isArray(data.items)) return [];

  return data.items.map(item => ({
    id:       `djen-${item.id}`,
    tribunal: item.siglaTribunal || '',
    data:     item.datadisponibilizacao || dataBr,
    processo: item.numeroprocessocommascara || item.numero_processo || '',
    tipo:     item.tipoComunicacao || 'Intimação',
    conteudo: stripHtml(item.texto || ''),
    caderno:  item.nomeOrgao || '',
    pagina:   '',
    status:   'nova',
    criado:   new Date().toISOString(),
  }));
}

// ─── E-mail (Resend REST API direto — compatível com Edge Runtime) ───────────

async function enviarEmail(intimacoes, dataBr) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('[email] RESEND_API_KEY não configurada — pulando.'); return; }

  const itensHtml = intimacoes.map(i => `
    <div style="border:1px solid #dde3ef;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="background:#1D3461;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${i.tribunal}</span>
        <span style="color:#8695a7;font-size:12px">${i.data}</span>
        ${i.processo ? `<span style="font-size:12px;color:#4a5568">📁 ${i.processo}</span>` : ''}
      </div>
      <div style="font-size:13px;color:#1e2d3d;font-weight:600">${i.tipo}</div>
      ${i.conteudo ? `<div style="font-size:12px;color:#555;margin-top:6px;border-left:3px solid #C9A84C;padding-left:10px">${i.conteudo.substring(0, 400)}${i.conteudo.length > 400 ? '…' : ''}</div>` : ''}
    </div>`).join('');

  const plural = intimacoes.length === 1;
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#f2f4f8;padding:24px">
  <div style="background:#1D3461;color:#fff;border-radius:10px 10px 0 0;padding:24px 28px">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.6;margin-bottom:4px">LCFO Advogados — Sistema Jurídico</div>
    <h1 style="margin:0;font-size:20px">⚖️ DJE — ${dataBr}</h1>
    <p style="margin:6px 0 0;opacity:.8;font-size:14px">
      ${intimacoes.length} intimaç${plural ? 'ão encontrada' : 'ões encontradas'} — OAB/SP ${OAB_NUM}
    </p>
  </div>
  <div style="background:#f9fafc;padding:24px;border:1px solid #dde3ef;border-top:none;border-radius:0 0 10px 10px">
    ${itensHtml}
    <div style="text-align:center;margin-top:24px">
      <a href="${CRM_URL}" style="background:#1D3461;color:#fff;padding:12px 28px;border-radius:7px;text-decoration:none;font-weight:700;font-size:14px">Abrir CRM e criar prazos →</a>
    </div>
  </div>
  <p style="text-align:center;color:#aaa;font-size:11px;margin-top:12px">Enviado automaticamente pelo sistema CRM LCFO</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'LCFO Sistema <onboarding@resend.dev>',
      to:      EMAIL_TO,
      subject: `⚖️ ${intimacoes.length} intimaç${plural ? 'ão' : 'ões'} — DJE ${dataBr}`,
      html,
    }),
  });

  if (!res.ok) {
    console.error('[email] Erro Resend:', await res.text());
    return;
  }
  console.log(`[email] Enviado para ${EMAIL_TO} — ${intimacoes.length} intimações`);
}

// ─── Handler principal (Edge Runtime — usa Request/Response padrão Web) ─────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const dataBr   = searchParams.get('data')  || getDataBr();
  const isCron   = searchParams.get('cron')  === '1';
  const semEmail = searchParams.get('email') === '0';

  console.log(`[DJE] Buscando ${dataBr} — cron=${isCron}`);

  try {
    const [djen] = await Promise.allSettled([buscarDJEN(dataBr)]);
    const todas  = djen.status === 'fulfilled' ? djen.value : [];

    console.log(`[DJE] DJEN=${djen.status === 'fulfilled' ? todas.length : 'erro'} total=${todas.length}`);

    if (todas.length > 0 && !semEmail) {
      await enviarEmail(todas, dataBr);
    }

    return new Response(JSON.stringify({
      ok:           true,
      data:         dataBr,
      total:        todas.length,
      intimacoes:   todas,
      emailEnviado: todas.length > 0 && !semEmail && !!process.env.RESEND_API_KEY,
      erros: {
        djen: djen.status === 'rejected' ? djen.reason?.message : null,
      },
    }), { status: 200, headers: CORS_HEADERS });
  } catch (e) {
    console.error('[DJE] erro geral:', e);
    return new Response(JSON.stringify({ ok: false, erro: e.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}
