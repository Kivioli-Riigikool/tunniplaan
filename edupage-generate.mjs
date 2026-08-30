#!/usr/bin/env node
// Genereerib tunniplaani HTML-i otse EduPage'ist, ilma aSc XML-failita.
//
// Kasutus:
//   node edupage-generate.mjs viru
//   node edupage-generate.mjs kivioli-tee-25
//   node edupage-generate.mjs koik
//
// Loeb EduPage'i avalikku JSON-liidest, teisendab andmed samasse kujju,
// mida tunniplaan.html juba kasutab, ja kutsub valja selle enda
// HTML-i genereerimise funktsioonid. Renderdust siin ei dubleerita.

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laeAsendused } from './edupage-asendused.mjs';
import { edupagePost } from './edupage-fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const KOOLID = {
  'viru': {
    host: 'kivioli1keskkool.edupage.org',
    nimi: 'Kiviõli Riigikool, Viru õppekoht',
    valjund: 'dist/viru',
  },
  'kivioli-tee-25': {
    // NB! Uks taht erineb esimesest: kiviol1, mitte kivioli1.
    host: 'kiviol1keskkool.edupage.org',
    nimi: 'Kiviõli Riigikool, Kiviõli tee 25 õppekoht',
    valjund: 'dist/kivioli-tee-25',
  },
};

// Juhendatud tunni pikkus minutites, arvutatuna sloti algusest.
// 0 tahendab: naita aSc aegu muutmata. Vana 45-minutilise plaani
// demoks: TUND=0 TOPELT=0 node edupage-generate.mjs ...
const SINGLE_MIN = process.env.TUND !== undefined ? Number(process.env.TUND) : 40;
const DOUBLE_MIN = process.env.TOPELT !== undefined ? Number(process.env.TOPELT) : 75;

// ---------------------------------------------------------------
// EduPage
// ---------------------------------------------------------------

// Paringu tegemine, koos korduskatsetega, elab edupage-fetch.mjs-is.
const edupage = edupagePost;

// Leiab praegu kehtiva tunniplaani. NB! EduPage ei tagasta neid
// kuupaeva jarjekorras, seega massiivi viimane element ei ole uusim.
async function leiaViimaneTunniplaan(host) {
  const aasta = new Date().getMonth() >= 7
    ? new Date().getFullYear()
    : new Date().getFullYear() - 1;

  const d = await edupage(host, '/timetable/server/ttviewer.js?__func=getTTViewerData', [null, aasta]);
  const list = d?.r?.regular?.timetables || [];
  if (!list.length) throw new Error(`${host}: tunniplaane ei leitud`);

  const sorted = [...list].sort((a, b) => a.datefrom.localeCompare(b.datefrom));
  return sorted[sorted.length - 1];
}

async function laeAndmed(host, ttNum) {
  const d = await edupage(host, '/timetable/server/regulartt.js?__func=regularttGetData', [null, String(ttNum)]);
  const tables = d?.r?.dbiAccessorRes?.tables;
  if (!tables) throw new Error(`${host}: tunniplaani ${ttNum} andmeid ei saanud`);
  return Object.fromEntries(tables.map(t => [t.id, t.data_rows || []]));
}

// ---------------------------------------------------------------
// EduPage -> sama DB kuju, mille parseXML tunniplaan.html-is toodab
// ---------------------------------------------------------------

function teisendaDB(T, DB) {
  DB.periods = T.periods
    .map(p => ({
      period: parseInt(p.period, 10),
      name: p.name,
      short: p.short,
      starttime: p.starttime,
      endtime: p.endtime,
    }))
    .sort((a, b) => a.period - b.period);

  DB.breaks = (T.breaks || []).map(b => ({
    name: b.name,
    short: b.short,
    break: parseInt(b.break, 10),
    starttime: b.starttime,
    endtime: b.endtime,
  }));

  DB.subjects = {};
  for (const s of T.subjects) DB.subjects[s.id] = { id: s.id, name: s.name, short: s.short };

  // EduPage annab opetaja nime kujul "PEREKONNANIMI Eesnimi" (name_format LSF).
  DB.teachers = {};
  for (const t of T.teachers) {
    const osad = String(t.name || '').trim().split(/\s+/);
    const lastname = osad.shift() || '';
    const firstname = osad.join(' ');
    DB.teachers[t.id] = {
      id: t.id, firstname, lastname,
      name: t.name || t.short || '',
      short: t.short || '',
      color: t.color || '',
    };
  }

  DB.classes = {};
  for (const c of T.classes) {
    DB.classes[c.id] = {
      id: c.id, name: c.name, short: c.short,
      teacherid: c.teacherid || '',
    };
  }

  DB.classrooms = {};
  for (const r of T.classrooms) DB.classrooms[r.id] = { id: r.id, name: r.name, short: r.short };

  DB.groups = {};
  for (const g of T.groups) {
    DB.groups[g.id] = {
      id: g.id, name: g.name, classid: g.classid,
      entireclass: g.entireclass === true || g.entireclass === '1',
    };
  }

  DB.lessons = {};
  for (const l of T.lessons) {
    DB.lessons[l.id] = {
      id: l.id,
      subjectid: l.subjectid || '',
      classids: l.classids || [],
      teacherids: l.teacherids || [],
      classroomids: l.classroomids || [],
      groupids: l.groupids || [],
      periodspercard: parseInt(l.durationperiods || 1, 10),
    };
  }

  DB.cards = T.cards.map(c => ({
    lessonid: c.lessonid,
    period: parseInt(c.period, 10),
    days: c.days,
    classroomids: c.classroomids || [],
  }));
}

