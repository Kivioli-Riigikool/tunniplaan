# Kiviõli Riigikooli tunniplaan

Genereerib kooli tunniplaanist staatilised HTML-lehed, mida saab kooli kodulehele panna.
Andmed tulevad otse EduPage'ist, käsitsi ei pea midagi eksportima ega üles laadima.

Klient: Ingmar Jaska, Kiviõli Riigikool. Tehakse tasuta, sõbrale.

---

## Failid

| Fail | Mis see on |
|---|---|
| `tunniplaan.html` | Algne prototüüp. Brauseris töötav vidin, kuhu laetakse aSc XML. **Siin elab kogu renderdusloogika.** |
| `edupage-generate.mjs` | Node'i skript, mis loeb EduPage'ist ja genereerib HTML-i. Kutsub välja `tunniplaan.html`-i enda funktsioone. |
| `edupage-asendused.mjs` | Asenduste lugemine ja parsimine EduPage'ist. |
| `timetable_synthetic.xml` | Testandmed. Päris XML-i koolil ei ole, vt allpool. |
| `dist/` | Genereeritud väljund. Kustutatakse ja tehakse iga jooksuga uuesti. Gitis seda ei hoita. |
| `vahendaja/` | Cloudflare Worker, mille kaudu Actions EduPage'ini pääseb. |
| `.github/workflows/avalda.yml` | GitHub Actions: genereerib ja avaldab GitHub Pagesisse. |

**Renderdust ei ole dubleeritud.** `edupage-generate.mjs` loeb `tunniplaan.html`-ist skriptiploki välja, käivitab selle DOM-i asendajatega ja kasutab sealt `buildTimetableHtml`, `buildIndexPage`, `wrapInHtmlPage`, `getExportCss` funktsioone. See tähendab, et vidina välimuse parandus kandub automaatselt ka genereeritud failidesse. Vastutasuks on `laeRenderdaja()` sõltuv sellest, et need funktsioonid oma nime ja kuju säilitavad.

## Kasutamine

```bash
node edupage-generate.mjs koik                # mõlemad õppekohad, tänane kuupäev
node edupage-generate.mjs viru                # ainult Viru õppekoht
node edupage-generate.mjs viru 2026-05-25     # konkreetne kuupäev (asenduste jaoks)
```

Väljund: `dist/viru/` ja `dist/kivioli-tee-25/`, kummaski `index.html`, `assets/style.css`
ning kaustad `klass/`, `opetaja/`, `ruum/`.

Sõltuvusi ei ole, ainult Node. Võrgupäringud käivad `fetch`-iga.

---

## Avaldamine

Leht elab GitHub Pagesis ja uueneb ise: **https://jubejuss.github.io/tunniplaan/**

```
GitHub Actions -> Cloudflare Worker -> EduPage
              -> node edupage-generate.mjs koik -> dist/ -> GitHub Pages
```

`.github/workflows/avalda.yml` käivitub kolmel juhul:

- **iga push `main` peale** – generaatori või `tunniplaan.html`-i muudatus jõuab kohe lehele
- **ajakava järgi**, koolipäeviti iga 10 minuti tagant (cron `*/10 4-14 * * 1-5`, UTC) – see hoiab asendused värskena
- **käsitsi**: `gh workflow run avalda.yml` või Actions -> workflow -> Run workflow

Kui EduPage või vahendaja ei vasta, kukub jooks läbi ja **eelmine avaldatud versioon jääb lehele alles**. Katkist lehte ei teki.

Kohapeal vaatamiseks piisab `node edupage-generate.mjs koik` – kohalikust masinast käivad päringud otse, vahendajat vaja ei ole.

### Miks vahendaja

**EduPage ei võta GitHubi runneri IP-ga ühendust vastu.** Mõõdetud 30.08.2026 runneri pealt (Azure eastus2, IP 20.161.69.36):

| Test | Tulemus |
|---|---|
| DNS `kivioli1keskkool.edupage.org` | vastab, 148.251.77.16 |
| Muu internet (`api.ipify.org`) | vastab |
| EduPage IPv4, port 443 | timeout 20 s |
| EduPage IPv6, port 443 | ei ühendu |

Ühendus sureb TCP tasemel, enne kui ükski HTTP-päring välja läheb. Päiste, User-Agenti ega päringu kujuga sellest mööda ei saa. Cloudflare'i võrgust sama päring töötab, seega käivad päringud sealtkaudu.

