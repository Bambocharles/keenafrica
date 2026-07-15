import { useState, useEffect, useCallback, useRef } from "react";

// ─── GRAMMAR RULES (shown on mistakes) ───
const RULES = {
  modal_inf: {
    tag: "MODAL + INFINITIEF",
    color: "#FF6B35",
    rule: "Na kan / wil / moet / zal / mag → werkwoord in INFINITIEF (hele vorm)",
    example: "Ik wil brood eten ✓   |   Ik wil brood eet ✗",
    mnemonic: "🧠 Modal = magneet → trekt de infinitief naar het einde!"
  },
  conj_no_modal: {
    tag: "GEEN MODAL → VERVOEGEN",
    color: "#E83F6F",
    rule: "Zonder modal verb → werkwoord VERVOEGEN bij het subject",
    example: "Ik eet brood ✓   |   Ik eten brood ✗",
    mnemonic: "🧠 Geen modal? Dan staat het werkwoord op plek 2 en VERVOEGD!"
  },
  bijzin: {
    tag: "BIJZIN → WERKWOORD ACHTERAAN",
    color: "#7B2D8E",
    rule: "Na omdat / dat / wanneer / als / waar / waarom / of → werkwoord naar het EINDE",
    example: "...omdat ik ziek ben ✓   |   ...omdat ik ben ziek ✗",
    mnemonic: "🧠 Bijzin-woord = stoplicht → werkwoord moet WACHTEN tot het einde!"
  },
  v2: {
    tag: "V2 — WERKWOORD OP PLEK 2",
    color: "#2D82B7",
    rule: "In een hoofdzin staat het vervoegde werkwoord ALTIJD op positie 2",
    example: "Morgen ga ik werken ✓   |   Morgen ik ga werken ✗",
    mnemonic: "🧠 Het werkwoord is een VIP → altijd plek 2 in de rij!"
  },
  het_de: {
    tag: "HET / DE",
    color: "#00A676",
    rule: "Elk zelfstandig naamwoord is 'de' of 'het' — je moet het leren per woord",
    example: "het feest, het adres, het weer  |  de kat, de dag, de supermarkt",
    mnemonic: "🧠 Twijfel? → het kind, het huis, het feest zijn veel voorkomende het-woorden"
  },
  naar_in: {
    tag: "NAAR vs IN",
    color: "#F4A261",
    rule: "Beweging/richting → NAAR  |  Locatie/positie → IN",
    example: "Ik ga naar Spanje ✓   |   Ik woon in Almere ✓",
    mnemonic: "🧠 GA = NAAR (beweging) | WOON/BEN = IN (stil)"
  },
  spelling: {
    tag: "SPELLING",
    color: "#E76F51",
    rule: "Let op veelgemaakte spelfouten in het Nederlands",
    example: "vakantie ✓ (niet: vacantie) | vandaag ✓ (niet: vandag)",
    mnemonic: "🧠 Nederlands ≠ Engels! Controleer elke letter."
  },
  capitals: {
    tag: "HOOFDLETTERS & LEESTEKENS",
    color: "#457B9D",
    rule: "Elke zin begint met een HOOFDLETTER en eindigt met een PUNT of VRAAGTEKEN",
    example: "Ik woon in Almere. ✓   |   ik woon in almere ✗",
    mnemonic: "🧠 Begin = GROOT, einde = PUNT. Altijd!"
  },
  ik_verb: {
    tag: "IK-VORM: GEEN -T",
    color: "#264653",
    rule: "Bij 'ik' krijgt het werkwoord GEEN -t  |  Bij 'hij/zij/het/u' WEL -t",
    example: "Ik werk ✓ | Hij werkt ✓ | Ik werkt ✗",
    mnemonic: "🧠 IK = stam (geen -t!)  |  HIJ/ZIJ = stam + t"
  },
  hij_zijn: {
    tag: "HIJ vs ZIJN",
    color: "#606C38",
    rule: "hij = he (subject)  |  zijn = his (bezittelijk)",
    example: "Hij is aardig ✓ | Zijn huis is groot ✓ | Zijn is aardig ✗",
    mnemonic: "🧠 HIJ doet iets | ZIJN bezit iets"
  },
  het_it: {
    tag: "HET — niet 'IT'",
    color: "#BC6C25",
    rule: "'It' bestaat NIET in het Nederlands → gebruik altijd HET",
    example: "Ik vind het leuk ✓   |   Ik vind it leuk ✗",
    mnemonic: "🧠 'It' = Engels! In het Nederlands altijd HET."
  },
  register: {
    tag: "FORMEEL vs INFORMEEL",
    color: "#9B2226",
    rule: "Manager/docent/overheid → u/kunt  |  Vriend/collega → je/jij/kun",
    example: "Beste meneer, kunt u... ✓  |  Hoi, kun je... ✓",
    mnemonic: "🧠 Onbekend/hoger = U  |  Vriend/gelijk = JE"
  },
  perfect: {
    tag: "VOLTOOID DEELWOORD (PERFECTUM)",
    color: "#5A189A",
    rule: "hebben/zijn op plek 2 + voltooid deelwoord ACHTERAAN",
    example: "Zij hebben mijn brievenbus kapot gemaakt ✓",
    mnemonic: "🧠 HEBBEN/ZIJN = plek 2, ge-...-(d/t) = einde!"
  },
  sep_verb: {
    tag: "SCHEIDBAAR WERKWOORD",
    color: "#B5179E",
    rule: "Scheidbare werkwoorden splitsen: prefix gaat naar het einde",
    example: "Ik maak de deur open ✓  |  Ik openmaak de deur ✗",
    mnemonic: "🧠 Het werkwoord breekt in twee: stam op plek 2, prefix naar het einde!"
  },
  luisteren_naar: {
    tag: "VAST VOORZETSEL",
    color: "#3A86FF",
    rule: "Sommige werkwoorden hebben een VAST voorzetsel: luisteren NAAR, wachten OP, zorgen VOOR",
    example: "Ik luister naar muziek ✓   |   Ik luister muziek ✗",
    mnemonic: "🧠 Luisteren = NAAR, wachten = OP, zorgen = VOOR — altijd!"
  }
};

