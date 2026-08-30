// Loeb EduPage'ist ühe päeva asendused ja teisendab need struktuurseks kujuks.
//
// EduPage tagastab valmis renderdatud HTML-i, aga see on masinloetav:
// iga rea CSS-klass utleb muudatuse tuubi, nii et eestikeelset vaba teksti
// ei ole vaja tolgendada. Teksti kasutame ainult kuvamiseks.

const TUUBID = {
  change: { silt: 'Asendus', margis: '!', klass: 'subst-change' },
  remove: { silt: 'Jääb ära', margis: '×', klass: 'subst-remove' },
  add: { silt: 'Lisatud tund', margis: '+', klass: 'subst-add' },
  absent: { silt: 'Puudub', margis: '!', klass: 'subst-absent' },
  event: { silt: 'Üritus', margis: '★', klass: 'subst-event' },
  event_absent: { silt: 'Üritus', margis: '★', klass: 'subst-event' },
};

function tekst(html) {
  return html
    .replace(/<s>(.*?)<\/s>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// "5." -> [5];  "1 - 2." -> [1, 2];  "" -> []
function parsiPeriood(s) {
  const nums = tekst(s).match(/\d+/g);
  if (!nums) return [];
  const a = nums.map(Number);
  if (a.length === 2 && a[1] > a[0]) {
    const out = [];
    for (let i = a[0]; i <= a[1]; i++) out.push(i);
    return out;
  }
  return a;
}

export function parsiAsendused(html) {
  const tulemus = {};

  const sektsioonid = html.split('<div class="section');
  for (const sek of sektsioonid.slice(1)) {
    const h = sek.match(/<div class="header">\s*<span[^>]*>(.*?)<\/span>/s);
    if (!h) continue;
    const nimi = tekst(h[1]);
    if (!nimi) continue;

    const read = [];
    const re = /<div class="row ([^"]*)">(.*?)(?=<div class="row |<\/div><\/div>)/gs;
    let m;
    while ((m = re.exec(sek)) !== null) {
      const tyyp = m[1].trim();
      const sisu = m[2];

      const per = sisu.match(/<div class="period">\s*<span[^>]*>(.*?)<\/span>/s);
      const inf = sisu.match(/<div class="info">\s*<span[^>]*>(.*?)<\/span>/s);
      if (!inf) continue;

      read.push({
        tyyp,
        ...(TUUBID[tyyp] || { silt: tyyp, margis: '!', klass: 'subst-change' }),
        perioodid: per ? parsiPeriood(per[1]) : [],
        tekst: tekst(inf[1]),
      });
    }

    if (read.length) tulemus[nimi] = read;
  }

  return tulemus;
}

export async function laeAsendused(host, kuupaev, mode = 'classes') {
  const res = await fetch(`https://${host}/substitution/server/viewer.js?__func=getSubstViewerDayDataHtml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ __args: [null, { date: kuupaev, mode }], __gsh: '00000000' }),
  });
  if (!res.ok) throw new Error(`asenduste päring vastas ${res.status}`);
  const d = await res.json();
  if (typeof d?.r !== 'string') throw new Error('asenduste vastus ei olnud oodatud kujul');
  return parsiAsendused(d.r);
}