GitHubi aadressiruumi avamist küsida ei ole mõtet: Actionsi IP-nimekirjas on 5625 IPv4-vahemikku, üle 28 miljoni aadressi, ja see muutub.

### Vahendaja

`vahendaja/` all on Cloudflare Worker, aadressil `https://tunniplaan-vahendaja.jubejuss.workers.dev`.

See ei ole üldine proxy:

| Piir | Miks |
|---|---|
| Ainult POST | Muud generaator ei kasuta |
| Ainult kaks EduPage'i hosti | Muidu on see lahtine proxy kogu internetile |
| Ainult teed `/timetable/server/` ja `/substitution/server/` | Sama põhjus |
| Võti päises `x-tunniplaan-voti` | Ilma selleta ei vastata. Kui võti on Workeris seadmata, keeldub see üldse töötamast |

Deploy ja võti:

```bash
cd vahendaja
npx wrangler deploy
npx wrangler secret put VOTI      # sama vaartus, mis GitHubi secret EDUPAGE_VOTI
```

GitHubis on kaks secretit: `EDUPAGE_VAHENDAJA` (Workeri aadress) ja `EDUPAGE_VOTI`. Võtit ennast kuskil loetaval kujul ei hoita – kui see kaob, genereeri uus ja pane mõlemasse kohta (Workeri secret ja GitHubi secret). Kui `EDUPAGE_VAHENDAJA` on seadmata, läheb päring otse – nii käitub kohalik masin.

Kui vahendajat kunagi vaja ei ole (nt generaator kolib kooli serverisse), piisab secreti eemaldamisest ja Workeri kustutamisest. Koodi muuta ei ole vaja.

### Aadress ja oma domeen

Juurleht (`dist/index.html`) on õppekoha valik, sealt edasi `viru/` ja `kivioli-tee-25/`.

Oma domeen `tunniplaan.krk.edu.ee` eeldab, et EENet teeb DNS-i CNAME-kirje `tunniplaan.krk.edu.ee -> jubejuss.github.io`. Alles pärast seda saab GitHubis Settings -> Pages -> Custom domain täita ja Enforce HTTPS sisse lülitada.

> **NB.** Kui repo kolib kunagi kooli konto või organisatsiooni alla, muutub ka CNAME sihtkoht. Tasub domeen tellida alles siis, kui konto on lõplik.

### Aegunud plaan

Generaator hoiatab konsoolis, aga ei peata avaldamist. Aegunud plaani puhul on nii juurlehel kui õppekoha lehel punase äärega hoiatuskast. **Kooli kodulehelt tasub sinna linkida alles siis, kui uus plaan on EduPage'is olemas.**

### Kui GitHub ajakava seiskab

Repos, kus 60 päeva midagi ei toimu, lülitab GitHub `schedule`-käivituse välja ja saadab sellest kirja. Taastamiseks piisab ühest push'ist või käsitsi käivitusest.

---

## Miks EduPage, mitte aSc XML

Kool ei saa aSc XML-faili kätte. Selleks on vaja lisalitsentsi, mida aSc jagab oma loogika alusel ja mida koolil ei ole. Prototüüp ehitati XML-i peale, aga tootmises seda sisendit ei eksisteeri.

aSc lükkab tunniplaani EduPage'i automaatselt ja EduPage'i avalik liides annab **sama andmemudeli** välja ilma sisselogimiseta. Seega litsentsiprobleemi lihtsalt ei ole.

XML-i sisend jäi `tunniplaan.html`-i alles arenduse ja testimise jaoks.

---

## EduPage'i liides

Dokumenteerimata, aga avalik. Kõik päringud on POST, keha kujul:

```json
{ "__args": [null, ...], "__gsh": "00000000" }
```

`__gsh` on EduPage'i enda CSRF-laadne token. Autentimata lugemise puhul piisab nullidest.

### Tunniplaanide nimekiri

```
POST /timetable/server/ttviewer.js?__func=getTTViewerData
__args: [null, <õppeaasta algusaasta>]
```

Tagastab `r.regular.timetables`, kus iga kirje on `{ tt_num, year, text, datefrom, hidden }`.

### Ühe tunniplaani andmed

```
POST /timetable/server/regulartt.js?__func=regularttGetData
__args: [null, "<tt_num>"]
```

Tagastab `r.dbiAccessorRes.tables`, massiiv `{ id, data_rows }` kirjeid.
Olulised tabelid: `periods`, `breaks`, `classes`, `teachers`, `classrooms`,
`subjects`, `groups`, `lessons`, `cards`, `globals`.

