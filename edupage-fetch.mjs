// Uks koht, kus EduPage'i poole poordutakse.
//
// GitHub Actionsi masinast on vork habrasem kui kodusest arvutist:
// uhendus katkeb, DNS aegub, EduPage viskab vahel 5xx-i. Kuna cron
// jookseb iga 10 min tagant, ei tohi uks apsakas kogu avaldamist
// maha votta. Seega: paringule aegumine, kolm katset ja selge
// veateade, mis utleb ka pohjuse (fetch peidab selle cause alla).

const UA = 'tunniplaan (+https://github.com/jubejuss/tunniplaan)';
const KATSEID = 3;
const AEGUMINE_MS = 20000;

// Uhtlustab nii fetchi enda vead (cause.code) kui HTTP staatuse vead.
function pohjus(e) {
  return e?.cause?.code || e?.cause?.message || e?.code || e?.message || String(e);
}

export async function edupagePost(host, path, args) {
  let viimane;

  for (let katse = 1; katse <= KATSEID; katse++) {
    try {
      const res = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': UA,
        },
        body: JSON.stringify({ __args: args, __gsh: '00000000' }),
        signal: AbortSignal.timeout(AEGUMINE_MS),
      });
      if (!res.ok) throw new Error(`vastas ${res.status}`);
      return await res.json();
    } catch (e) {
      viimane = e;
      if (katse < KATSEID) {
        const ootel = katse * 3;
        console.warn(`  HOIATUS: ${host} ei vastanud (${pohjus(e)}), proovin ${ootel} s pärast uuesti`);
        await new Promise(r => setTimeout(r, ootel * 1000));
      }
    }
  }

  throw new Error(`${host}${path} ei vastanud ${KATSEID} katsega: ${pohjus(viimane)}`);
}
