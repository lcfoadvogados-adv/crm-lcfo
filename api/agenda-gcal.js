// api/agenda-gcal.js
// Busca eventos do dia corrente E do dia seguinte no Google Calendar via URL ICS privada
// Env var: GOOGLE_CALENDAR_ICS_URL  (aceita múltiplas URLs separadas por vírgula)

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function brtDateStr(offsetDays = 0) {
  const ms = Date.now() - 3 * 3600000 + offsetDays * 86400000;
  const d  = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function parseEventosDia(icsText, targetDateStr) {
  const text   = unfold(icsText);
  const eventos = [];
  const parts  = text.split('BEGIN:VEVENT');

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const sm = block.match(/^SUMMARY:(.+)$/m);
    const titulo = sm
      ? sm[1].trim().replace(/\\n/g,' ').replace(/\\,/g,',').replace(/\\;/g,';')
      : 'Compromisso';

    const dm = block.match(/^(DTSTART[^:]*):(.+)$/m);
    if (!dm) continue;

    const dtVal  = dm[2].trim();
    const isUTC  = dtVal.endsWith('Z');
    const hasT   = dtVal.includes('T');
    const clean  = dtVal.replace('Z','');
    const dPart  = clean.substring(0, 8);
    const tPart  = hasT ? clean.split('T')[1] : null;

    let eventDate = dPart;
    let hora      = '';

    if (hasT && tPart) {
      if (isUTC) {
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
        hora = `${tPart.substring(0,2)}:${tPart.substring(2,4)}`;
      }
    }

    if (eventDate !== targetDateStr) continue;

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

function merge(arr) {
  return arr.sort((a,b)=>{
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
  if (!urlsRaw) return res.status(200).json({ ok: true, hoje: [], amanha: [] });

  const urls   = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);
  const hojeStr   = brtDateStr(0);
  const amanhaStr = brtDateStr(1);
  const hoje   = [];
  const amanha = [];

  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'LCFO-CRM/1.0' } });
      if (!r.ok) { console.warn('[GCal] Erro ao buscar ICS:', r.status); continue; }
      const text = await r.text();
      hoje.push(...parseEventosDia(text, hojeStr));
      amanha.push(...parseEventosDia(text, amanhaStr));
    } catch(e) {
      console.warn('[GCal] Erro:', e.message);
    }
  }

  return res.status(200).json({ ok: true, hoje: merge(hoje), amanha: merge(amanha) });
}