### Asendused

```
POST /substitution/server/viewer.js?__func=getSubstViewerDayDataHtml
__args: [null, { "date": "2026-05-25", "mode": "classes" }]
```

Tagastab **valmis renderdatud HTML-i**, mitte JSON-i. `mode` võib olla ka `teachers` või `classrooms` (viimased kaks pole veel kasutusel).

---

## Andmete vastendus

EduPage'i tabelid → sama `DB` kuju, mille `parseXML` prototüübis toodab. Enamik on üks ühele. Erandid:

| EduPage | Meie | Märkus |
|---|---|---|
| `lessons[].durationperiods` | `periodspercard` | Topelttunni pikkus perioodides |
| `teachers[].name` | `firstname` + `lastname` | Kujul `"PEREKONNANIMI Eesnimi"` (globals `name_format: "LSF"`). Splitime esimese tühiku pealt. |
| `breaks` | `DB.breaks` | Praktikas tühi, aSc-s vahetunde eraldi kirjeldatud ei ole |

Kasulik lisaväli: `globals[0].settings.m_strDateBellowTimeTable` annab teksti kujul
`"Kehtivus: 23/05/2026-09/06/2026"`. Sobib genereeritud lehe päisesse.

---

## Kellaaegade loogika

Kõige segasem osa. aSc slotid **ei muutu**, muutub ainult see, mida sloti sees näidatakse.

```
aSc slot 1: 9:00-9:45          aSc slot 2: 9:45-10:30

Kaks üksiktundi:
  9:00-9:40  juhendatud (40)    9:45-10:25  juhendatud (40)
  9:40-9:45  iseseisev  (5)     10:25-10:30 iseseisev  (5)

Topelttund samadel slotidel:
  9:00-10:15  juhendatud (75)
  10:15-10:30 iseseisev  (15)
```

Mõlemal juhul 90 minutit. **Topelttund ei ole lühem**, seal on lihtsalt üks pikk juhendatud plokk. 40 ja 75 on juhendatud aeg, ülejäänu on iseseisev töö.

Koodis:

- `SINGLE_LESSON_MINUTES = 40` — üksiktunni silt, arvutatakse sloti algusest
- `DOUBLE_LESSON_MINUTES = 75` — topelttunni silt, arvutatakse paari esimese sloti algusest
- `0` tähendab: näita aSc aegu muutmata

Mõlemad on `tunniplaan.html`-i seadetes muudetavad ja `edupage-generate.mjs`-is konstandid.

**Vana plaan on veel 45-minutiline.** Kuni uus 40/75 süsteem jõustub, tuleb vidinas panna mõlemad nulli, muidu näitab see tulevast seisu.

### Millised perioodid moodustavad paari

Klient ütles, et topelttunnid saavad olla ainult 1+2, 3+4, 5+6, 7+8, mitte 2+3.
**Praegustes andmetes see nii ei ole:** 27 topelttunnist 16 algavad paarisperioodilt.
Klient kinnitas, et uues plaanis neid enam ei tule, sest 75 minutit järjest ei mahu pika vahetunni otsa.

Neljaperioodiline plokk (nt algklasside üldõpetus) on **kaks topelttundi**, mitte üks neljakordne.

Kui see eeldus katki läheb, on `tuletaPaarid()` vale koht, kust otsida: praegu tuletab see paarid mehaaniliselt perioodide järjekorrast, mitte andmetest.

---

## Asendused

EduPage annab HTML-i, aga see on masinloetav, sest **iga rea CSS-klass ütleb muudatuse tüübi ära**. Eestikeelset vaba teksti ei pea tõlgendama, teksti kasutame ainult kuvamiseks.

| CSS-klass | Tähendus |
|---|---|
| `change` | Asendus |
| `remove` | Tund jääb ära |
| `add` | Lisatud tund |
| `absent` | Puudub |
| `event`, `event_absent` | Üritus |

Struktuur: `div.section` klassi kohta → `div.header` klassi nimi → `div.row.<tüüp>` →
`div.period` (nt `"5."` või `"1 - 2."`) ja `div.info` (aeg, aine, muudatuse kirjeldus).

Kuvamine: punase äärega kast lehe ülal + mõjutatud lahtritel punane joon all ja hüüumärk nurgas. Klient küsis just sellist esiletõstmist.

Maht: 25.05.2026 oli Viru õppekohas 178 muudatust 66 klassis. Ühel päeval.

---

## Lõksud, mis on juba korra hammustanud

