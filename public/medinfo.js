// Plain-language "what it's for" notes for common medicines in cancer care.
// General information only: the care team knows why each one was prescribed.
// Each entry: [names to match (generic first, then brand names), description].

const GUIDE = [
  // Nausea and vomiting
  [['ondansetron', 'zofran'], 'Prevents and treats nausea and vomiting, especially from chemotherapy or radiation. It blocks a signal in the gut and brain that sets off the urge to throw up.'],
  [['granisetron', 'kytril', 'sustol', 'sancuso'], 'Prevents nausea and vomiting from chemotherapy. It works the same way as ondansetron (Zofran).'],
  [['palonosetron', 'aloxi'], 'Prevents nausea and vomiting from chemotherapy, and keeps working for several days after a treatment.'],
  [['aprepitant', 'fosaprepitant', 'emend', 'cinvanti'], 'Helps prevent nausea and vomiting from chemotherapy, especially the delayed kind that shows up a day or more after treatment. Usually given along with other anti-nausea medicines.'],
  [['prochlorperazine', 'compazine'], 'Treats nausea and vomiting. Often used as a backup "as needed" medicine when other anti-nausea medicines aren\'t enough. It can cause drowsiness.'],
  [['promethazine', 'phenergan'], 'Treats nausea and vomiting, and can also help with allergies. It often causes drowsiness.'],
  [['metoclopramide', 'reglan'], 'Eases nausea and helps the stomach empty food into the gut faster.'],
  [['olanzapine', 'zyprexa'], 'Originally a mental-health medicine, but at low doses it is widely used in cancer care to prevent nausea from chemotherapy. It can also help with sleep and appetite. It often causes drowsiness, so it\'s usually taken at bedtime.'],
  [['dronabinol', 'marinol', 'syndros'], 'A medicine related to cannabis that eases nausea and helps boost appetite.'],
  [['scopolamine', 'transderm scop'], 'A skin patch that prevents nausea, including motion sickness.'],

  // Steroids
  [['dexamethasone', 'decadron'], 'A steroid. In cancer care it is used to prevent nausea from chemotherapy, reduce swelling, and prevent allergic reactions to some treatments. It can cause trouble sleeping, higher blood sugar and a bigger appetite, so it\'s usually taken in the morning with food.'],
  [['prednisone', 'deltasone', 'prednisolone', 'methylprednisolone', 'medrol'], 'A steroid that calms inflammation and swelling. It is also part of some cancer treatments. It can raise blood sugar, affect sleep and increase appetite; take it with food.'],

  // Anxiety and sleep
  [['lorazepam', 'ativan'], 'Calms anxiety and can also help with nausea and sleep. It\'s a sedative, so it can cause drowsiness; avoid alcohol and driving after taking it.'],
  [['alprazolam', 'xanax'], 'Calms anxiety and panic. It can cause drowsiness; avoid alcohol and driving after taking it.'],
  [['clonazepam', 'klonopin'], 'Calms anxiety and can help with sleep. It can cause drowsiness; avoid alcohol and driving after taking it.'],
  [['zolpidem', 'ambien'], 'A sleep medicine that helps you fall asleep. Take it only when you can get a full night in bed.'],
  [['trazodone', 'desyrel'], 'An antidepressant that is commonly used at low doses to help with sleep.'],
  [['melatonin'], 'A supplement that helps the body\'s sleep cycle and can make it easier to fall asleep.'],
  [['mirtazapine', 'remeron'], 'An antidepressant that is also used to help with sleep and to boost appetite.'],
  [['sertraline', 'zoloft', 'escitalopram', 'lexapro', 'citalopram', 'celexa', 'fluoxetine', 'prozac', 'paroxetine', 'paxil'], 'Treats depression and anxiety, which are common during cancer treatment. It usually takes a few weeks to feel the full effect.'],

  // Pain
  [['hydromorphone', 'dilaudid'], 'A strong opioid pain reliever for moderate to severe pain. It can cause drowsiness and constipation. Keep it locked away and take it only as prescribed.'],
  [['oxycodone', 'oxycontin', 'roxicodone', 'oxy ir', 'percocet', 'endocet'], 'A strong opioid pain reliever for moderate to severe pain. It can cause drowsiness and constipation. Keep it locked away and take it only as prescribed. (Percocet also contains acetaminophen.)'],
  [['morphine', 'ms contin', 'kadian', 'roxanol'], 'A strong opioid pain reliever for moderate to severe pain. Long-acting forms give steady relief; short-acting forms are for breakthrough pain. It can cause drowsiness and constipation.'],
  [['fentanyl', 'duragesic'], 'A strong opioid pain reliever, often given as a skin patch that releases medicine steadily for about 3 days. Used for ongoing pain. Keep heat (heating pads, hot baths, hot tubs) away from the patch.'],
  [['hydrocodone', 'norco', 'vicodin', 'lortab'], 'An opioid pain reliever for moderate pain, usually combined with acetaminophen (Tylenol). It can cause drowsiness and constipation.'],
  [['methadone', 'dolophine'], 'A long-acting opioid pain reliever for ongoing pain. The dose needs careful adjustment, so take it exactly as prescribed.'],
  [['tramadol', 'ultram'], 'A pain reliever for moderate pain. It works partly like an opioid and can cause drowsiness or nausea.'],
  [['acetaminophen', 'tylenol', 'paracetamol'], 'Relieves mild pain and lowers fever. During chemo, call the care team about a fever before treating it, since a fever can be a sign of infection. Watch the total daily amount, because it\'s also in many combination products.'],
  [['ibuprofen', 'advil', 'motrin', 'naproxen', 'aleve', 'naprosyn', 'celecoxib', 'celebrex', 'meloxicam', 'mobic'], 'Relieves pain, swelling and fever (an "anti-inflammatory"). During cancer treatment, check with the care team before using it, since it can affect bleeding, the stomach and the kidneys.'],
  [['gabapentin', 'neurontin'], 'Treats nerve pain, such as burning, tingling or shooting pain, including nerve pain from some chemotherapy. It can cause dizziness or drowsiness.'],
  [['pregabalin', 'lyrica'], 'Treats nerve pain, such as burning, tingling or shooting pain. It can cause dizziness or drowsiness.'],
  [['duloxetine', 'cymbalta'], 'An antidepressant that is also used for nerve pain, including tingling or numbness in the hands and feet from chemotherapy.'],
  [['lidocaine', 'lidoderm', 'xylocaine'], 'A numbing medicine. As a patch or cream it eases pain in one spot; as a liquid mouth rinse it numbs painful mouth sores.'],
  [['magic mouthwash', 'miracle mouthwash'], 'A mixed mouth rinse, usually with a numbing medicine, that eases pain from mouth sores caused by cancer treatment.'],

  // Bowels
  [['senna', 'sennosides', 'senokot'], 'A laxative that helps prevent and treat constipation, especially constipation caused by opioid pain medicines. It works overnight by gently stimulating the bowels.'],
  [['docusate', 'colace'], 'A stool softener that makes bowel movements easier to pass. Often taken along with senna.'],
  [['polyethylene glycol', 'miralax', 'peg 3350', 'glycolax'], 'Treats constipation by drawing water into the bowel to soften stool. The powder is mixed into a drink.'],
  [['bisacodyl', 'dulcolax'], 'A laxative that stimulates the bowels to relieve constipation.'],
  [['lactulose'], 'A liquid laxative that softens stool by drawing water into the bowel.'],
  [['loperamide', 'imodium'], 'Slows down diarrhea. Some cancer treatments cause diarrhea; follow the care team\'s instructions on how much to take and when to call.'],
  [['diphenoxylate', 'atropine', 'lomotil'], 'Slows down diarrhea. Take it only as directed.'],

  // Stomach
  [['omeprazole', 'prilosec', 'pantoprazole', 'protonix', 'esomeprazole', 'nexium', 'lansoprazole', 'prevacid'], 'Lowers stomach acid. Used for heartburn and reflux, and to protect the stomach, for example while taking steroids.'],
  [['famotidine', 'pepcid'], 'Lowers stomach acid to ease heartburn and protect the stomach. Sometimes given before treatments to help prevent allergic reactions.'],
  [['sucralfate', 'carafate'], 'Coats and protects sore areas in the stomach or throat.'],

  // Blood and infection
  [['filgrastim', 'neupogen', 'zarxio', 'nivestym', 'pegfilgrastim', 'neulasta', 'udenyca', 'fulphila', 'ziextenzo'], 'Helps the body make more white blood cells after chemotherapy, which lowers the risk of infection. It can cause aching bones for a few days; ask the care team what helps.'],
  [['epoetin', 'procrit', 'epogen', 'retacrit', 'darbepoetin', 'aranesp'], 'Helps the body make more red blood cells to treat anemia (low red blood cell count), which can cause tiredness.'],
  [['enoxaparin', 'lovenox'], 'A blood thinner given as a shot under the skin. It prevents or treats blood clots, which are more common with cancer. Watch for unusual bruising or bleeding.'],
  [['apixaban', 'eliquis', 'rivaroxaban', 'xarelto', 'edoxaban', 'savaysa', 'dabigatran', 'pradaxa'], 'A blood thinner pill that prevents or treats blood clots, which are more common with cancer. Watch for unusual bruising or bleeding, and tell every doctor and dentist you take it.'],
  [['warfarin', 'coumadin', 'jantoven'], 'A blood thinner that prevents or treats blood clots. It needs regular blood tests, and some foods and medicines can change how it works.'],
  [['fluconazole', 'diflucan'], 'Treats or prevents fungal (yeast) infections, such as thrush in the mouth.'],
  [['nystatin'], 'Treats yeast infections in the mouth (thrush). It\'s usually swished around the mouth, then swallowed or spat out as directed.'],
  [['acyclovir', 'zovirax', 'valacyclovir', 'valtrex', 'famciclovir', 'famvir'], 'An antiviral that treats or prevents viruses like shingles and cold sores, which can flare up when the immune system is weakened.'],
  [['levofloxacin', 'levaquin', 'ciprofloxacin', 'cipro'], 'An antibiotic that treats bacterial infections. It\'s sometimes taken to prevent infection while white blood cell counts are low.'],
  [['sulfamethoxazole', 'trimethoprim', 'bactrim', 'septra', 'smz tmp'], 'An antibiotic. During cancer treatment it\'s often taken a few days a week to prevent a specific lung infection.'],
  [['amoxicillin', 'augmentin', 'cephalexin', 'keflex', 'azithromycin', 'zithromax', 'doxycycline'], 'An antibiotic that treats bacterial infections. Take every dose until it\'s finished, even if you feel better.'],

  // Other supportive care
  [['allopurinol', 'zyloprim'], 'Lowers uric acid in the blood. In cancer care it\'s often used to protect the kidneys when treatment breaks down a lot of cancer cells quickly.'],
  [['diphenhydramine', 'benadryl'], 'An antihistamine for allergies and itching. It\'s sometimes given before treatments to prevent allergic reactions, and it often causes drowsiness.'],
  [['loratadine', 'claritin'], 'An antihistamine for allergies. It\'s also sometimes used to ease bone aches from white-blood-cell-boosting shots.'],
  [['cetirizine', 'zyrtec'], 'An antihistamine for allergies, itching and hives.'],
  [['megestrol', 'megace'], 'Helps increase appetite and weight. It\'s also used as a hormone treatment for some cancers.'],
  [['potassium chloride', 'k dur', 'klor con'], 'Replaces potassium, a mineral the heart and muscles need, when blood levels are low.'],
  [['magnesium oxide', 'mag ox'], 'Replaces magnesium, a mineral that some chemotherapy drugs can lower.'],
  [['vitamin d', 'cholecalciferol', 'ergocalciferol'], 'A vitamin that helps keep bones strong.'],
  [['calcium'], 'A mineral supplement that helps keep bones strong.'],
  [['ferrous sulfate', 'iron'], 'Replaces iron to help treat anemia (low red blood cell count). It can darken stool and cause constipation.'],
  [['folic acid', 'folate'], 'A B vitamin that the body needs to make healthy blood cells. Sometimes taken alongside certain chemotherapy drugs.'],
  [['levothyroxine', 'synthroid', 'levoxyl'], 'Replaces thyroid hormone when the thyroid isn\'t making enough. Usually taken on an empty stomach in the morning.'],
  [['metformin', 'glucophage'], 'Lowers blood sugar in diabetes.'],

  // Cancer treatments taken at home
  [['tamoxifen', 'nolvadex', 'soltamox'], 'A hormone therapy for breast cancer. It blocks estrogen from feeding cancer cells and lowers the chance of the cancer coming back.'],
  [['anastrozole', 'arimidex', 'letrozole', 'femara', 'exemestane', 'aromasin'], 'A hormone therapy for breast cancer after menopause. It lowers the body\'s estrogen, which some breast cancers need to grow. Joint aches are common; mention them to the care team.'],
  [['capecitabine', 'xeloda'], 'A chemotherapy pill that turns into a cancer-fighting drug inside the body. Watch for diarrhea and sore, red hands or feet, and tell the care team early if they appear.'],
  [['temozolomide', 'temodar'], 'A chemotherapy pill, used mainly for brain tumors.'],
  [['methotrexate', 'trexall'], 'A medicine that slows down fast-growing cells. It\'s used in some cancer treatments and, at much lower doses, for arthritis. Take it exactly as scheduled; some forms are taken only once a week.'],
  [['leucovorin', 'folinic acid'], 'A form of folic acid that works alongside some chemotherapy drugs, either to boost them or to protect healthy cells.'],
  [['abemaciclib', 'verzenio', 'palbociclib', 'ibrance', 'ribociclib', 'kisqali'], 'A targeted cancer pill for some breast cancers, usually taken with hormone therapy. It slows down cancer cell growth. Regular blood tests check for side effects.'],
  [['imatinib', 'gleevec'], 'A targeted cancer pill that blocks a signal certain cancer cells use to grow.'],
  [['olaparib', 'lynparza'], 'A targeted cancer pill that stops cancer cells from repairing their DNA, used for some ovarian, breast, prostate and pancreatic cancers.'],
];

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// How well an alias matches a typed name: the alias length, less a penalty per typo, or 0 for no match.
// Words are also tried joined together, so "Hydro Morphone" and "Polyethyleneglycol" still match.
function score(nameWords, alias) {
  const target = words(alias).join('');
  const allowed = target.length >= 10 ? 2 : target.length >= 7 ? 1 : 0;
  let best = 0;
  for (let i = 0; i < nameWords.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(nameWords.length, i + 3); j++) {
      joined += nameWords[j];
      const d = editDistance(joined, target);
      if (d <= allowed) best = Math.max(best, target.length - 4 * d);
    }
  }
  return best;
}

// Finds the closest guide entry for a medication name, e.g. "Ondansetron ODT 8mg" or "Metoclopramid".
// The longest, closest-spelled match wins, so "Hydro Morphine" picks hydromorphone over morphine.
export function lookupMedInfo(name) {
  const nameWords = words(name);
  let best = null;
  let bestScore = 0;
  for (const [names, text] of GUIDE) {
    for (const alias of names) {
      const s = score(nameWords, alias);
      if (s > bestScore) { bestScore = s; best = text; }
    }
  }
  return best;
}
