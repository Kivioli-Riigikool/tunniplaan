// Vahendaja EduPage'i ja GitHub Actionsi vahel.
//
// Miks: EduPage ei vota GitHubi runneri IP-ga uhendust vastu, aga
// Cloudflare'i omaga (loodetavasti) vastab. Actions kusib andmed
// siit, see Worker kusib EduPage'ilt ja annab vastuse muutmata edasi.
//
// See ei ole uldine proxy. Lubatud on tapselt kaks hosti ja kaks
// teed, ainult POST, ja ilma votmeta ei vastata midagi. Muidu leiab
// keegi selle aadressi ules ja kasutab seda millekski muuks.

const LUBATUD_HOSTID = new Set([
  'kivioli1keskkool.edupage.org',
  'kiviol1keskkool.edupage.org',
]);

const LUBATUD_TEED = [
  '/timetable/server/',
  '/substitution/server/',
];

const AEGUMINE_MS = 20000;

function keeldu(status, tekst) {
  return new Response(tekst + '\n', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return keeldu(405, 'Ainult POST.');
    }

    // Ilma seadistatud votmeta ei vastata kellelegi. Nii ei jaa
    // Worker kogemata lahti, kui secret on seadmata.
    if (!env.VOTI) {
      return keeldu(503, 'Votit ei ole seadistatud.');
    }
    if (request.headers.get('x-tunniplaan-voti') !== env.VOTI) {
      return keeldu(403, 'Vale voti.');
    }

    const u = new URL(request.url);
    const host = u.searchParams.get('host') || '';
    const tee = u.searchParams.get('tee') || '';

    if (!LUBATUD_HOSTID.has(host)) {
      return keeldu(400, 'Lubamatu host.');
    }
    if (!LUBATUD_TEED.some(p => tee.startsWith(p))) {
      return keeldu(400, 'Lubamatu tee.');
    }

    let vastus;
    try {
      vastus = await fetch(`https://${host}${tee}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'tunniplaan (+https://github.com/jubejuss/tunniplaan)',
        },
        body: await request.text(),
        signal: AbortSignal.timeout(AEGUMINE_MS),
      });
    } catch (e) {
      // Sama viga, mis GitHubis: EduPage ei vasta. Anname selle
      // edasi aruvalt, et logist oleks nada, kus asi kinni jaab.
      return keeldu(502, `EduPage ei vastanud: ${e?.cause?.code || e?.message || e}`);
    }

    return new Response(vastus.body, {
      status: vastus.status,
      headers: { 'Content-Type': vastus.headers.get('Content-Type') || 'application/json' },
    });
  },
};
