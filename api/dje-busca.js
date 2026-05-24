// api/dje-busca.js
// Busca automática de intimações no DJE do TJSP e TRF3
// Cron: toda segunda a sexta às 08:00 BRT (11:00 UTC)

const OAB_NUM   = '331449';
const OAB_ESTADO = 'SP';
const EMAIL_TO  = 'lcfoadvogados@gmail.com';
const CRM_URL   = 'https://crm-lcfo.vercel.app';

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

// ─── TJSP ────────────────────────────────────────────────────────────────────

async function buscarTJSP(dataBr) {
  const url =
    `https://esaj.tjsp.jus.br/dje/listaDiarioIntimacao.do` +
    `?nAdvOAB=${OAB_NUM}&tipoCodigo=T` +
    `&dtInicio=${encodeURIComponent(dataBr)}&dtFim=${encodeURIComponent(dataBr)}` +
    `&cdCaderno=-1&nuPagina=1`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Referer': 'https://esaj.tjsp.jus.br/dje/consultaSimples.do',
      },
      signal: AbortSignal.timeout(20000),
    });

    const html = await res.text();
    return parseTJSP(html, dataBr);
  } catch (e) {
    console.error('[TJSP] erro:', e.message);
    return [];
  }
}

function parseTJSP(html, dataBr) {
  const results = [];
  // Extrai rows da tabela de resultados
  const rowRe = /<tr[^>]*class="[^"]*(?:fundoBranco|fundocinza|resultado)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m, idx = 0;
  while ((m = rowRe.exec(html)) !== null && idx < 100) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => stripHtml(c[1]));
    if (cells.length < 2) continue;

    // Extrai número do processo se disponível
    const procMatch = m[1].match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
    const processo = procMatch ? procMatch[1] : (cells[0] || '');

    results.push({
      id:        `tjsp-${brToISO(dataBr)}-${idx}`,
      tribunal:  'TJSP',
      data:      dataBr,
      processo,
      tipo:      cells[1] || 'Intimação',
      conteudo:  cells[2] || cells[1] || '',
      caderno:   cells[3] || '',
      pagina:    cells[4] || '',
      status:    'nova',
      criado:    new Date().toISOString(),
    });
    idx++;
  }
  return results;
}

// ─── TRF3 ─────────────────────────────────────────────────────────────────────

async function buscarTRF3(dataBr) {
  const dataISO = brToISO(dataBr);

  // TRF3 DJe — endpoint de consulta por advogado (OAB)
  const url =
    `https://pje.trf3.jus.br/pje/dje/listaDiarioIntimacoes.do` +
    `?nAdvOAB=${OAB_NUM}&cdEstadoOAB=${OAB_ESTADO}` +
    `&dtInicio=${encodeURIComponent(dataBr)}&dtFim=${encodeURIComponent(dataBr)}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      signal: AbortSignal.timeout(20000),
    });

    const html = await res.text();
    return parseTRF3(html, dataBr);
  } catch (e) {
    console.error('[TRF3] erro:', e.message);
    return [];
  }
}

function parseTRF3(html, dataBr) {
  const results = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m, idx = 0;
  while ((m = rowRe.exec(html)) !== null && idx < 100) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => stripHtml(c[1]));
    if (cells.length < 2 || cells.every(c => !c)) continue;

    const procMatch = m[1].match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
    const processo = procMatch ? procMatch[1] : (cells[0] || '');

    results.push({
      id:        `trf3-${brToISO(dataBr)}-${idx}`,
      tribunal:  'TRF3',
      data:      dataBr,
      processo,
      tipo:      cells[1] || 'Intimação',
      conteudo:  cells[2] || cells[1] || '',
      caderno:   cells[3] || '',
      pagina:    cells[4] || '',
      status:    'nova',
      criado:    new Date().toISOString(),
    });
    idx++;
  }
  return results;
}

// ─── E-mail ───────────────────────────────────────────────────────────────────

async function enviarEmail(intimacoes, dataBr) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('[email] RESEND_API_KEY não configurada — pulando.'); return; }

  const { Resend } = await import('resend');
  const resend = new Resend(key);

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
  await resend.emails.send({
    from:    'LCFO Sistema <onboarding@resend.dev>',
    to:      EMAIL_TO,
    subject: `⚖️ ${intimacoes.length} intimaç${plural ? 'ão' : 'ões'} — DJE ${dataBr}`,
    html: `
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
</div>`,
  });

  console.log(`[email] Enviado para ${EMAIL_TO} — ${intimacoes.length} intimações`);
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dataBr  = req.query.data  || getDataBr();
  const isCron  = req.query.cron  === '1';
  const semEmail = req.query.email === '0';

  console.log(`[DJE] Buscando ${dataBr} — cron=${isCron}`);

  try {
    const [tjsp, trf3] = await Promise.allSettled([
      buscarTJSP(dataBr),
      buscarTRF3(dataBr),
    ]);

    const todas = [
      ...(tjsp.status === 'fulfilled' ? tjsp.value : []),
      ...(trf3.status === 'fulfilled' ? trf3.value : []),
    ];

    console.log(`[DJE] TJSP=${tjsp.status === 'fulfilled' ? tjsp.value.length : 'erro'} TRF3=${trf3.status === 'fulfilled' ? trf3.value.length : 'erro'} total=${todas.length}`);

    // Envia e-mail se encontrou algo (e não foi explicitamente desabilitado)
    if (todas.length > 0 && !semEmail) {
      await enviarEmail(todas, dataBr);
    }

    return res.status(200).json({
      ok:            true,
      data:          dataBr,
      total:         todas.length,
      intimacoes:    todas,
      emailEnviado:  todas.length > 0 && !semEmail && !!process.env.RESEND_API_KEY,
      erros: {
        tjsp: tjsp.status === 'rejected' ? tjsp.reason?.message : null,
        trf3: trf3.status === 'rejected' ? trf3.reason?.message : null,
      },
    });
  } catch (e) {
    console.error('[DJE] erro geral:', e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