Need on kõik päriselt juhtunud, mitte teoreetilised.

**1. Kaks aadressi erinevad ühe tähe võrra.**
Viru on `kivioli1keskkool`, Kiviõli tee 25 on `kiviol1keskkool`. Tähed `i` ja `l` on kohad vahetanud. Ära kunagi trüki neid käsitsi, need on `KOOLID` konfiguratsioonis.

**2. Tunniplaanide nimekiri ei ole kuupäeva järjekorras.**
Kui võtta massiivi viimane element, saab Kiviõli tee 25 puhul jaanuari 2025 plaani, mis on üle aasta vana. Viru puhul juhtub viimane element olema õige, nii et ühe kooliga testides jääb viga märkamata. **Alati sorteeri `datefrom` järgi.**

**3. Klassi nimes on lõpus tühik.**
aSc-s on `"1.v "` ja `"3.e "`, asenduste lehel `"1.v"` ja `"3.e"`. Ilma trimmimiseta jäävad need kaks klassi asendustest ilma ja keegi ei märka. Vaata `asendusedTrim`.

**4. `</script>` prototüübi sees.**
`tunniplaan.html` sisaldab template-literalides päris HTML-i sulgevaid silte, sh `</body>` ja `</html>`. Päris brauser saab hakkama, aga sanitiseerivad eelvaated lõpetavad skriptiploki esimese `</body>` peal ja renderdavad ülejäänud JS-i tekstina. Kõik sulgevad sildid skripti sees on escapitud kujul `<\/`. **Uut koodi lisades tee sama.**

---

## Kas seda saab juba kasutada

Tööriistana jah, kooli kodulehe päris tunniplaanina veel ei.

Skript jookseb, mõlemad õppekohad tulevad sisse, HTML tuleb välja. Aga kolm asja on vahel:

1. **Uut õppeaastat ei ole veel olemas.** Seisuga 23.08.2026 on mõlema õppekoha uusim EduPage'i plaan eelmisest õppeaastast ja kehtis kuni 09.06.2026. Kuni kool 2026/2027 plaani ei tee, ei ole midagi avaldada. Skript hoiatab nüüd aegunud plaani puhul eraldi.
2. **40/75 seadistus on vana andmestiku jaoks vale.** Generaator kasutab uut süsteemi, aga vana plaan on 45-minutiliste slotidega. Vanade andmete peal näitab see seetõttu valesid aegu. Uue plaaniga läheb õigeks.
3. **Avaldamist ei ole.** Failid tekivad `dist/` alla ja sinna nad jäävad.

Praktiline järeldus: praegu sobib see Ingmarile näitamiseks ja uue plaani peal katsetamiseks. Kodulehele suunamine saab toimuda alles siis, kui uus tunniplaan on EduPage'is olemas ja üle vaadatud.

## Mis on tegemata

- Asendused ainult klassilehtedel. Õpetaja ja ruumi vaadete jaoks on vaja `mode=teachers` ja `mode=classrooms` päringuid. Parser ise töötab.
- Genereeritakse ühe päeva seis. Otsustamata, kas näidata ka homset või kogu nädalat.
- Paarid tuletatakse mehaaniliselt, mitte `durationperiods` järgi. See tähendab, et topelttunni silti näeb ka klass, kellel seal topelttundi ei ole.
- Avaldatakse iga 10 min tagant uuesti, ka siis kui midagi ei muutunud. Muutuse tuvastamist ei ole.
- Kooli koduleht: kui failid peaks kunagi kooli enda serverisse minema, tuleb `avalda.yml`-i lõppu lisada rsync/SFTP samm. Vt `YLEVAADE.md` A-lahendus.
- Õpetajavaates on kellaajad mitmetimõistetavad, kui klassidel peaksid kunagi erinevad ajad tulema. Praegu on kõik ühe skeemi peal.

## Riskid, mida meeles pidada

**EduPage'i liides on dokumenteerimata.** Võib etteteatamata muutuda. Sellepärast on asenduste viga koodis eraldi püütud: kui asendusi ei saa, tehakse tunniplaan ilma nendeta ja antakse hoiatus. Avaldamise juurde tuleb sama loogika: vea korral jääb vana fail alles.

**Vastutus sisu eest.** Kui avaldatud plaan näitab vale asendust, on allikaks EduPage. Tasub see kuskil lehel ka välja öelda.

**Hooldus.** Töö on tasuta, aga hooldusootus tekib nagunii. Tasub endale aus olla, kui kaua seda üleval hoida jaksab.
