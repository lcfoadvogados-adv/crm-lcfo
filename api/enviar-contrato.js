// api/enviar-contrato.js — Envia Contrato e Procuração em .docx como anexos por e-mail

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ ok: false, erro: 'RESEND_API_KEY não configurada.' });

  const { emailCliente, nomeCliente, base64Contrato, base64Procuracao } = req.body || {};
  if (!emailCliente || !base64Contrato) {
    return res.status(400).json({ ok: false, erro: 'E-mail e contrato são obrigatórios.' });
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);

    const attachments = [
      {
        filename: `CONTRATO - ${nomeCliente || 'cliente'}.docx`,
        content: base64Contrato,
      },
    ];
    if (base64Procuracao) {
      attachments.push({
        filename: `PROCURAÇÃO - ${nomeCliente || 'cliente'}.docx`,
        content: base64Procuracao,
      });
    }

    await resend.emails.send({
      from:        'LCFO Advogados <onboarding@resend.dev>',
      to:          emailCliente,
      cc:          'lcfoadvogados@gmail.com',
      subject:     `Contrato e Procuração — LCFO Advogados`,
      attachments,
      html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;background:#f2f4f8;padding:24px">
  <div style="background:#1D3461;color:#fff;border-radius:10px 10px 0 0;padding:22px 28px">
    <h1 style="margin:0;font-size:20px">⚖️ Documentos para Assinatura</h1>
    <p style="margin:6px 0 0;opacity:.75;font-size:13px">Prezado(a) ${nomeCliente || 'cliente'}, seguem os documentos em anexo para revisão e assinatura.</p>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #dde3ef;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:13px;color:#1e2d3d;margin-bottom:20px">
      Encaminhamos em anexo o <strong>Contrato de Prestação de Serviços Advocatícios</strong> e a <strong>Procuração</strong>.
      Pedimos que leia com atenção, imprima, assine e nos devolva por e-mail ou WhatsApp.
    </p>
    <div style="background:#f0f4ff;border-radius:8px;padding:16px;font-size:13px;color:#1e2d3d">
      <strong>📌 Como assinar:</strong><br>
      Imprima os documentos, assine e tire uma foto nítida (ou assine digitalmente),
      e envie para <a href="mailto:lcfoadvogados@gmail.com">lcfoadvogados@gmail.com</a>
      ou pelo WhatsApp <strong>(19) 98910-1414</strong>.
    </div>
  </div>
  <p style="text-align:center;color:#aaa;font-size:11px;margin-top:12px">
    LCFO Advogados — Dr. Leonardo César Figueiredo de Oliveira — OAB/SP 331.449<br>
    Rua Hipólito da Silva, 59, Vila Marieta, Campinas/SP
  </p>
</div>`,
    });

    console.log(`[Contrato] Enviado (.docx) para ${emailCliente} — ${nomeCliente}`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[Contrato] Erro:', e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
