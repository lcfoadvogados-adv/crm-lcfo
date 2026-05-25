// api/gdrive-auth.js
// Inicia o fluxo OAuth 2.0 com o Google para autorizar acesso ao Drive

export default function handler(req, res) {
  const clientId    = process.env.GDRIVE_CLIENT_ID;
  const redirectUri = process.env.GDRIVE_REDIRECT_URI
    || 'https://crm-lcfo.vercel.app/api/gdrive-callback';

  if (!clientId) {
    return res.status(500).send('⚠️ GDRIVE_CLIENT_ID não configurada no Vercel.');
  }

  // Drive + Google Calendar (leitura)
  const scope = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ');
  const url   = 'https://accounts.google.com/o/oauth2/v2/auth'
    + `?client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&response_type=code`
    + `&scope=${encodeURIComponent(scope)}`
    + `&access_type=offline`
    + `&prompt=consent`;   // força refresh_token sempre

  console.log('[GDrive] Redirecionando para OAuth…');
  return res.redirect(url);
}
