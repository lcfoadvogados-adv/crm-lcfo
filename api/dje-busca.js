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

// ─── helpers de data ──────────────────────────────────────────────────────────

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

// ─── calendário forense: dias úteis, feriados e recesso (CPC art. 219/220) ───
// Cobre feriados nacionais + os de uso forense consolidado (Carnaval,
// Sexta-feira Santa, Corpus Christi) e o recesso de 20/dez a 20/jan.
// Não modela feriados municipais/estaduais específicos de cada comarca —
// por isso a data final é sempre uma SUGESTÃO a confirmar pelo advogado.

function pascoa(ano) {
  // Algoritmo de Gauss/Anonymous Gregorian — retorna Date da Páscoa (domingo)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function addDias(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function feriadosDoAno(ano) {
  const pasc = pascoa(ano);
  const fixos = [
    [0, 1], [3, 21], [4, 1], [8, 7], [9, 12], [10, 2], [10, 15], [10, 20], [11, 25],
  ].map(([mes, dia]) => new Date(ano, mes, dia));
  const moveis = [
    addDias(pasc, -48), // segunda de Carnaval
    addDias(pasc, -47), // terça de Carnaval
    addDias(pasc, -2),  // sexta-feira Santa
    addDias(pasc, 60),  // Corpus Christi
  ];
  return [...fixos, ...moveis].map(d => d.toISOString().split('T')[0]);
}

const FERIADOS_CACHE = {};
function isFeriado(dataISO) {
  const ano = Number(dataISO.split('-')[0]);
  if (!FERIADOS_CACHE[ano]) FERIADOS_CACHE[ano] = new Set(feriadosDoAno(ano));
  return FERIADOS_CACHE[ano].has(dataISO);
}

function isRecessoForense(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  // 20/dez a 31/dez do próprio ano, ou 1/jan a 20/jan do ano seguinte
  return (mes === 12 && dia >= 20) || (mes === 1 && dia <= 20);
}

function isDiaUtil(dataISO) {
  const d = new Date(dataISO + 'T12:00:00');
  const dow = d.getDay(); // 0=dom, 6=sáb
  if (dow === 0 || dow === 6) return false;
  if (isRecessoForense(dataISO)) return false;
  if (isFeriado(dataISO)) return false;
  return true;
}

function proximoDiaUtilEstrito(dataISO) {
  let d = addDias(new Date(dataISO + 'T12:00:00'), 1);
  let iso = d.toISOString().split('T')[0];
  while (!isDiaUtil(iso)) {
    d = addDias(d, 1);
    iso = d.toISOString().split('T')[0];
  }
  return iso;
}

// dataInicio já deve ser dia útil; conta-a como dia 1 e soma (n-1) dias úteis
function nEsimoDiaUtil(dataInicioISO, n) {
  let count = 1;
  let iso = dataInicioISO;
  while (count < n) {
    iso = addDias(new Date(iso + 'T12:00:00'), 1).toISOString().split('T')[0];
    if (isDiaUtil(iso)) count++;
  }
  return iso;
}

// dataDisponibilizacaoISO → { dataPublicacao, dataInicioContagem, dataFinal }
// Regras: Lei 11.419/2006 art.4º §3º (publicação = 1º dia útil seguinte à
// disponibilização) + CPC art.231/224 (prazo inicia no 1º dia útil seguinte
// à publicação, contado o próprio dia de início como dia 1).
function calcularPrazo(dataDisponibilizacaoISO, dias, diasContados) {
  const dataPublicacao     = proximoDiaUtilEstrito(dataDisponibilizacaoISO);
  const dataInicioContagem = proximoDiaUtilEstrito(dataPublicacao);
  const dataFinal = diasContados === 'corridos'
    ? addDias(new Date(dataInicioContagem + 'T12:00:00'), dias - 1).toISOString().split('T')[0]
    : nEsimoDiaUtil(dataInicioContagem, dias);
  return { dataPublicacao, dataInicioContagem, dataFinal };
}

// ─── IA: classifica tipo de prazo a partir do teor da intimação ──────────────
// Só roda quando há texto real (não sigiloso). Resultado é sempre "sugestão".

const SUGESTAO_PADRAO = {
  tipo:        'Verificar nos autos',
  dias:        15,
  diasContados: 'uteis',
  baseLegal:   'Padrão — processo sigiloso ou sem teor disponível, confirme nos autos',
  confianca:   'baixa',
};