// ---------------------------------------------------------------
// Laenab tunniplaan.html-i enda renderdusfunktsioonid
// ---------------------------------------------------------------

function laeRenderdaja() {
  const html = readFileSync(join(HERE, 'tunniplaan.html'), 'utf8');
  const algus = html.indexOf('<script>\n');
  const lopp = html.lastIndexOf('\n</script>');
  if (algus < 0 || lopp < 0) throw new Error('tunniplaan.html: skriptiplokki ei leitud');
  const src = html.slice(algus + '<script>\n'.length, lopp);

  const noop = () => {};
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    createElement: () => ({ style: {}, classList: { add: noop }, appendChild: noop }),
  };

  const tehas = new Function('document', 'window', 'alert', 'console', `
    ${src}
    return {
      DB, buildIndexPage, buildTimetableHtml, wrapInHtmlPage, uniqueSlugs, getExportCss,
      seaPaarid: v => { PERIOD_PAIRS = v; },
      seaUksik:  v => { SINGLE_LESSON_MINUTES = v; },
      seaTopelt: v => { DOUBLE_LESSON_MINUTES = v; },
      seaAsendused: v => { SUBST_CELLS = v; },
    };
  `);

  return tehas(doc, { print: noop }, noop, console);
}

// Paarid tuletatakse perioodidest: 1+2, 3+4, 5+6, 7+8.
function tuletaPaarid(periods) {
  const nums = periods.map(p => p.period).filter(p => p > 0);
  const paarid = [];
  for (let i = 0; i + 1 < nums.length; i += 2) paarid.push([nums[i], nums[i + 1]]);
  return paarid;
}

// ---------------------------------------------------------------
// Kehtivus
// ---------------------------------------------------------------