// ─── QUESTION BANK: 220+ fill-in / choose / reorder sentences ───
const QUESTIONS = [
  // ══════ MODAL + INFINITIVE ══════
  { type: "fill", prompt: "Ik wil morgen naar de markt ___.", answer: "gaan", wrong: ["ga", "gaat", "ging"], rule: "modal_inf", hint: "wil + ?" },
  { type: "fill", prompt: "Zij moet haar huiswerk ___.", answer: "maken", wrong: ["maakt", "maak", "gemaakt"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Wij kunnen vandaag niet ___.", answer: "komen", wrong: ["kom", "komt", "kwamen"], rule: "modal_inf", hint: "kunnen + ?" },
  { type: "fill", prompt: "Ik mag hier niet ___.", answer: "parkeren", wrong: ["parkeer", "parkeert", "geparkeerd"], rule: "modal_inf", hint: "mag + ?" },
  { type: "fill", prompt: "Hij zal je morgen ___.", answer: "bellen", wrong: ["belt", "bel", "gebeld"], rule: "modal_inf", hint: "zal + ?" },
  { type: "fill", prompt: "Kun je me even ___?", answer: "helpen", wrong: ["help", "helpt", "geholpen"], rule: "modal_inf", hint: "kun + ?" },
  { type: "fill", prompt: "Ik wil dit weekend niet ___.", answer: "werken", wrong: ["werk", "werkt", "gewerkt"], rule: "modal_inf", hint: "wil + ?" },
  { type: "fill", prompt: "Zij moet de kinderen om 3 uur ___.", answer: "ophalen", wrong: ["haalt op", "haal op", "opgehaald"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Ik kan vandaag niet naar school ___.", answer: "fietsen", wrong: ["fiets", "fietst", "gefietst"], rule: "modal_inf", hint: "kan + ?" },
  { type: "fill", prompt: "Wil je vanavond bij ons ___?", answer: "eten", wrong: ["eet", "eet", "gegeten"], rule: "modal_inf", hint: "wil + ?" },
  { type: "fill", prompt: "Je moet de deur altijd op slot ___.", answer: "doen", wrong: ["doet", "doe", "gedaan"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Mag ik hier ___?", answer: "zitten", wrong: ["zit", "zit", "gezeten"], rule: "modal_inf", hint: "mag + ?" },
  { type: "fill", prompt: "Ik moet morgen vroeg ___.", answer: "opstaan", wrong: ["sta op", "staat op", "opgestaan"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Kun je de radio wat zachter ___?", answer: "zetten", wrong: ["zet", "zet", "gezet"], rule: "modal_inf", hint: "kun + ?" },
  { type: "fill", prompt: "Ik wil graag Nederlands ___.", answer: "leren", wrong: ["leer", "leert", "geleerd"], rule: "modal_inf", hint: "wil + ?" },
  { type: "fill", prompt: "Moet je morgen ook ___?", answer: "werken", wrong: ["werk", "werkt", "gewerkt"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Ik zal het pakketje voor je ___.", answer: "meenemen", wrong: ["neem mee", "neemt mee", "meegenomen"], rule: "modal_inf", hint: "zal + ?" },
  { type: "fill", prompt: "Wij willen een huis in Amsterdam ___.", answer: "kopen", wrong: ["koop", "koopt", "gekocht"], rule: "modal_inf", hint: "willen + ?" },

  // ══════ CONJUGATED (NO MODAL) ══════
  { type: "fill", prompt: "Ik ___ elke dag naar mijn werk.", answer: "fiets", wrong: ["fietsen", "fietst", "gefietst"], rule: "conj_no_modal", hint: "ik + fietsen = ?" },
  { type: "fill", prompt: "Ik ___ graag naar jazz.", answer: "luister", wrong: ["luisteren", "luistert", "geluisterd"], rule: "conj_no_modal", hint: "ik + luisteren = ?" },
  { type: "fill", prompt: "Ik ___ in Almere.", answer: "woon", wrong: ["wonen", "woont", "gewoond"], rule: "conj_no_modal", hint: "ik + wonen = ?" },
  { type: "fill", prompt: "Ik ___ drie keer per week brood.", answer: "eet", wrong: ["eten", "eet", "gegeten"], rule: "conj_no_modal", hint: "ik + eten = ?" },
  { type: "fill", prompt: "Ik ___ het brood bij de supermarkt.", answer: "koop", wrong: ["kopen", "koopt", "gekocht"], rule: "conj_no_modal", hint: "ik + kopen = ?" },
  { type: "fill", prompt: "Ik ___ elke ochtend koffie.", answer: "drink", wrong: ["drinken", "drinkt", "gedronken"], rule: "conj_no_modal", hint: "ik + drinken = ?" },
  { type: "fill", prompt: "Hij ___ elke dag om 7 uur op.", answer: "staat", wrong: ["staan", "sta", "opgestaan"], rule: "conj_no_modal", hint: "hij + opstaan = ?" },
  { type: "fill", prompt: "Zij ___ als verpleegkundige in het ziekenhuis.", answer: "werkt", wrong: ["werken", "werk", "gewerkt"], rule: "conj_no_modal", hint: "zij + werken = ?" },
  { type: "fill", prompt: "Wij ___ elke zondag bij oma.", answer: "eten", wrong: ["eet", "eet", "gegeten"], rule: "conj_no_modal", hint: "wij + eten = ?" },
  { type: "fill", prompt: "Ik ___ je morgen het boek.", answer: "geef", wrong: ["geven", "geeft", "gegeven"], rule: "conj_no_modal", hint: "ik + geven = ?" },
  { type: "fill", prompt: "Ik ___ met mijn vrouw in het park.", answer: "loop", wrong: ["lopen", "loopt", "gelopen"], rule: "conj_no_modal", hint: "ik + lopen = ?" },
  { type: "fill", prompt: "Ik ___ elke avond een boek.", answer: "lees", wrong: ["lezen", "leest", "gelezen"], rule: "conj_no_modal", hint: "ik + lezen = ?" },
  { type: "fill", prompt: "Hij ___ de auto elke zaterdag.", answer: "wast", wrong: ["wassen", "was", "gewassen"], rule: "conj_no_modal", hint: "hij + wassen = ?" },
  { type: "fill", prompt: "Ik ___ Nederlands op dinsdag.", answer: "leer", wrong: ["leren", "leert", "geleerd"], rule: "conj_no_modal", hint: "ik + leren = ?" },
  { type: "fill", prompt: "Ik ___ mijn kinderen elke dag naar school.", answer: "breng", wrong: ["brengen", "brengt", "gebracht"], rule: "conj_no_modal", hint: "ik + brengen = ?" },
  { type: "fill", prompt: "Zij ___ altijd te laat.", answer: "komt", wrong: ["komen", "kom", "gekomen"], rule: "conj_no_modal", hint: "zij + komen = ?" },
  { type: "fill", prompt: "Ik ___ je een e-mail over de vergadering.", answer: "stuur", wrong: ["sturen", "stuurt", "gestuurd"], rule: "conj_no_modal", hint: "ik + sturen = ?" },
  { type: "fill", prompt: "Ik ___ het niet.", answer: "weet", wrong: ["weten", "weet", "geweten"], rule: "conj_no_modal", hint: "ik + weten = ?" },

  // ══════ BIJZIN WORD ORDER ══════
  { type: "choose", prompt: "Ik kan niet komen, omdat ik morgen ziek ___.", options: ["ben", "is", "zijn", "bent"], answer: "ben", rule: "bijzin", hint: "omdat → werkwoord achteraan" },
  { type: "choose", prompt: "Hij zegt dat hij morgen niet ___ komen.", options: ["kan", "kunnen", "kunt", "kon"], answer: "kan", rule: "bijzin", hint: "dat → werkwoord achteraan" },
  { type: "choose", prompt: "Ik weet niet waar de sleutel ___.", options: ["ligt", "leggen", "legt", "gelegd"], answer: "ligt", rule: "bijzin", hint: "waar → werkwoord achteraan" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["omdat", "ik", "langer", "moet", "werken"], answer: "omdat ik langer moet werken", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["dat", "hij", "morgen", "niet", "kan", "komen"], answer: "dat hij morgen niet kan komen", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["omdat", "ik", "ziek", "ben"], answer: "omdat ik ziek ben", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["waar", "ik", "woon"], answer: "waar ik woon", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["dat", "Nederland", "toeristisch", "is"], answer: "dat Nederland toeristisch is", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["wat", "de", "extra", "kosten", "zijn"], answer: "wat de extra kosten zijn", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["waarom", "je", "wilt", "verhuizen"], answer: "waarom je wilt verhuizen", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["als", "je", "tijd", "hebt"], answer: "als je tijd hebt", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["wanneer", "ik", "de", "opdracht", "kan", "inleveren"], answer: "wanneer ik de opdracht kan inleveren", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["of", "hij", "de", "kat", "wil", "verzorgen"], answer: "of hij de kat wil verzorgen", rule: "bijzin" },
  { type: "choose", prompt: "Ik vraag of je mijn dienst ___ overnemen.", options: ["kunt", "kan", "kunnen", "kon"], answer: "kunt", rule: "bijzin", hint: "of → bijzin → werkwoord achteraan" },
  { type: "choose", prompt: "Weet je wanneer het feest ___?", options: ["begint", "beginnen", "begin", "begon"], answer: "begint", rule: "bijzin", hint: "wanneer → werkwoord achteraan" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["dat", "ik", "volgende", "week", "jarig", "ben"], answer: "dat ik volgende week jarig ben", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["omdat", "mijn", "buren", "mij", "hebben", "uitgenodigd"], answer: "omdat mijn buren mij hebben uitgenodigd", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["dat", "de", "vrienden", "mijn", "brievenbus", "hebben", "kapot", "gemaakt"], answer: "dat de vrienden mijn brievenbus kapot hebben gemaakt", rule: "bijzin" },

  // ══════ V2 WORD ORDER ══════
  { type: "reorder", prompt: "Begin met 'Morgen':", words: ["Morgen", "ga", "ik", "naar", "de", "markt"], answer: "Morgen ga ik naar de markt", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Volgende week':", words: ["Volgende", "week", "kom", "ik", "weer"], answer: "Volgende week kom ik weer", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Op zaterdag':", words: ["Op", "zaterdag", "werk", "ik", "niet"], answer: "Op zaterdag werk ik niet", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Vandaag':", words: ["Vandaag", "heb", "ik", "geen", "tijd"], answer: "Vandaag heb ik geen tijd", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'In het weekend':", words: ["In", "het", "weekend", "ga", "ik", "zwemmen"], answer: "In het weekend ga ik zwemmen", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Elke dag':", words: ["Elke", "dag", "eet", "ik", "brood"], answer: "Elke dag eet ik brood", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Gisteren':", words: ["Gisteren", "heb", "ik", "Nederlands", "geleerd"], answer: "Gisteren heb ik Nederlands geleerd", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Om 8 uur':", words: ["Om", "8", "uur", "begint", "de", "les"], answer: "Om 8 uur begint de les", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Vanaf volgende week':", words: ["Vanaf", "volgende", "week", "moet", "ik", "langer", "werken"], answer: "Vanaf volgende week moet ik langer werken", rule: "v2" },
  { type: "reorder", prompt: "Begin met 'Na het werk':", words: ["Na", "het", "werk", "ga", "ik", "naar", "huis"], answer: "Na het werk ga ik naar huis", rule: "v2" },

  // ══════ HET / DE ══════
  { type: "choose", prompt: "___ feest begint om 18.00 uur.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ adres is Buffelstraat 20.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ weer in Nederland is koud.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ kat moet eten krijgen.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ supermarkt is dicht.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ weekend is mijn favoriete tijd.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ brievenbus is kapot.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ huis is groot.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ kind speelt buiten.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ kantoor is op de tweede verdieping.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ bibliotheek is open tot 5 uur.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ probleem is opgelost.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ muziek is te hard.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ ziekenhuis is ver weg.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ sleutel ligt op tafel.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ restaurant is duur.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ eten is lekker.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ dag was mooi.", options: ["De", "Het"], answer: "De", rule: "het_de" },
  { type: "choose", prompt: "___ werk is zwaar.", options: ["Het", "De"], answer: "Het", rule: "het_de" },
  { type: "choose", prompt: "___ school begint om 8 uur.", options: ["De", "Het"], answer: "De", rule: "het_de" },

  // ══════ NAAR vs IN ══════
  { type: "choose", prompt: "Ik ga ___ Spanje op vakantie.", options: ["naar", "in"], answer: "naar", rule: "naar_in", hint: "ga = beweging" },
  { type: "choose", prompt: "Ik woon ___ Almere.", options: ["in", "naar"], answer: "in", rule: "naar_in", hint: "woon = locatie" },
  { type: "choose", prompt: "Wij gaan ___ het park.", options: ["naar", "in"], answer: "naar", rule: "naar_in", hint: "gaan = beweging" },
  { type: "choose", prompt: "Hij werkt ___ een ziekenhuis.", options: ["in", "naar"], answer: "in", rule: "naar_in", hint: "werkt = locatie" },
  { type: "choose", prompt: "Ik reis morgen ___ Amsterdam.", options: ["naar", "in"], answer: "naar", rule: "naar_in", hint: "reis = beweging" },
  { type: "choose", prompt: "De kinderen spelen ___ de tuin.", options: ["in", "naar"], answer: "in", rule: "naar_in", hint: "spelen = locatie" },
  { type: "choose", prompt: "Ik ga ___ de supermarkt.", options: ["naar", "in"], answer: "naar", rule: "naar_in", hint: "ga = beweging" },
  { type: "choose", prompt: "Het kattenvoer ligt ___ het keukenkastje.", options: ["in", "naar"], answer: "in", rule: "naar_in", hint: "ligt = locatie" },
  { type: "choose", prompt: "We verhuizen ___ een andere stad.", options: ["naar", "in"], answer: "naar", rule: "naar_in", hint: "verhuizen = beweging" },
  { type: "choose", prompt: "Ik zit ___ de wachtkamer.", options: ["in", "naar"], answer: "in", rule: "naar_in", hint: "zit = locatie" },

  // ══════ SPELLING ══════
  { type: "choose", prompt: "Ik ga op ___ naar Spanje.", options: ["vakantie", "vacantie"], answer: "vakantie", rule: "spelling" },
  { type: "choose", prompt: "Ik heb ___ Nederlands geleerd.", options: ["vandaag", "vandag"], answer: "vandaag", rule: "spelling" },
  { type: "choose", prompt: "Het ___ staat in de keuken.", options: ["kattenvoer", "katenvoer"], answer: "kattenvoer", rule: "spelling" },
  { type: "choose", prompt: "Het ___ is groot.", options: ["kantoor", "kantor"], answer: "kantoor", rule: "spelling" },
  { type: "choose", prompt: "Ik werk bij een ___.", options: ["fietsenmaker", "fiestenmaker"], answer: "fietsenmaker", rule: "spelling" },
  { type: "choose", prompt: "Ik ga op ___ naar de markt.", options: ["vrijdag", "vrijdad"], answer: "vrijdag", rule: "spelling" },
  { type: "choose", prompt: "Ik woon in ___.", options: ["Nederland", "Nederlands"], answer: "Nederland", rule: "spelling", hint: "Land = Nederland, taal = Nederlands" },
  { type: "choose", prompt: "Ik heb ___ op dinsdag.", options: ["Nederlandsles", "Nederland les"], answer: "Nederlandsles", rule: "spelling" },
  { type: "choose", prompt: "Er zijn veel ___ in Amsterdam.", options: ["toeristen", "touristen"], answer: "toeristen", rule: "spelling" },
  { type: "choose", prompt: "Ik ga naar ___.", options: ["Italië", "Italie"], answer: "Italië", rule: "spelling" },
  { type: "choose", prompt: "Ik heb twee ___ om te blijven.", options: ["redenen", "reden"], answer: "redenen", rule: "spelling", hint: "meervoud" },
  { type: "choose", prompt: "Er zijn veel leuke ___.", options: ["restaurants", "restaurant"], answer: "restaurants", rule: "spelling", hint: "meervoud" },

  // ══════ HET vs IT ══════
  { type: "choose", prompt: "Ik vind ___ leuk in Nederland.", options: ["het", "it"], answer: "het", rule: "het_it" },
  { type: "choose", prompt: "___ is mooi weer vandaag.", options: ["Het", "It"], answer: "Het", rule: "het_it" },
  { type: "choose", prompt: "Ik vind ___ niet leuk.", options: ["het", "it"], answer: "het", rule: "het_it" },
  { type: "choose", prompt: "___ regent vandaag.", options: ["Het", "It"], answer: "Het", rule: "het_it" },
  { type: "choose", prompt: "Hoe gaat ___ met je?", options: ["het", "it"], answer: "het", rule: "het_it" },

  // ══════ HIJ vs ZIJN ══════
  { type: "choose", prompt: "___ is mijn goede vriend.", options: ["Hij", "Zijn"], answer: "Hij", rule: "hij_zijn", hint: "subject = hij" },
  { type: "choose", prompt: "___ huis is heel groot.", options: ["Zijn", "Hij"], answer: "Zijn", rule: "hij_zijn", hint: "bezittelijk = zijn" },
  { type: "choose", prompt: "___ werkt in het ziekenhuis.", options: ["Hij", "Zijn"], answer: "Hij", rule: "hij_zijn" },
  { type: "choose", prompt: "___ auto staat voor de deur.", options: ["Zijn", "Hij"], answer: "Zijn", rule: "hij_zijn" },
  { type: "choose", prompt: "___ moet morgen vroeg opstaan.", options: ["Hij", "Zijn"], answer: "Hij", rule: "hij_zijn" },
  { type: "choose", prompt: "___ vrouw heet Maria.", options: ["Zijn", "Hij"], answer: "Zijn", rule: "hij_zijn" },

  // ══════ IK-VORM ══════
  { type: "choose", prompt: "Ik ___ elke dag.", options: ["werk", "werkt", "werken"], answer: "werk", rule: "ik_verb" },
  { type: "choose", prompt: "Hij ___ elke dag.", options: ["werkt", "werk", "werken"], answer: "werkt", rule: "ik_verb" },
  { type: "choose", prompt: "Ik ___ de e-mail.", options: ["mail", "mailt", "mailen"], answer: "mail", rule: "ik_verb" },
  { type: "choose", prompt: "Zij ___ de e-mail.", options: ["mailt", "mail", "mailen"], answer: "mailt", rule: "ik_verb" },
  { type: "choose", prompt: "Ik ___ om 8 uur.", options: ["begin", "begint", "beginnen"], answer: "begin", rule: "ik_verb" },
  { type: "choose", prompt: "Het feest ___ om 18.00 uur.", options: ["begint", "begin", "beginnen"], answer: "begint", rule: "ik_verb" },
  { type: "choose", prompt: "Ik ___ het niet.", options: ["kan", "kun", "kunt"], answer: "kan", rule: "ik_verb", hint: "ik kan, jij kunt/kun" },
  { type: "choose", prompt: "Ik ___ in Amsterdam.", options: ["woon", "woont", "wonen"], answer: "woon", rule: "ik_verb" },
  { type: "choose", prompt: "Hij ___ in Amsterdam.", options: ["woont", "woon", "wonen"], answer: "woont", rule: "ik_verb" },

  // ══════ REGISTER ══════
  { type: "choose", prompt: "E-mail aan je manager: '___ mij vertellen wat de kosten zijn?'", options: ["Kunt u", "Kun je", "Kan jij"], answer: "Kunt u", rule: "register", hint: "manager = formeel" },
  { type: "choose", prompt: "E-mail aan je vriend: '___ morgen komen?'", options: ["Kun je", "Kunt u", "Kan u"], answer: "Kun je", rule: "register", hint: "vriend = informeel" },
  { type: "choose", prompt: "Brief aan de gemeente: 'Met vriendelijke ___'", options: ["groet", "groetjes", "hoi"], answer: "groet", rule: "register", hint: "gemeente = formeel" },
  { type: "choose", prompt: "E-mail aan je collega: '___,'", options: ["Hoi", "Geachte heer/mevrouw", "Beste meneer"], answer: "Hoi", rule: "register", hint: "collega = informeel" },
  { type: "choose", prompt: "Brief aan de politie: '___,'", options: ["Geachte heer/mevrouw", "Hoi", "Hey"], answer: "Geachte heer/mevrouw", rule: "register", hint: "politie = formeel" },
  { type: "choose", prompt: "E-mail aan je docent: '___ mij helpen?'", options: ["Kunt u", "Kun je", "Kan jij"], answer: "Kunt u", rule: "register", hint: "docent = formeel" },

  // ══════ PERFECT TENSE ══════
  { type: "reorder", prompt: "Maak een perfectum-zin:", words: ["De", "vrienden", "hebben", "mijn", "brievenbus", "kapot", "gemaakt"], answer: "De vrienden hebben mijn brievenbus kapot gemaakt", rule: "perfect" },
  { type: "reorder", prompt: "Maak een perfectum-zin:", words: ["Ik", "heb", "vandaag", "naar", "muziek", "geluisterd"], answer: "Ik heb vandaag naar muziek geluisterd", rule: "perfect" },
  { type: "reorder", prompt: "Maak een perfectum-zin:", words: ["Wij", "hebben", "gisteren", "Nederlands", "geleerd"], answer: "Wij hebben gisteren Nederlands geleerd", rule: "perfect" },
  { type: "reorder", prompt: "Maak een perfectum-zin:", words: ["Hij", "heeft", "de", "auto", "gewassen"], answer: "Hij heeft de auto gewassen", rule: "perfect" },
  { type: "reorder", prompt: "Maak een perfectum-zin:", words: ["Ik", "ben", "naar", "Spanje", "gereisd"], answer: "Ik ben naar Spanje gereisd", rule: "perfect" },
  { type: "reorder", prompt: "Maak een perfectum-zin:", words: ["Zij", "is", "gisteren", "naar", "huis", "gegaan"], answer: "Zij is gisteren naar huis gegaan", rule: "perfect" },

  // ══════ SEPARABLE VERBS ══════
  { type: "reorder", prompt: "Maak een zin (scheidbaar werkwoord):", words: ["Ik", "maak", "de", "deur", "open"], answer: "Ik maak de deur open", rule: "sep_verb" },
  { type: "reorder", prompt: "Maak een zin (scheidbaar werkwoord):", words: ["Hij", "belt", "mij", "morgen", "op"], answer: "Hij belt mij morgen op", rule: "sep_verb" },
  { type: "reorder", prompt: "Maak een zin (scheidbaar werkwoord):", words: ["Ik", "haal", "mijn", "kind", "om", "5", "uur", "op"], answer: "Ik haal mijn kind om 5 uur op", rule: "sep_verb" },
  { type: "reorder", prompt: "Maak een zin (scheidbaar werkwoord):", words: ["Zij", "nodigt", "haar", "buren", "uit"], answer: "Zij nodigt haar buren uit", rule: "sep_verb" },
  { type: "reorder", prompt: "Maak een zin (scheidbaar werkwoord):", words: ["Ik", "sta", "elke", "dag", "om", "7", "uur", "op"], answer: "Ik sta elke dag om 7 uur op", rule: "sep_verb" },

  // ══════ VAST VOORZETSEL ══════
  { type: "choose", prompt: "Ik luister ___ jazz.", options: ["naar", "op", "voor", "met"], answer: "naar", rule: "luisteren_naar" },
  { type: "choose", prompt: "Kun je ___ mijn kat zorgen?", options: ["voor", "naar", "op", "met"], answer: "voor", rule: "luisteren_naar", hint: "zorgen VOOR" },
  { type: "choose", prompt: "Ik wacht ___ de bus.", options: ["op", "naar", "voor", "bij"], answer: "op", rule: "luisteren_naar", hint: "wachten OP" },
  { type: "choose", prompt: "Ik zoek ___ mijn sleutel.", options: ["naar", "op", "voor", "in"], answer: "naar", rule: "luisteren_naar", hint: "zoeken NAAR" },
  { type: "choose", prompt: "Hij denkt ___ zijn vakantie.", options: ["aan", "op", "naar", "voor"], answer: "aan", rule: "luisteren_naar", hint: "denken AAN" },
  { type: "choose", prompt: "Ik ben benieuwd ___ het antwoord.", options: ["naar", "op", "voor", "aan"], answer: "naar", rule: "luisteren_naar", hint: "benieuwd NAAR" },

  // ══════ MIXED / EXAM-LIKE SENTENCES ══════
  { type: "fill", prompt: "Ik ___ morgen niet naar de spelletjesavond komen.", answer: "kan", wrong: ["komen", "kom", "kunt"], rule: "modal_inf", hint: "Wie? Ik. Modal = kan" },
  { type: "fill", prompt: "Ik wil deze vrijdag liever niet ___.", answer: "werken", wrong: ["werk", "werkt", "gewerkt"], rule: "modal_inf" },
  { type: "fill", prompt: "Ik ___ op woensdag mijn opdracht niet inleveren.", answer: "kan", wrong: ["inleveren", "lever", "kunt"], rule: "modal_inf" },
  { type: "choose", prompt: "Ik kan ___ niet slapen.", options: ["hierdoor", "hiervoor", "hiervan", "hierin"], answer: "hierdoor", rule: "spelling" },
  { type: "fill", prompt: "Ik ___ al drie jaar in Nederland.", answer: "woon", wrong: ["wonen", "woont", "gewoond"], rule: "conj_no_modal" },
  { type: "fill", prompt: "Het kattenvoer ___ in het keukenkastje.", answer: "ligt", wrong: ["liggen", "legt", "gelegen"], rule: "conj_no_modal" },
  { type: "fill", prompt: "Het feest ___ om 18.00 uur.", answer: "begint", wrong: ["beginnen", "begin", "begon"], rule: "conj_no_modal" },
  { type: "choose", prompt: "Mijn buren ___ mij uitgenodigd.", options: ["hebben", "zijn", "hadden", "ben"], answer: "hebben", rule: "perfect" },
  { type: "choose", prompt: "Ik ___ het leuk dat Nederland toeristisch is.", options: ["vind", "vindt", "vinden", "vond"], answer: "vind", rule: "ik_verb" },
  { type: "choose", prompt: "Kun je me vertellen waarom je wilt ___?", options: ["verhuizen", "verhuist", "verhuisd", "verhuizing"], answer: "verhuizen", rule: "modal_inf", hint: "wilt + ?" },

  // More mixed
  { type: "reorder", prompt: "Maak een correcte e-mailzin:", words: ["Ik", "kan", "morgen", "niet", "naar", "de", "spelletjesavond", "komen"], answer: "Ik kan morgen niet naar de spelletjesavond komen", rule: "modal_inf" },
  { type: "reorder", prompt: "Maak een correcte e-mailzin:", words: ["Ik", "wil", "niet", "meer", "in", "het", "weekend", "werken"], answer: "Ik wil niet meer in het weekend werken", rule: "modal_inf" },
  { type: "reorder", prompt: "Maak een correcte e-mailzin:", words: ["Ik", "kan", "op", "vrijdag", "ook", "werken"], answer: "Ik kan op vrijdag ook werken", rule: "modal_inf" },
  { type: "reorder", prompt: "Maak een correcte zin:", words: ["Je", "moet", "de", "kat", "drie", "keer", "per", "dag", "eten", "geven"], answer: "Je moet de kat drie keer per dag eten geven", rule: "modal_inf" },
  { type: "reorder", prompt: "Maak een correcte zin:", words: ["De", "buurjongen", "geeft", "elke", "week", "feesten", "met", "harde", "muziek"], answer: "De buurjongen geeft elke week feesten met harde muziek", rule: "v2" },
  { type: "choose", prompt: "Ik ___ niet meer in het weekend werken.", options: ["wil", "wilt", "willen", "wou"], answer: "wil", rule: "ik_verb" },
  { type: "choose", prompt: "Ik denk ___ je moet blijven.", options: ["dat", "want", "omdat", "als"], answer: "dat", rule: "bijzin", hint: "Ik denk + bijzin" },
  { type: "fill", prompt: "Ik zal volgende week weer naar de spelletjesavond ___.", answer: "komen", wrong: ["kom", "komt", "gekomen"], rule: "modal_inf", hint: "zal + ?" },
  { type: "choose", prompt: "Ik heb elke zaterdag ___.", options: ["Nederlandsles", "Nederlands les", "Nederland les", "Nederlandse les"], answer: "Nederlandsles", rule: "spelling" },
  { type: "choose", prompt: "Het feest is bij mij thuis ___ de Buffelstraat 20.", options: ["op", "in", "aan", "bij"], answer: "op", rule: "spelling", hint: "op + straatnaam" },
  
  // ══════ MORE MODAL + INF ══════
  { type: "fill", prompt: "Ik moet de werkplaats ___.", answer: "schoonmaken", wrong: ["schoonmaak", "schoonmaakt", "schoongemaakt"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Je moet de fietsen ___.", answer: "repareren", wrong: ["repareer", "repareert", "gerepareerd"], rule: "modal_inf", hint: "moet + ?" },
  { type: "fill", prompt: "Ik wil een feestje ___.", answer: "geven", wrong: ["geef", "geeft", "gegeven"], rule: "modal_inf", hint: "wil + ?" },
  { type: "fill", prompt: "Kun je dit weekend voor mijn kat ___?", answer: "zorgen", wrong: ["zorg", "zorgt", "gezorgd"], rule: "modal_inf", hint: "kun + ?" },
  
  // ══════ MORE CONJUGATED ══════
  { type: "fill", prompt: "Ik ___ je want ik ben volgende week jarig.", answer: "mail", wrong: ["mailen", "mailt", "gemaild"], rule: "conj_no_modal", hint: "ik + mailen = ?" },
  { type: "fill", prompt: "De sleutel ___ onder de deurmat.", answer: "ligt", wrong: ["liggen", "legt", "gelegen"], rule: "conj_no_modal", hint: "de sleutel + liggen = ?" },
  { type: "fill", prompt: "Ik ___ het leuk in Nederland.", answer: "vind", wrong: ["vinden", "vindt", "gevonden"], rule: "conj_no_modal", hint: "ik + vinden = ?" },
  { type: "fill", prompt: "Mijn vriend ___ heel aardig.", answer: "is", wrong: ["zijn", "ben", "bent"], rule: "conj_no_modal", hint: "hij + zijn = ?" },

  // ══════ EXTRA BIJZIN ══════
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["dat", "het", "feest", "bij", "mij", "thuis", "is"], answer: "dat het feest bij mij thuis is", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["omdat", "ik", "op", "vakantie", "ga"], answer: "omdat ik op vakantie ga", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["of", "je", "morgen", "kunt", "komen"], answer: "of je morgen kunt komen", rule: "bijzin" },
  { type: "reorder", prompt: "Maak de juiste bijzin:", words: ["dat", "ik", "niet", "meer", "in", "het", "weekend", "wil", "werken"], answer: "dat ik niet meer in het weekend wil werken", rule: "bijzin" },
  
  // ══════ MORE MIXED ══════
  { type: "choose", prompt: "Ik ___ graag op zaterdag werken.", options: ["kan", "kunt", "kunnen", "kon"], answer: "kan", rule: "ik_verb" },
  { type: "choose", prompt: "Mijn excuses ___.", options: ["hiervoor", "hierdoor", "hiervan", "hierin"], answer: "hiervoor", rule: "spelling" },
  { type: "choose", prompt: "Het is een ___ stad.", options: ["toeristische", "touristische", "toeristisch", "toerist"], answer: "toeristische", rule: "spelling", hint: "adjective before de-word" },
  { type: "choose", prompt: "Er zijn veel leuke ___.", options: ["restaurants", "restaurant", "restauranten", "restaurants"], answer: "restaurants", rule: "spelling" },
  { type: "fill", prompt: "Ik ___ naar mijn favoriete muziek.", answer: "luister", wrong: ["luisteren", "luistert", "geluisterd"], rule: "conj_no_modal" },
  { type: "fill", prompt: "Ik ___ vier keer per dag koffie.", answer: "drink", wrong: ["drinken", "drinkt", "gedronken"], rule: "conj_no_modal" },
];

// Shuffle helper
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── COMPONENTS ───

function RuleCard({ ruleKey, compact = false }) {
  const r = RULES[ruleKey];
  if (!r) return null;
  return (
    <div style={{
      background: `${r.color}12`,
      border: `2px solid ${r.color}`,
      borderRadius: 12,
      padding: compact ? "10px 14px" : "16px 20px",
      marginTop: 12,
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: compact ? 4 : 8 }}>
        <span style={{
          background: r.color,
          color: "#fff",
          padding: "2px 10px",
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5
        }}>{r.tag}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a2e", marginBottom: 4 }}>{r.rule}</div>
      <div style={{ fontSize: 13, color: "#444", fontFamily: "'DM Mono', monospace" }}>{r.example}</div>
      {!compact && <div style={{ fontSize: 14, marginTop: 8, color: r.color, fontWeight: 600 }}>{r.mnemonic}</div>}
    </div>
  );
}

function ProgressBar({ current, total, correct, streak }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "#666", fontFamily: "'DM Sans', sans-serif" }}>
          Vraag {current + 1} / {total}
        </span>
        <div style={{ display: "flex", gap: 16, fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
          <span style={{ color: "#00A676" }}>✓ {correct}</span>
          <span style={{ color: "#E83F6F" }}>✗ {current - correct}</span>
          {streak >= 3 && <span style={{ color: "#FF6B35" }}>🔥 {streak}</span>}
        </div>
      </div>
      <div style={{ height: 6, background: "#e8e8ee", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "linear-gradient(90deg, #FF6B35, #E83F6F)",
          borderRadius: 3,
          transition: "width 0.4s ease"
        }} />
      </div>
    </div>
  );
}

function FillQuestion({ q, onAnswer, answered, selectedAnswer }) {
  const options = shuffle([q.answer, ...q.wrong]).slice(0, 4);
  const optionsRef = useRef(shuffle([q.answer, ...q.wrong]).slice(0, 4));

  useEffect(() => {
    optionsRef.current = shuffle([q.answer, ...q.wrong]).slice(0, 4);
  }, [q]);

  const displayOptions = answered ? options : optionsRef.current;

  return (
    <div>
      <p style={{
        fontSize: 20,
        fontWeight: 600,
        color: "#1a1a2e",
        lineHeight: 1.5,
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: 6
      }}>{q.prompt}</p>
      {q.hint && !answered && (
        <p style={{ fontSize: 13, color: "#888", fontStyle: "italic", marginBottom: 16 }}>💡 {q.hint}</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        {displayOptions.map((opt, i) => {
          let bg = "#f5f5fa";
          let border = "2px solid #e0e0e8";
          let color = "#1a1a2e";
          if (answered) {
            if (opt === q.answer) { bg = "#00A67615"; border = "2px solid #00A676"; color = "#00A676"; }
            else if (opt === selectedAnswer) { bg = "#E83F6F15"; border = "2px solid #E83F6F"; color = "#E83F6F"; }
          }
          return (
            <button key={i} onClick={() => !answered && onAnswer(opt)} style={{
              padding: "14px 16px",
              borderRadius: 10,
              border,
              background: bg,
              color,
              fontSize: 17,
              fontWeight: 600,
              cursor: answered ? "default" : "pointer",
              fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.15s ease"
            }}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChooseQuestion({ q, onAnswer, answered, selectedAnswer }) {
  return (
    <div>
      <p style={{
        fontSize: 20,
        fontWeight: 600,
        color: "#1a1a2e",
        lineHeight: 1.5,
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: 6
      }}>{q.prompt}</p>
      {q.hint && !answered && (
        <p style={{ fontSize: 13, color: "#888", fontStyle: "italic", marginBottom: 16 }}>💡 {q.hint}</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: q.options.length <= 2 ? "1fr 1fr" : "1fr 1fr", gap: 10, marginTop: 16 }}>
        {q.options.map((opt, i) => {
          let bg = "#f5f5fa";
          let border = "2px solid #e0e0e8";
          let color = "#1a1a2e";
          if (answered) {
            if (opt === q.answer) { bg = "#00A67615"; border = "2px solid #00A676"; color = "#00A676"; }
            else if (opt === selectedAnswer) { bg = "#E83F6F15"; border = "2px solid #E83F6F"; color = "#E83F6F"; }
          }
          return (
            <button key={i} onClick={() => !answered && onAnswer(opt)} style={{
              padding: "14px 16px",
              borderRadius: 10,
              border,
              background: bg,
              color,
              fontSize: 17,
              fontWeight: 600,
              cursor: answered ? "default" : "pointer",
              fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.15s ease"
            }}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReorderQuestion({ q, onAnswer, answered, selectedAnswer }) {
  const [selected, setSelected] = useState([]);
  const [remaining, setRemaining] = useState(shuffle(q.words));

  useEffect(() => {
    setSelected([]);
    setRemaining(shuffle(q.words));
  }, [q]);

  const handleWordClick = (word, idx) => {
    if (answered) return;
    const newSelected = [...selected, word];
    const newRemaining = [...remaining];
    newRemaining.splice(idx, 1);
    setSelected(newSelected);
    setRemaining(newRemaining);
    if (newRemaining.length === 0) {
      onAnswer(newSelected.join(" "));
    }
  };

  const handleSelectedClick = (word, idx) => {
    if (answered) return;
    const newSelected = [...selected];
    newSelected.splice(idx, 1);
    setSelected(newSelected);
    setRemaining([...remaining, word]);
  };

  const isCorrect = answered && selectedAnswer === q.answer;

  return (
    <div>
      <p style={{
        fontSize: 18,
        fontWeight: 600,
        color: "#1a1a2e",
        lineHeight: 1.5,
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: 16
      }}>{q.prompt}</p>

      {/* Answer area */}
      <div style={{
        minHeight: 52,
        padding: "10px 14px",
        borderRadius: 10,
        border: answered ? (isCorrect ? "2px solid #00A676" : "2px solid #E83F6F") : "2px dashed #ccc",
        background: answered ? (isCorrect ? "#00A67610" : "#E83F6F10") : "#fafafa",
        marginBottom: 16,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center"
      }}>
        {selected.length === 0 && !answered && (
          <span style={{ color: "#aaa", fontSize: 14 }}>Tik op de woorden hieronder...</span>
        )}
        {selected.map((w, i) => (
          <span key={i} onClick={() => handleSelectedClick(w, i)} style={{
            padding: "6px 14px",
            borderRadius: 8,
            background: answered ? "transparent" : "#2D82B720",
            border: "1px solid #2D82B7",
            color: "#2D82B7",
            fontSize: 16,
            fontWeight: 600,
            cursor: answered ? "default" : "pointer",
            fontFamily: "'DM Sans', sans-serif"
          }}>{w}</span>
        ))}
      </div>

      {/* Show correct answer if wrong */}
      {answered && !isCorrect && (
        <div style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "2px solid #00A676",
          background: "#00A67610",
          marginBottom: 12,
          fontSize: 16,
          fontWeight: 600,
          color: "#00A676",
          fontFamily: "'DM Sans', sans-serif"
        }}>
          ✓ {q.answer}
        </div>
      )}

      {/* Remaining words */}
      {!answered && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {remaining.map((w, i) => (
            <button key={i} onClick={() => handleWordClick(w, i)} style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: "2px solid #e0e0e8",
              background: "#f5f5fa",
              color: "#1a1a2e",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif"
            }}>{w}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CATEGORY SELECT SCREEN ───
function CategorySelect({ onStart }) {
  const [mode, setMode] = useState("all");
  const categories = [
    { key: "all", label: "🎯 Alles (220+ vragen)", desc: "Alle categorieën gemixed" },
    { key: "modal_inf", label: "🧲 Modal + Infinitief", desc: "kan/wil/moet + werken" },
    { key: "conj_no_modal", label: "✏️ Vervoegen zonder modal", desc: "ik werk, ik eet, ik loop" },
    { key: "bijzin", label: "🔀 Bijzin woordvolgorde", desc: "omdat ik ziek ben" },
    { key: "v2", label: "📌 V2 woordvolgorde", desc: "Morgen ga ik..." },
    { key: "het_de", label: "🏷️ Het / De", desc: "het feest, de kat" },
    { key: "naar_in", label: "➡️ Naar vs In", desc: "naar = beweging, in = locatie" },
    { key: "spelling", label: "📝 Spelling", desc: "vakantie, vandaag, toeristen" },
    { key: "ik_verb", label: "👤 Ik-vorm (geen -t!)", desc: "ik werk, hij werkt" },
    { key: "register", label: "🎩 Formeel vs Informeel", desc: "u/kunt vs je/kun" },
    { key: "perfect", label: "⏮️ Perfectum", desc: "hebben/zijn + voltooid deelwoord" },
    { key: "weak", label: "🔴 Alleen mijn fouten", desc: "Herhaal wat je fout had" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(150deg, #0d1117 0%, #1a1a2e 50%, #16213e 100%)",
      padding: "24px 16px",
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{
            fontSize: 32,
            fontWeight: 800,
            color: "#fff",
            marginBottom: 4
          }}>🇳🇱 Schrijven Drill</h1>
          <p style={{ color: "#888", fontSize: 14 }}>48 uur tot het examen — laten we oefenen!</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {categories.map(cat => {
            const isActive = mode === cat.key;
            const count = cat.key === "all" ? QUESTIONS.length :
              cat.key === "weak" ? "?" :
              QUESTIONS.filter(q => q.rule === cat.key).length;
            return (
              <button key={cat.key} onClick={() => setMode(cat.key)} style={{
                padding: "14px 18px",
                borderRadius: 12,
                border: isActive ? "2px solid #FF6B35" : "2px solid #2a2a3e",
                background: isActive ? "#FF6B3518" : "#1a1a2e",
                color: isActive ? "#FF6B35" : "#ccc",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.15s ease"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{cat.label}</span>
                  <span style={{ fontSize: 12, color: "#666" }}>{count} vragen</span>
                </div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>{cat.desc}</div>
              </button>
            );
          })}
        </div>

        <button onClick={() => onStart(mode)} style={{
          width: "100%",
          padding: "16px",
          marginTop: 24,
          borderRadius: 12,
          border: "none",
          background: "linear-gradient(135deg, #FF6B35, #E83F6F)",
          color: "#fff",
          fontSize: 18,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif"
        }}>
          Start! 🚀
        </button>
      </div>
    </div>
  );
}

// ─── RESULTS SCREEN ───
function Results({ correct, total, mistakes, onRestart, onPracticeMistakes }) {
  const pct = Math.round((correct / total) * 100);
  const grade = pct >= 90 ? "🌟 Uitstekend!" : pct >= 75 ? "👍 Goed!" : pct >= 60 ? "📈 Voldoende" : "💪 Meer oefenen!";

  // Group mistakes by rule
  const byRule = {};
  mistakes.forEach(m => {
    if (!byRule[m.rule]) byRule[m.rule] = 0;
    byRule[m.rule]++;
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(150deg, #0d1117 0%, #1a1a2e 50%, #16213e 100%)",
      padding: "24px 16px",
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 500, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>{pct >= 75 ? "🎉" : "📚"}</div>
        <h1 style={{ color: "#fff", fontSize: 28, fontWeight: 800, marginBottom: 4 }}>{grade}</h1>
        <p style={{ color: "#aaa", fontSize: 18, marginBottom: 24 }}>
          {correct} / {total} goed ({pct}%)
        </p>

        {Object.keys(byRule).length > 0 && (
          <div style={{ textAlign: "left", marginBottom: 24 }}>
            <h3 style={{ color: "#FF6B35", fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
              ⚠️ Zwakke punten:
            </h3>
            {Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([key, count]) => (
              <div key={key} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 14px",
                borderRadius: 8,
                background: "#1a1a2e",
                border: `1px solid ${RULES[key]?.color || "#444"}`,
                marginBottom: 6
              }}>
                <span style={{ color: RULES[key]?.color || "#fff", fontSize: 14, fontWeight: 600 }}>
                  {RULES[key]?.tag || key}
                </span>
                <span style={{ color: "#E83F6F", fontSize: 14, fontWeight: 700 }}>{count}×</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mistakes.length > 0 && (
            <button onClick={onPracticeMistakes} style={{
              padding: "14px",
              borderRadius: 12,
              border: "2px solid #E83F6F",
              background: "#E83F6F18",
              color: "#E83F6F",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif"
            }}>
              🔴 Oefen mijn fouten ({mistakes.length} vragen)
            </button>
          )}
          <button onClick={onRestart} style={{
            padding: "14px",
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(135deg, #FF6B35, #E83F6F)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif"
          }}>
            🔄 Opnieuw beginnen
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ───
export default function App() {
  const [screen, setScreen] = useState("menu");
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [mistakes, setMistakes] = useState([]);
  const [lastMistakes, setLastMistakes] = useState([]);

  const startGame = useCallback((mode) => {
    let qs;
    if (mode === "all") {
      qs = shuffle(QUESTIONS);
    } else if (mode === "weak") {
      if (lastMistakes.length === 0) {
        qs = shuffle(QUESTIONS).slice(0, 30);
      } else {
        qs = shuffle(lastMistakes);
      }
    } else {
      qs = shuffle(QUESTIONS.filter(q => q.rule === mode));
    }
    setQuestions(qs);
    setCurrentIdx(0);
    setCorrect(0);
    setStreak(0);
    setAnswered(false);
    setSelectedAnswer(null);
    setMistakes([]);
    setScreen("play");
  }, [lastMistakes]);

  const handleAnswer = useCallback((answer) => {
    if (answered) return;
    const q = questions[currentIdx];
    const isCorrect = answer.trim().toLowerCase() === q.answer.trim().toLowerCase();
    setAnswered(true);
    setSelectedAnswer(answer);
    if (isCorrect) {
      setCorrect(c => c + 1);
      setStreak(s => s + 1);
    } else {
      setStreak(0);
      setMistakes(m => [...m, q]);
    }
  }, [answered, questions, currentIdx]);

  const nextQuestion = useCallback(() => {
    if (currentIdx + 1 >= questions.length) {
      setLastMistakes(mistakes);
      setScreen("results");
    } else {
      setCurrentIdx(i => i + 1);
      setAnswered(false);
      setSelectedAnswer(null);
    }
  }, [currentIdx, questions.length, mistakes]);

  const practiceMistakes = useCallback(() => {
    const qs = shuffle(mistakes);
    setQuestions(qs);
    setCurrentIdx(0);
    setCorrect(0);
    setStreak(0);
    setAnswered(false);
    setSelectedAnswer(null);
    setLastMistakes(mistakes);
    setMistakes([]);
    setScreen("play");
  }, [mistakes]);

  if (screen === "menu") {
    return <CategorySelect onStart={startGame} />;
  }

  if (screen === "results") {
    return (
      <Results
        correct={correct}
        total={questions.length}
        mistakes={lastMistakes.length > 0 ? lastMistakes : mistakes}
        onRestart={() => setScreen("menu")}
        onPracticeMistakes={practiceMistakes}
      />
    );
  }

  const q = questions[currentIdx];
  if (!q) return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#fafafa",
      padding: "20px 16px",
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        <ProgressBar current={currentIdx} total={questions.length} correct={correct} streak={streak} />

        {/* Question type badge */}
        <div style={{ marginBottom: 12 }}>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#888",
            background: "#e8e8ee",
            padding: "3px 10px",
            borderRadius: 20,
            letterSpacing: 0.5,
            textTransform: "uppercase"
          }}>
            {q.type === "fill" ? "Vul in" : q.type === "choose" ? "Kies het juiste antwoord" : "Zet in de juiste volgorde"}
          </span>
        </div>

        {/* Question */}
        <div style={{
          background: "#fff",
          borderRadius: 16,
          padding: "24px 20px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)"
        }}>
          {q.type === "fill" && (
            <FillQuestion q={q} onAnswer={handleAnswer} answered={answered} selectedAnswer={selectedAnswer} />
          )}
          {q.type === "choose" && (
            <ChooseQuestion q={q} onAnswer={handleAnswer} answered={answered} selectedAnswer={selectedAnswer} />
          )}
          {q.type === "reorder" && (
            <ReorderQuestion q={q} onAnswer={handleAnswer} answered={answered} selectedAnswer={selectedAnswer} />
          )}
        </div>

        {/* Rule card on wrong answer */}
        {answered && selectedAnswer !== q.answer && (
          <RuleCard ruleKey={q.rule} />
        )}

        {/* Streak celebration */}
        {answered && selectedAnswer === q.answer && streak >= 3 && (
          <div style={{
            textAlign: "center",
            marginTop: 12,
            fontSize: 14,
            color: "#FF6B35",
            fontWeight: 700
          }}>
            🔥 {streak} op een rij!
          </div>
        )}

        {/* Next button */}
        {answered && (
          <button onClick={nextQuestion} style={{
            width: "100%",
            padding: "14px",
            marginTop: 16,
            borderRadius: 12,
            border: "none",
            background: selectedAnswer === q.answer
              ? "linear-gradient(135deg, #00A676, #2D82B7)"
              : "linear-gradient(135deg, #E83F6F, #FF6B35)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif"
          }}>
            {currentIdx + 1 >= questions.length ? "Bekijk resultaten →" : "Volgende vraag →"}
          </button>
        )}

        {/* Back to menu */}
        <button onClick={() => setScreen("menu")} style={{
          width: "100%",
          padding: "10px",
          marginTop: 8,
          borderRadius: 10,
          border: "none",
          background: "transparent",
          color: "#888",
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif"
        }}>
          ← Terug naar menu
        </button>
      </div>
    </div>
  );
}