async function sugerirPrazoIA(texto, nomeClasse, tipoComunicacao) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return SUGESTAO_PADRAO;

  try {
    const prompt = `Você é um assistente jurídico especializado em processo civil brasileiro (CPC/2015). Leia o teor de uma intimação/publicação do DJE e classifique o prazo processual aplicável.

Classe processual: ${nomeClasse || 'não informada'}
Tipo de comunicação: ${tipoComunicacao || 'não informado'}
Teor da publicação:
"""
${texto.substring(0, 3000)}
"""

Responda APENAS com um JSON (sem texto antes ou depois) no formato:
{"tipo":"nome do ato/prazo (ex: Contestação, Embargos de Declaração, Apelação, Manifestação sobre laudo pericial, Cumprimento de sentença, Réplica, Recurso, Ciência/sem prazo)","dias":numero_de_dias,"diasContados":"uteis ou corridos","baseLegal":"artigo de lei resumido (ex: CPC art. 335)","confianca":"alta, media ou baixa","observacao":"alerta curto se houver dúvida relevante (ex: pode ser Juizado Especial com contagem em dias corridos), ou string vazia"}

Se for apenas uma decisão/despacho de mero expediente sem prazo de resposta da parte (ex: "ciência", "designada audiência", "tome conhecimento"), use tipo "Ciência/sem prazo" e dias=0.
Use a regra geral do CPC (dias úteis) salvo se identificar claramente contexto de Juizado Especial.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-opus-4-5-20251101',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.warn('[IA-prazo] Erro Claude:', res.status);
      return SUGESTAO_PADRAO;
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return SUGESTAO_PADRAO;

    const parsed = JSON.parse(match[0]);
    return {
      tipo:         parsed.tipo || SUGESTAO_PADRAO.tipo,
      dias:         Number(parsed.dias) >= 0 ? Number(parsed.dias) : SUGESTAO_PADRAO.dias,
      diasContados: parsed.diasContados === 'corridos' ? 'corridos' : 'uteis',
      baseLegal:    parsed.baseLegal || '',
      confianca:    parsed.confianca || 'media',
      observacao:   parsed.observacao || '',
    };
  } catch (e) {
    console.warn('[IA-prazo] erro:', e.message);
    return SUGESTAO_PADRAO;
  }
}

function ehSigiloso(texto) {
  return /processo sigiloso/i.test(texto || '');
}

async function montarSugestaoPrazo(item, dataDisponibilizacaoISO) {
  let base;
  if (!item.conteudo || ehSigiloso(item.conteudo)) {
    base = SUGESTAO_PADRAO;
  } else {
    base = await sugerirPrazoIA(item.conteudo, item.nomeClasse, item.tipo);
  }

  if (base.dias === 0) {
    return { ...base, dataPublicacao: null, dataInicioContagem: null, dataFinal: null };
  }

  const { dataPublicacao, dataInicioContagem, dataFinal } =
    calcularPrazo(dataDisponibilizacaoISO, base.dias, base.diasContados);

  return { ...base, dataPublicacao, dataInicioContagem, dataFinal };
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

  const itens = data.items.map(item => ({
    id:         `djen-${item.id}`,
    tribunal:   item.siglaTribunal || '',
    data:       item.datadisponibilizacao || dataBr,
    dataISO:    item.data_disponibilizacao || dataISO,
    processo:   item.numeroprocessocommascara || item.numero_processo || '',
    tipo:       item.tipoComunicacao || 'Intimação',
    nomeClasse: item.nomeClasse || '',
    conteudo:   stripHtml(item.texto || ''),
    caderno:    item.nomeOrgao || '',
    pagina:     '',
    status:     'nova',
    criado:     new Date().toISOString(),
  }));

  // Calcula a sugestão de prazo para cada intimação (em paralelo)
  await Promise.all(itens.map(async item => {
    item.sugestaoPrazo = await montarSugestaoPrazo(item, item.dataISO);
  }));

  return itens;
}

// ─── E-mail (Resend REST API direto — compatível com Edge Runtime) ───────────

async function enviarEmail(intimacoes, dataBr) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('[email] RESEND_API_KEY não configurada — pulando.'); return; }

  const itensHtml = intimacoes.map(i => {
    const sp = i.sugestaoPrazo;
    const sugestaoHtml = sp && sp.dataFinal
      ? `<div style="margin-top:8px;background:#f3e9ff;border-radius:6px;padding:8px 10px;font-size:12px;color:#5b2a86">
           🤖 <strong>Sugestão de prazo:</strong> ${sp.tipo} — ${sp.dias} dia(s) ${sp.diasContados === 'corridos' ? 'corridos' : 'úteis'}
           — vence em ${new Date(sp.dataFinal + 'T12:00').toLocaleDateString('pt-BR')}
           ${sp.confianca === 'baixa' ? ' <em>(confirme nos autos)</em>' : ''}
         </div>`
      : '';
    return `
    <div style="border:1px solid #dde3ef;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="background:#1D3461;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${i.tribunal}</span>
        <span style="color:#8695a7;font-size:12px">${i.data}</span>
        ${i.processo ? `<span style="font-size:12px;color:#4a5568">📁 ${i.processo}</span>` : ''}
      </div>
      <div style="font-size:13px;color:#1e2d3d;font-weight:600">${i.tipo}</div>
      ${i.conteudo ? `<div style="font-size:12px;color:#555;margin-top:6px;border-left:3px solid #C9A84C;padding-left:10px">${i.conteudo.substring(0, 400)}${i.conteudo.length > 400 ? '…' : ''}</div>` : ''}
      ${sugestaoHtml}
    </div>`;
  }).join('');

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
      <a href="${CRM_URL}" style="background:#1D3461;color:#fff;padding:12px 28px;border-radius:7px;text-decoration:none;font-weight:700;font-size:14px">Abrir CRM e confirmar prazos →</a>
    </div>
  </div>
  <p style="text-align:center;color:#aaa;font-size:11px;margin-top:12px">Enviado automaticamente pelo sistema CRM LCFO — sugestões de prazo geradas por IA precisam de confirmação</p>
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
