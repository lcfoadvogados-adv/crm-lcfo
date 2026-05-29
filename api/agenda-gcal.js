// api/agenda-gcal.js
// Busca eventos do dia corrente no Google Calendar via URL ICS privada
// Env var: GOOGLE_CALENDAR_ICS_URL  (aceita múltiplas URLs separadas por vírgula)

function unfold(ics) {
  // ICS dobra linhas longas com CRLF + espaço/tab — desfaz
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseEventosHoje(icsText) {
  const text = unfold(icsText);

  // Data de hoje em BRT (UTC−3)
  const brtMs   = Date.now() - 3 * 3600000;
  const brtDate = new Date(brtMs);
  const hojeStr = `${brtDate.getUTCFullYear()}${String(brtDate.getUTCMonth()+1).padStart(2,'0')}${String(brtDate.getUTCDate()).padStart(2,'0')}`;

  const eventos = [];
  const parts   = text.split('BEGIN:VEVENT');

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    // SUMMARY
    const sm = block.match(/^SUMMARY:(.+)$/m);
    const titulo = sm
      ? sm[1].trim().replace(/\\n/g,' ').replace(/\\,/g,',').replace(/\\;/g,';')
      : 'Compromisso';

    // DTSTART (pode ter params: ;TZID=... ou ;VALUE=DATE)
    const dm = block.match(/^(DTSTART[^:]*):(.+)$/m);
    if (!dm) continue;

    const dtParam = dm[1];          // "DTSTART" | "DTSTART;TZID=..." | "DTSTART;VALUE=DATE"
    const dtVal   = dm[2].trim();   // "20260529T180000Z" | "20260529T150000" | "20260529"

    const isUTC  = dtVal.endsWith('Z');
    const hasT   = dtVal.includes('T');
    const clean  = dtVal.replace('Z','');
    const dPart  = clean.substring(0, 8);            // YYYYMMDD
    const tPart  = hasT ? clean.split('T')[1] : null; // HHmmss

    let eventDate = dPart;
    let hora      = '';

    if (hasT && tPart) {
      if (isUTC) {
        // Converter UTC → BRT
        const y  = parseInt(dPart.substring(0,4));
        const mo = parseInt(dPart.substring(4,6)) - 1;
        const d  = parseInt(dPart.substring(6,8));
        const h  = parseInt(tPart.substring(0,2));
        const m  = parseInt(tPart.substring(2,4));
        const s  = parseInt(tPart.substring(4,6)||'0');
        const brt = new Date(Date.UTC(y,mo,d,h,m,s) - 3*3600000);
        eventDate = `${brt.getUTCFullYear()}${String(brt.getUTCMonth()+1).padStart(2,'0')}${String(brt.getUTCDate()).padStart(2,'0')}`;
        hora = `${String(brt.getUTCHours()).padStart(2,'0')}:${String(brt.getUTCMinutes()).padStart(2,'0')}`;
      } else {
        // TZID ou sem timezone — assume horário local (BRT)
        hora = `${tPart.substring(0,2)}:${tPart.substring(2,4)}`;
      }
    }

    if (eventDate !== hojeStr) continue;

    // Evitar duplicatas por título + hora
    if (!eventos.find(e => e.titulo===titulo && e.hora===hora)) {
      eventos.push({ titulo, hora });
    }
  }

  return eventos.sort((a,b)=>{
    if(!a.hora&&!b.hora) return 0;
    if(!a.hora) return 1;
    if(!b.hora) return -1;
    return a.hora.localeCompare(b.hora);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const urlsRaw = process.env.GOOGLE_CALENDAR_ICS_URL || '';
  if (!urlsRaw) return res.status(200).json({ ok: true, eventos: [] });

  const urls = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);
  const todos = [];

  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'LCFO-CRM/1.0' } });
      if (!r.ok) { console.warn('[GCal] Erro ao buscar ICS:', r.status, url); continue; }
      const text = await r.text();
      todos.push(...parseEventosHoje(text));
    } catch(e) {
      console.warn('[GCal] Erro:', e.message);
    }
  }

  // Re-ordenar (múltiplos calendários podem misturar ordem)
  todos.sort((a,b)=>{
    if(!a.hora&&!b.hora) return 0;
    if(!a.hora) return 1;
    if(!b.hora) return -1;
    return a.hora.localeCompare(b.hora);
  });

  return res.status(200).json({ ok: true, eventos: todos });
}