// aSc paneb kehtivusperioodi globals-i tekstiväljale kujul
// "Kehtivus: 23/05/2026-09/06/2026". Tagastab lõppkuupäeva ISO kujul.
function kehtivuseLopp(T) {
  const tekst = T.globals?.[0]?.settings?.m_strDateBellowTimeTable || '';
  const m = tekst.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[6]}-${m[5]}-${m[4]}` : null;
}

// Riba index.html-i ulaossa: milline plaan, mis ajaga ja millal tehtud.
// Ilma selleta ei saa vastuvotja aru, et tegu on hetketombega, mitte live-vaatega.
// Genereerimise aeg Eesti ajas. Actionsis jookseb masin UTC peal,
// aga lugeja loeb kellaaega kohalikus ajas.
function uuendatud() {
  return new Date().toLocaleString('et-EE', {
    timeZone: 'Europe/Tallinn',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function paiseRiba(kool, tp, lopp, kuupaev, aegunud) {
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hoiatus = aegunud
    ? `<div class="subst-box"><h3>Tähelepanu</h3>` +
      `<p style="margin:0">See tunniplaan kehtis kuni <strong>${esc(lopp)}</strong> ja on aegunud. ` +
      `Kool ei ole veel uut plaani avaldanud.</p></div>`
    : '';
  return hoiatus +
    `<p style="color:#666; font-size:0.85rem; margin:0 0 1rem 0">` +
    `${esc(kool.nimi)}<br>` +
    `Tunniplaan: ${esc(tp.text)}${lopp ? `, kehtiv kuni ${esc(lopp)}` : ''}<br>` +
    `Asendused seisuga ${esc(kuupaev)}. Leht uuendatud ${esc(uuendatud())}.` +
    `</p>`;
}

// ---------------------------------------------------------------
// Asendused
// ---------------------------------------------------------------

// Esmaspaev = 0, ... reede = 4. Nadalavahetus tagastab null.
function nadalapaevaIndeks(kuupaev) {
  const d = new Date(kuupaev + 'T12:00:00Z').getUTCDay();
  return d >= 1 && d <= 5 ? d - 1 : null;
}

function asendusteKast(read, kuupaev) {
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const punktid = read.map(r =>
    `<li><strong>${esc(r.silt)}</strong>` +
    (r.perioodid.length ? ` (${r.perioodid.join('.-')}. tund)` : '') +
    `: ${esc(r.tekst)}</li>`
  ).join('');
  return `<div class="subst-box"><h3>Tänased muudatused ` +
    `<span class="subst-date">${esc(kuupaev)}</span></h3><ul>${punktid}</ul></div>`;
}

// ---------------------------------------------------------------
// Juurleht
// ---------------------------------------------------------------

// dist/index.html on kogu saidi avaleht: valik oppekohtade vahel.
// Kirjutatakse alles parast oppekohtade genereerimist, sest iga
// oppekoha kaust kustutatakse ja tehakse jooksu alguses uuesti.
function kirjutaJuurLeht(R, seisud) {
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const juur = join(HERE, 'dist');
  mkdirSync(join(juur, 'assets'), { recursive: true });
  writeFileSync(join(juur, 'assets/style.css'), R.getExportCss());

  // Loetleme need oppekohad, mille kaust on olemas. Nii ei teki katkist
  // linki, kui jooksutati ainult uht oppekohta.
  const olemas = Object.entries(KOOLID).filter(
    ([, kool]) => existsSync(join(HERE, kool.valjund, 'index.html'))
  );

  const lingid = olemas.map(([votme, kool]) => {
    const kaust = kool.valjund.replace(/^dist\//, '');
    const silt = esc(kool.nimi.replace(/^Kiviõli Riigikool, /, ''));
    const aegunud = seisud[votme]?.aegunud;
    return `<a href="${kaust}/index.html">${silt}${aegunud ? ' (aegunud)' : ''}</a>`;
  }).join('');

  const hoiatus = olemas.some(([votme]) => seisud[votme]?.aegunud)
    ? `<div class="subst-box"><h3>Tähelepanu</h3><p style="margin:0">` +
      `Vähemalt ühe õppekoha tunniplaan on aegunud: kool ei ole veel uut plaani avaldanud.` +
      `</p></div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="et">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kiviõli Riigikooli tunniplaan</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div class="container">
<header class="page-header"><h1>Kiviõli Riigikooli tunniplaan</h1></header>
${hoiatus}<div class="nav-group"><h2>Õppekoht</h2><div class="nav-list">${lingid}</div></div>
<p style="color:#666; font-size:0.85rem; margin:1rem 0 0 0">Leht uuendatud ${esc(uuendatud())}.</p>
</div>
</body>
</html>
`;
  writeFileSync(join(juur, 'index.html'), html);
}

// ---------------------------------------------------------------

async function genereeri(votmed, kuupaev) {
  const seisud = {};
  let viimaneR = null;

  for (const votme of votmed) {
    const kool = KOOLID[votme];
    if (!kool) throw new Error(`Tundmatu kool: ${votme}`);

    const tp = await leiaViimaneTunniplaan(kool.host);
    const T = await laeAndmed(kool.host, tp.tt_num);

    // Aegunud tunniplaani avaldamine on hullem kui mitte midagi avaldada.
    const lopp = kehtivuseLopp(T);
    const aegunud = Boolean(lopp && lopp < kuupaev);
    if (aegunud) {
      console.warn(
        `\n  !!! AEGUNUD TUNNIPLAAN !!!\n` +
        `  Uusim EduPage'i tunniplaan kehtis kuni ${lopp}, täna on ${kuupaev}.\n` +
        `  Kool ei ole veel uut plaani avaldanud. Neid faile EI TOHI kodulehele panna.\n`
      );
    }

    const paev = nadalapaevaIndeks(kuupaev);
    let asendused = {};
    if (paev === null) {
      console.log(`  (${kuupaev} on nädalavahetus, asendusi ei laeta)`);
    } else {
      try {
        asendused = await laeAsendused(kool.host, kuupaev);
      } catch (e) {
        // Asenduste ebaonnestumine ei tohi tunniplaani avaldamist blokeerida.
        console.warn(`  HOIATUS: asendusi ei saanud (${e.message}), tunniplaan tehakse ilma nendeta`);
      }
    }

    const R = laeRenderdaja();
    viimaneR = R;
    seisud[votme] = { aegunud, lopp };
    teisendaDB(T, R.DB);
    R.seaPaarid(tuletaPaarid(R.DB.periods));
    R.seaUksik(SINGLE_MIN);
    R.seaTopelt(DOUBLE_MIN);

    const klassid = Object.values(R.DB.classes);
    const opetajad = Object.values(R.DB.teachers);
    const ruumid = Object.values(R.DB.classrooms);

    const slugs = {
      class: R.uniqueSlugs(klassid, c => c.short || c.name),
      teacher: R.uniqueSlugs(opetajad, t => (t.firstname + '-' + t.lastname).trim() || t.name),
      room: R.uniqueSlugs(ruumid, r => r.short || r.name),
    };

    const juur = join(HERE, kool.valjund);
    rmSync(juur, { recursive: true, force: true });
    for (const d of ['', 'assets', 'klass', 'opetaja', 'ruum']) mkdirSync(join(juur, d), { recursive: true });

    writeFileSync(join(juur, 'assets/style.css'), R.getExportCss());
    // buildIndexPage tagastab terve lehe, seega riba lisame paise jarele.
    const indexHtml = R.buildIndexPage(slugs).replace(
      '<header class="page-header"><h1>Tunniplaan</h1></header>',
      '<header class="page-header"><h1>Tunniplaan</h1></header>' +
        paiseRiba(kool, tp, lopp, kuupaev, aegunud)
    );
    writeFileSync(join(juur, 'index.html'), indexHtml);

    const asendusedTrim = new Map(
      Object.entries(asendused).map(([k, v]) => [k.trim(), v])
    );

    let muudetud = 0;
    const kirjuta = (kaust, tyyp, olemid, nimi) => {
      for (const o of olemid) {
        // Asendused seotakse klassi nime jargi, nagu EduPage neid grupeerib.
        // NB! aSc-s on mone klassi nimes lopus tuhik ("1.v "), asenduste
        // lehel mitte, seega vordleme trimmitud kujul.
        const read = tyyp === 'class' && paev !== null
          ? (asendusedTrim.get(String(o.short || '').trim()) ||
             asendusedTrim.get(String(o.name || '').trim()) || [])
          : [];

        if (read.length) {
          const cells = new Map();
          for (const r of read) {
            for (const per of r.perioodid) cells.set(`${paev}:${per}`, r);
          }
          R.seaAsendused(cells);
          muudetud++;
        } else {
          R.seaAsendused(null);
        }

        let body = R.buildTimetableHtml(tyyp, o.id, slugs);
        if (read.length) body = asendusteKast(read, kuupaev) + body;

        const fail = slugs[tyyp][o.id] + '.html';
        writeFileSync(join(juur, kaust, fail), R.wrapInHtmlPage(nimi(o), body, '../assets/style.css'));
      }
      R.seaAsendused(null);
    };
    kirjuta('klass', 'class', klassid, c => c.name);
    kirjuta('opetaja', 'teacher', opetajad, t => t.name);
    kirjuta('ruum', 'room', ruumid, r => r.name);

    console.log(
      `${kool.nimi}\n` +
      `  tunniplaan nr ${tp.tt_num}, kehtib alates ${tp.datefrom} (${tp.text})\n` +
      `  ${klassid.length} klassi, ${opetajad.length} õpetajat, ${ruumid.length} ruumi, ` +
      `${R.DB.cards.length} kaarti\n` +
      `  ${muudetud} klassi tänaste muudatustega (${kuupaev})\n` +
      `  -> ${kool.valjund}/`
    );
  }

  if (viimaneR) {
    kirjutaJuurLeht(viimaneR, seisud);
    console.log('  -> dist/index.html (õppekoha valik)');
  }
}

const arg = process.argv[2] || 'koik';
const kuupaev = process.argv[3] || new Date().toISOString().slice(0, 10);
const votmed = arg === 'koik' ? Object.keys(KOOLID) : [arg];
genereeri(votmed, kuupaev).catch(err => {
  console.error('VIGA:', err.message);
  // fetchi vead peidavad tegeliku pohjuse cause alla.
  if (err.cause) console.error('  põhjus:', err.cause.code || err.cause.message || err.cause);
  process.exit(1);
});
