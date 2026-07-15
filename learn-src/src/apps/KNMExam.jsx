import { useState, useEffect, useCallback } from "react";

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 600);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

const allQuestions = [
  // ── GEZONDHEID ──────────────────────────────────────────────────────────────
  { id: 1, theme: "🏥 Gezondheid", question: "U bent ziek. Wat doet u als eerste?", options: ["U gaat direct naar het ziekenhuis.", "U belt de huisarts voor een afspraak.", "U belt 112.", "U gaat naar de apotheek."], answer: 1, explanation: "In Nederland gaat u altijd eerst naar de huisarts (GP). Alleen de huisarts kan u doorverwijzen naar het ziekenhuis." },
  { id: 2, theme: "🏥 Gezondheid", question: "Het is avond en u bent heel ziek. Uw huisarts is dicht. Wat doet u?", options: ["U belt 112.", "U gaat direct naar de Eerste Hulp van het ziekenhuis.", "U belt de huisartsenpost.", "U wacht tot de volgende dag."], answer: 2, explanation: "De huisartsenpost is er voor urgente maar niet levensbedreigende situaties buiten kantooruren. Bel eerst voordat u erheen gaat." },
  { id: 3, theme: "🏥 Gezondheid", question: "Er is een levensgevaarlijke noodsituatie. Welk nummer belt u?", options: ["0800-0900", "112", "144", "113"], answer: 1, explanation: "112 is het Europese alarmnummer voor levensgevaarlijke noodsituaties: brandweer, politie en ambulance." },
  { id: 4, theme: "🏥 Gezondheid", question: "Wat is het eigen risico?", options: ["Het bedrag dat de verzekering elke maand betaalt.", "Het bedrag dat u zelf betaalt voordat de zorgverzekering meebetaalt.", "Een korting op uw zorgverzekering.", "Een extra verzekering voor tandarts."], answer: 1, explanation: "Het eigen risico is het bedrag (€385 per jaar in 2025) dat u zelf eerst betaalt. Daarna betaalt de zorgverzekering mee." },
  { id: 5, theme: "🏥 Gezondheid", question: "Is het verplicht om een zorgverzekering te hebben in Nederland?", options: ["Nee, het is niet verplicht.", "Ja, voor iedereen die in Nederland woont.", "Alleen voor mensen met een baan.", "Alleen voor mensen ouder dan 18 jaar."], answer: 1, explanation: "Iedereen die in Nederland woont, is verplicht een basisverzekering (zorgverzekering) af te sluiten." },
  { id: 6, theme: "🏥 Gezondheid", question: "Wat doet de GGD?", options: ["De GGD geeft leningen aan mensen zonder werk.", "De GGD regelt huurtoeslagen.", "De GGD zorgt voor de volksgezondheid, zoals vaccinaties en infectieziekten.", "De GGD helpt bij problemen met uw verhuurder."], answer: 2, explanation: "GGD staat voor Gemeentelijke Gezondheidsdienst. Zij houden zich bezig met volksgezondheid: vaccinaties, besmettelijke ziekten, en jeugdgezondheidszorg." },
  { id: 7, theme: "🏥 Gezondheid", question: "Wat is de GGZ?", options: ["De GGZ is de Gemeentelijke Gezinscentrale (hulp bij opvoeding).", "De GGZ is Geestelijke Gezondheidszorg – voor psychologische hulp.", "De GGZ is een instelling voor ouderenzorg.", "De GGZ is een instantie voor arbeidsongeschiktheid."], answer: 1, explanation: "GGZ staat voor Geestelijke Gezondheidszorg. Hier kunt u terecht voor psychische problemen, zoals depressie of angst. U heeft een verwijzing van de huisarts nodig." },
  { id: 8, theme: "🏥 Gezondheid", question: "Wat is een POH bij de huisarts?", options: ["Een politieagent die op de huisartsenpraktijk werkt.", "Een praktijkondersteuner die de huisarts helpt bij bepaalde patiëntengroepen.", "Een arts die gespecialiseerd is in kinderen.", "Een medewerker van de apotheek."], answer: 1, explanation: "POH staat voor Praktijkondersteuner Huisarts. Zij helpen patiënten met chronische ziekten zoals diabetes of psychische klachten." },
  { id: 9, theme: "🏥 Gezondheid", question: "U spreekt geen Nederlands goed. Heeft u recht op een tolk bij de dokter?", options: ["Nee, u moet altijd zelf een tolk meenemen.", "Ja, u kunt een tolk aanvragen via uw zorgverlener.", "Alleen als u asielzoeker bent.", "Nee, dit is niet mogelijk in Nederland."], answer: 1, explanation: "In Nederland heeft u het recht om gebruik te maken van een tolk bij een zorgverlener, zodat u de juiste zorg ontvangt." },
  { id: 10, theme: "🏥 Gezondheid", question: "Wat doet de apotheek?", options: ["De apotheek geeft medische adviezen en schrijft medicijnen voor.", "De apotheek verstrekt medicijnen op recept van de dokter.", "De apotheek doet bloedonderzoek.", "De apotheek is hetzelfde als de huisarts."], answer: 1, explanation: "De apotheek verstrekt medicijnen. Voor de meeste medicijnen heeft u een recept (voorschrift) van de huisarts nodig." },
  { id: 11, theme: "🏥 Gezondheid", question: "Uw buurman heeft hevige pijn op de borst. Wat doet u?", options: ["U brengt hem naar de huisartsenpost.", "U belt 112 want dit kan gevaarlijk zijn.", "U belt de huisarts voor een afspraak morgen.", "U geeft hem een pijnstiller."], answer: 1, explanation: "Pijn op de borst kan een hartaanval zijn – een levensbedreigende situatie. U belt onmiddellijk 112." },
  { id: 12, theme: "🏥 Gezondheid", question: "Wat betaalt u elke maand aan uw zorgverzekering?", options: ["Het eigen risico.", "De premie.", "De bijdrage.", "De toeslag."], answer: 1, explanation: "De premie is het bedrag dat u elke maand aan uw zorgverzekeraar betaalt. Het eigen risico betaalt u alleen als u zorg gebruikt." },

  // ── ONDERWIJS & OPVOEDING ───────────────────────────────────────────────────
  { id: 13, theme: "🎓 Onderwijs", question: "Vanaf welke leeftijd is school verplicht in Nederland?", options: ["4 jaar", "5 jaar", "6 jaar", "7 jaar"], answer: 1, explanation: "Kinderen mogen al naar school vanaf 4 jaar, maar de leerplicht begint officieel op 5-jarige leeftijd." },
  { id: 14, theme: "🎓 Onderwijs", question: "Tot welke leeftijd geldt de leerplicht in Nederland?", options: ["16 jaar", "17 jaar", "18 jaar of totdat u een startkwalificatie heeft", "21 jaar"], answer: 2, explanation: "De leerplicht geldt tot 16 jaar. Daarna geldt de kwalificatieplicht: u moet doorleren tot u 18 bent of een diploma op MBO niveau 2 heeft (startkwalificatie)." },
  { id: 15, theme: "🎓 Onderwijs", question: "Julia heeft haar HAVO-diploma gehaald. Welke opleiding kan zij nu volgen?", options: ["VWO", "Universiteit (WO)", "HBO (hoger beroepsonderwijs)", "Alleen MBO"], answer: 2, explanation: "Met een HAVO-diploma mag u naar het HBO (hoger beroepsonderwijs), zoals een hogeschool. Voor een universiteit heeft u VWO nodig." },
  { id: 16, theme: "🎓 Onderwijs", question: "Ahmed heeft zijn VWO-diploma. Wat kan hij doen?", options: ["Alleen HBO", "HBO of universiteit (WO)", "Alleen MBO", "Alleen VMBO"], answer: 1, explanation: "Met een VWO-diploma heeft u toegang tot zowel HBO als een universiteit (WO – wetenschappelijk onderwijs)." },
  { id: 17, theme: "🎓 Onderwijs", question: "Wat is de volgorde van het Nederlandse onderwijs (van laag naar hoog)?", options: ["Basisschool → VWO → MBO → HBO → Universiteit", "Basisschool → VMBO/HAVO/VWO → MBO/HBO → Universiteit", "Kleuterschool → VMBO → HBO → Universiteit", "Basisschool → MBO → HAVO → Universiteit"], answer: 1, explanation: "De juiste volgorde is: Basisschool (8 jaar) → Middelbare school (VMBO, HAVO of VWO) → MBO of HBO → Universiteit." },
  { id: 18, theme: "🎓 Onderwijs", question: "Wie betaalt de schoolboeken op de middelbare school?", options: ["De ouders betalen de boeken.", "De school geeft de boeken gratis.", "De leerling betaalt zelf.", "De gemeente betaalt de boeken."], answer: 1, explanation: "Op de middelbare school krijgen leerlingen hun schoolboeken gratis van de school. Dit is vastgelegd in de wet." },
  { id: 19, theme: "🎓 Onderwijs", question: "Wat is kinderopvangtoeslag?", options: ["Gratis kinderopvang voor alle kinderen.", "Een financiële bijdrage van de overheid voor de kosten van kinderopvang.", "Een uitkering voor ouders die niet werken.", "Geld van de gemeente voor schoolreisjes."], answer: 1, explanation: "Kinderopvangtoeslag is een subsidie van de Belastingdienst die werkende ouders helpt om de kosten van kinderopvang te betalen." },
  { id: 20, theme: "🎓 Onderwijs", question: "Wat is kwalificatieplicht?", options: ["De verplichting om te stemmen bij verkiezingen.", "De verplichting om door te leren tot u 18 jaar bent of een startkwalificatie heeft.", "De verplichting om Nederlands te leren.", "De verplichting om een baan te hebben."], answer: 1, explanation: "De kwalificatieplicht geldt van 16 tot 18 jaar. U moet doorgaan met leren totdat u een startkwalificatie heeft: een diploma op minimaal MBO niveau 2." },
  { id: 21, theme: "🎓 Onderwijs", question: "Wat is MBO?", options: ["Middelbaar beroepsonderwijs – een opleiding na de middelbare school.", "Middelbare school voor basisonderwijs.", "Een universiteit voor techniek.", "Een soort gymnasium."], answer: 0, explanation: "MBO staat voor Middelbaar Beroepsonderwijs. Dit is een praktijkgerichte opleiding na VMBO of de basisschool, op niveau 1 t/m 4." },
  { id: 22, theme: "🎓 Onderwijs", question: "Uw kind is 7 jaar en gaat niet naar school. Wat kan er gebeuren?", options: ["Niets, het is de keuze van de ouders.", "U kunt een boete krijgen omdat de leerplicht geldt.", "Het kind wordt naar een internaat gestuurd.", "U moet dit melden bij de gemeente, maar er zijn geen gevolgen."], answer: 1, explanation: "De leerplicht is verplicht. Als een kind niet naar school gaat, kan de leerplichtambtenaar een boete geven aan de ouders." },

  // ── WERK & INKOMEN ──────────────────────────────────────────────────────────
  { id: 23, theme: "💼 Werk & Inkomen", question: "U verliest uw baan. Waar meldt u zich aan?", options: ["Bij de gemeente voor bijstand.", "Bij het UWV voor een WW-uitkering.", "Bij de Belastingdienst.", "Bij de SVB."], answer: 1, explanation: "Als u uw baan verliest, meldt u zich bij het UWV. Zij beoordelen of u recht heeft op een WW-uitkering (werkloosheidsuitkering)." },
  { id: 24, theme: "💼 Werk & Inkomen", question: "Wat is de WW-uitkering?", options: ["Een uitkering voor mensen die nooit hebben gewerkt.", "Een tijdelijke uitkering voor mensen die hun baan zijn kwijtgeraakt.", "Een uitkering voor ziekte.", "Een uitkering voor gepensioneerden."], answer: 1, explanation: "WW staat voor Werkloosheidswet. U ontvangt een WW-uitkering als u uw baan verliest en u voldoende heeft gewerkt in de afgelopen jaren." },
  { id: 25, theme: "💼 Werk & Inkomen", question: "Wat is bijstand?", options: ["Geld van uw werkgever als u ziek bent.", "Een uitkering van de gemeente als u geen andere inkomsten heeft.", "Geld van de Belastingdienst.", "Een lening van de bank."], answer: 1, explanation: "Bijstand (ook wel Participatiewet) is een uitkering van de gemeente voor mensen die geen inkomen hebben en niet in aanmerking komen voor andere uitkeringen." },
  { id: 26, theme: "💼 Werk & Inkomen", question: "Wat is vakantiegeld?", options: ["Extra vrije dagen bovenop uw normale vakantie.", "8% van uw jaarsalaris dat u extra ontvangt, meestal in mei.", "Geld dat u spaart voor uw vakantie.", "Een korting op vliegtickets voor werknemers."], answer: 1, explanation: "Vakantiegeld (vakantietoeslag) is wettelijk verplicht: 8% van uw jaarsalaris, in de meeste gevallen uitbetaald in mei." },
  { id: 27, theme: "💼 Werk & Inkomen", question: "Uw baas weigert u aan te nemen omdat u uit een ander land komt. Wat kunt u doen?", options: ["Niets, de baas mag zelf beslissen.", "U gaat naar het Anti-Discriminatie Bureau of het Juridisch Loket.", "U belt de politie.", "U schrijft een brief aan de Belastingdienst."], answer: 1, explanation: "Discriminatie op het werk is verboden in Nederland. U kunt een klacht indienen bij het Anti-Discriminatie Bureau of gratis advies vragen bij het Juridisch Loket." },
  { id: 28, theme: "💼 Werk & Inkomen", question: "Wat is een tijdelijk contract?", options: ["Een contract voor onbepaalde tijd.", "Een contract dat stopt op een bepaalde datum.", "Een contract voor parttime werk.", "Een contract zonder salaris."], answer: 1, explanation: "Een tijdelijk contract (arbeidsovereenkomst voor bepaalde tijd) eindigt automatisch op een afgesproken datum of na afronding van een project." },
  { id: 29, theme: "💼 Werk & Inkomen", question: "Wat is een vast contract?", options: ["Een contract voor een specifiek project.", "Een contract voor onbepaalde tijd, dat niet zomaar eindigt.", "Een contract waarbij u altijd op hetzelfde tijdstip werkt.", "Een contract via een uitzendbureau."], answer: 1, explanation: "Een vast contract (arbeidsovereenkomst voor onbepaalde tijd) geeft meer zekerheid: uw werkgever kan het contract niet zomaar beëindigen." },
  { id: 30, theme: "💼 Werk & Inkomen", question: "Wat is de WIA?", options: ["Een uitkering voor mensen die tijdelijk ziek zijn.", "Een uitkering voor mensen die langdurig arbeidsongeschikt zijn door ziekte of een ongeluk.", "Een uitkering voor werklozen.", "Geld voor mensen die met pensioen gaan."], answer: 1, explanation: "WIA staat voor Wet werk en inkomen naar arbeidsvermogen. U heeft hier recht op als u langer dan 2 jaar arbeidsongeschikt bent." },
  { id: 31, theme: "💼 Werk & Inkomen", question: "Wat is de Belastingdienst?", options: ["Een bank waar u geld kunt lenen.", "De overheidsinstantie die belastingen int en toeslagen uitbetaalt.", "Een verzekeringsbedrijf.", "Een instantie die werk zoekt voor werklozen."], answer: 1, explanation: "De Belastingdienst int belastingen en regelt toeslagen (zoals huurtoeslag, zorgtoeslag en kinderopvangtoeslag)." },
  { id: 32, theme: "💼 Werk & Inkomen", question: "Wat is huurtoeslag?", options: ["Een gratis woning van de gemeente.", "Financiële steun van de overheid voor mensen met een laag inkomen die huur betalen.", "Een korting bij de supermarkt.", "Geld van uw verhuurder als de huur te hoog is."], answer: 1, explanation: "Huurtoeslag is een maandelijkse bijdrage van de Belastingdienst voor mensen met een laag inkomen die een woning huren." },
  { id: 33, theme: "💼 Werk & Inkomen", question: "Wat is de Ziektewet?", options: ["Een wet die zegt dat u niet hoeft te werken als u ziek bent, zonder doorbetaling.", "Een uitkering voor mensen die ziek zijn en geen werkgever hebben die doorbetaalt.", "Een wet over ziektekostenverzekering.", "Een wet die de GGD regelt."], answer: 1, explanation: "De Ziektewet regelt inkomen voor mensen die ziek zijn maar geen recht hebben op doorbetaling van loon, zoals flexwerkers of mensen tussen twee banen." },
  { id: 34, theme: "💼 Werk & Inkomen", question: "U werkt in loondienst. Heeft u recht op vakantiedagen?", options: ["Nee, dit hangt af van uw werkgever.", "Ja, minimaal 4 keer het aantal uren dat u per week werkt.", "Ja, altijd 25 dagen per jaar.", "Nee, alleen als het in uw contract staat."], answer: 1, explanation: "In Nederland heeft u wettelijk recht op minimaal 4 keer het aantal werkuren per week aan vakantiedagen per jaar (bijv. fulltime = minimaal 20 dagen)." },

  // ── WONEN ──────────────────────────────────────────────────────────────────
  { id: 35, theme: "🏠 Wonen", question: "U verhuist naar een nieuw adres. Wat moet u doen?", options: ["Niets, de gemeente weet het automatisch.", "U schrijft zich in bij de gemeente op uw nieuwe adres.", "U belt de Belastingdienst.", "U stuurt een brief naar uw verhuurder."], answer: 1, explanation: "U bent verplicht om u binnen 5 dagen na de verhuizing in te schrijven bij de gemeente (BRP – Basisregistratie Personen)." },
  { id: 36, theme: "🏠 Wonen", question: "Wie is verantwoordelijk voor grote reparaties in een huurwoning?", options: ["De huurder.", "De verhuurder (eigenaar van de woning).", "De gemeente.", "De woningcorporatie, maar alleen voor sociale huurwoningen."], answer: 1, explanation: "De verhuurder is verantwoordelijk voor groot onderhoud en reparaties. De huurder is verantwoordelijk voor kleine reparaties (bijv. een kapotte lamp vervangen)." },
  { id: 37, theme: "🏠 Wonen", question: "U heeft ruzie met uw verhuurder over de huur of een reparatie. Waar kunt u naartoe?", options: ["De politie.", "De Huurcommissie.", "Het UWV.", "De Belastingdienst."], answer: 1, explanation: "De Huurcommissie is een onafhankelijke instantie die geschillen tussen huurders en verhuurders oplost, bijvoorbeeld over de hoogte van de huur of achterstallig onderhoud." },
  { id: 38, theme: "🏠 Wonen", question: "Wat is een sociale huurwoning?", options: ["Een woning die u koopt met steun van de gemeente.", "Een huurwoning met een lage huurprijs, bedoeld voor mensen met een laag inkomen.", "Een woning in een nieuwbouwwijk.", "Een woning die de gemeente aan u verhuurt."], answer: 1, explanation: "Sociale huurwoningen hebben een maximale huurprijs en worden verdeeld via een wachtlijst. Ze zijn bedoeld voor mensen met een laag inkomen." },
  { id: 39, theme: "🏠 Wonen", question: "Wat is het kadaster?", options: ["Een register van alle inwoners van Nederland.", "Een officieel register van wie eigenaar is van welk stuk grond of gebouw.", "Een lijst van huurprijzen.", "Een instantie die helpt bij het kopen van een woning."], answer: 1, explanation: "Het kadaster registreert wie eigenaar is van grond en gebouwen in Nederland. U kunt hier ook controleren of er een hypotheek op een woning rust." },
  { id: 40, theme: "🏠 Wonen", question: "Wat is een vast energiecontract?", options: ["Een contract waarbij de energieprijs elke maand verandert.", "Een contract waarbij de energieprijs voor een vaste periode gelijk blijft.", "Een contract voor onbeperkt energieverbruik.", "Een contract waarbij u altijd de laagste prijs betaalt."], answer: 1, explanation: "Met een vast energiecontract betaalt u een vaste prijs per kWh of m³ gas voor een afgesproken periode (bijv. 1 of 3 jaar), ongeacht schommelingen in de energiemarkt." },
  { id: 41, theme: "🏠 Wonen", question: "Wat is een VvE?", options: ["Vrijheid van Eigendomsrecht – een wettelijk begrip.", "Vereniging van Eigenaren – een organisatie van bewoners van een appartementengebouw.", "Veiligheid voor Erfpacht – een soort garantie bij kopen.", "Vrije verkoop Eengezinswoning."], answer: 1, explanation: "Een VvE (Vereniging van Eigenaren) beheert gezamenlijke zaken van een appartementencomplex, zoals het onderhoud van het dak of de lift." },
  { id: 42, theme: "🏠 Wonen", question: "Wat doet u als u wil weten wie de eigenaar is van een woning?", options: ["U belt de gemeente.", "U kijkt in het kadaster.", "U vraagt het aan de buren.", "U belt de Belastingdienst."], answer: 1, explanation: "In het kadaster staat geregistreerd wie eigenaar is van elk gebouw of stuk grond in Nederland." },

  // ── STAATSINRICHTING & OVERHEID ─────────────────────────────────────────────
  { id: 43, theme: "🏛️ Overheid", question: "Wat is de Tweede Kamer?", options: ["Het parlement van Europa.", "De 150 gekozen volksvertegenwoordigers in het Nederlandse parlement.", "De rechtbank die wetten beoordeelt.", "De raad van ministers."], answer: 1, explanation: "De Tweede Kamer bestaat uit 150 gekozen leden die wetten maken en de regering controleren. De verkiezingen zijn eens in de 4 jaar." },
  { id: 44, theme: "🏛️ Overheid", question: "Wat is de Eerste Kamer?", options: ["De kamer die rechtstreeks door burgers wordt gekozen.", "De senaat die wetten van de Tweede Kamer beoordeelt.", "De kamer van koophandel.", "Het kabinet van ministers."], answer: 1, explanation: "De Eerste Kamer (senaat) bestaat uit 75 leden die niet rechtstreeks worden gekozen door burgers, maar door provinciale staten. Zij controleren of wetten correct zijn." },
  { id: 45, theme: "🏛️ Overheid", question: "Wie is het staatshoofd van Nederland?", options: ["De minister-president.", "De Koning of Koningin.", "De voorzitter van de Tweede Kamer.", "De burgemeester van Amsterdam."], answer: 1, explanation: "De Koning (momenteel Koning Willem-Alexander) is het staatshoofd van Nederland. De minister-president leidt de regering." },
  { id: 46, theme: "🏛️ Overheid", question: "Waar woont en werkt de Nederlandse regering?", options: ["Amsterdam.", "Rotterdam.", "Den Haag.", "Utrecht."], answer: 2, explanation: "De Nederlandse regering (ministers, parlement) is gevestigd in Den Haag. Amsterdam is de hoofdstad, maar niet de regeringsstad." },
  { id: 47, theme: "🏛️ Overheid", question: "Wat doet de gemeente?", options: ["De gemeente maakt landelijke wetten.", "De gemeente regelt lokale zaken zoals inschrijvingen, vergunningen en bijstand.", "De gemeente int belastingen voor de nationale overheid.", "De gemeente geeft paspoorten uit aan alle Nederlanders."], answer: 1, explanation: "De gemeente is het lokale bestuur. U kunt er terecht voor inschrijving (BRP), uittreksels, bijstand, vergunningen en meer." },
  { id: 48, theme: "🏛️ Overheid", question: "Wat is de rechtsstaat?", options: ["Een staat waar alleen rechtbanken de macht hebben.", "Een staat waar de wet geldt voor iedereen, ook voor de overheid.", "Een staat zonder democratie.", "Een staat waar religies de regels bepalen."], answer: 1, explanation: "In een rechtsstaat geldt de wet voor iedereen – ook voor de overheid. Niemand staat boven de wet. Nederland is een rechtsstaat." },
  { id: 49, theme: "🏛️ Overheid", question: "Wat betekent scheiding van kerk en staat?", options: ["Kerken zijn verboden in Nederland.", "De religie van de meerderheid bepaalt de wetten.", "De staat bemoeit zich niet met religie, en de kerk bemoeit zich niet met de overheid.", "Gelovigen mogen niet stemmen."], answer: 2, explanation: "De scheiding van kerk en staat betekent dat religie en staatsgezag gescheiden zijn. Iedereen heeft vrijheid van godsdienst, maar de wet staat boven religieuze regels." },
  { id: 50, theme: "🏛️ Overheid", question: "Staat de Nederlandse wet boven religieuze of culturele regels?", options: ["Nee, religieuze regels gaan voor.", "Ja, de Nederlandse wet geldt voor iedereen.", "Dat hangt af van de religie.", "Alleen voor mensen die geboren zijn in Nederland."], answer: 1, explanation: "In Nederland geldt de wet boven alle religieuze of culturele regels. Dit is een basisprincipe van de rechtsstaat." },
  { id: 51, theme: "🏛️ Overheid", question: "Welk artikel 1 van de Grondwet verbiedt?", options: ["Het bezit van wapens.", "Discriminatie op grond van godsdienst, ras, geslacht of andere kenmerken.", "Kritiek op de regering.", "Het gebruik van andere talen dan Nederlands."], answer: 1, explanation: "Artikel 1 van de Nederlandse Grondwet stelt dat alle mensen in gelijke gevallen gelijk worden behandeld. Discriminatie is verboden." },
  { id: 52, theme: "🏛️ Overheid", question: "Wat is orgaandonatie?", options: ["Het doneren van geld aan een ziekenhuis.", "Het beschikbaar stellen van uw organen na uw dood voor transplantatie.", "Het kopen van organen in het buitenland.", "Het vrijwillig bloed geven."], answer: 1, explanation: "Bij orgaandonatie geeft u toestemming om uw organen na uw dood te gebruiken voor mensen die een nieuw orgaan nodig hebben. In Nederland bent u automatisch donor, tenzij u zich afmeldt." },

  // ── NORMEN, WAARDEN & SAMENLEVEN ────────────────────────────────────────────
  { id: 53, theme: "🤝 Normen & Waarden", question: "Is homoseksualiteit verboden in Nederland?", options: ["Ja, het is verboden in het openbaar.", "Nee, homoseksualiteit is legaal en het homohuwelijk is toegestaan.", "Het is toegestaan, maar openbare uitingen zijn verboden.", "Het is alleen toegestaan in bepaalde steden."], answer: 1, explanation: "Homoseksualiteit is volledig legaal in Nederland. Nederland was in 2001 het eerste land ter wereld dat het homohuwelijk legaliseerde." },
  { id: 54, theme: "🤝 Normen & Waarden", question: "U ziet twee mannen die elkaar kussen op straat. Wat is de juiste reactie?", options: ["U zegt dat dit verboden is op straat.", "U wordt boos en scheldt hen uit.", "U loopt gewoon door – dit is legaal in Nederland.", "U belt de politie."], answer: 2, explanation: "Homoseksualiteit en openbare uitingen van genegenheid zijn volledig legaal in Nederland. De juiste reactie is niets te doen en verder te lopen." },
  { id: 55, theme: "🤝 Normen & Waarden", question: "Wat is discriminatie?", options: ["Iemand een compliment geven.", "Iemand oneerlijk behandelen vanwege zijn afkomst, religie, geslacht of andere kenmerken.", "Een meningsverschil hebben met iemand.", "Iemand niet kennen."], answer: 1, explanation: "Discriminatie is het oneerlijk en ongelijk behandelen van mensen op basis van kenmerken zoals ras, godsdienst, geslacht of seksuele geaardheid. Het is verboden in Nederland." },
  { id: 56, theme: "🤝 Normen & Waarden", question: "Wat is vrijheid van meningsuiting?", options: ["Het recht om altijd gelijk te hebben.", "Het recht om uw mening te uiten, zolang u geen haat verspreidt of mensen bedreigt.", "Het recht om alles te zeggen zonder gevolgen.", "Het recht om de overheid te negeren."], answer: 1, explanation: "Vrijheid van meningsuiting is een grondrecht in Nederland. U mag uw mening uiten, maar het aanzetten tot haat of geweld is verboden." },
  { id: 57, theme: "🤝 Normen & Waarden", question: "Wat wordt gevierd op 5 mei?", options: ["Koningsdag.", "Bevrijdingsdag – het einde van de Tweede Wereldoorlog in 1945.", "Dodenherdenking.", "Sinterklaas."], answer: 1, explanation: "Op 5 mei viert Nederland Bevrijdingsdag: het einde van de bezetting door nazi-Duitsland in 1945. Het is een nationale feestdag." },
  { id: 58, theme: "🤝 Normen & Waarden", question: "Wat is 4 mei in Nederland?", options: ["Bevrijdingsdag.", "Koningsdag.", "Dodenherdenking – stilstaan bij alle slachtoffers van de Tweede Wereldoorlog.", "Sinterklaasavond."], answer: 2, explanation: "Op 4 mei is het Nationale Dodenherdenking. Om 20:00 uur is er een nationale twee minuten stilte ter nagedachtenis aan alle oorlogsslachtoffers." },
  { id: 59, theme: "🤝 Normen & Waarden", question: "Wat is Keti Koti?", options: ["Een islamitisch feest.", "De herdenking van de afschaffing van de slavernij op 1 juli 1863.", "Een feest voor de Marokkaanse gemeenschap.", "Een regionale feestdag in Limburg."], answer: 1, explanation: "Keti Koti (Surinaams voor 'ketenen gebroken') wordt op 1 juli gevierd ter herdenking van de afschaffing van de slavernij in Suriname en de Nederlandse Antillen." },
  { id: 60, theme: "🤝 Normen & Waarden", question: "Wanneer is Koningsdag?", options: ["30 april.", "27 april.", "31 augustus.", "15 augustus."], answer: 1, explanation: "Koningsdag is elk jaar op 27 april (de verjaardag van Koning Willem-Alexander). Als het een zondag is, wordt het op 26 april gevierd." },
  { id: 61, theme: "🤝 Normen & Waarden", question: "Heeft een vrouw in Nederland het recht om zelf te beslissen over haar leven?", options: ["Nee, haar man of familie beslist.", "Ja, elke vrouw heeft recht op zelfbeschikking.", "Alleen als zij 21 jaar of ouder is.", "Dat hangt af van haar religie."], answer: 1, explanation: "In Nederland heeft iedere vrouw recht op zelfbeschikking: zij beslist zelf over haar leven, haar lichaam en haar relaties. Dit is vastgelegd in de wet." },
  { id: 62, theme: "🤝 Normen & Waarden", question: "Wat was de Holocaust?", options: ["Een oorlog tussen Nederland en Duitsland.", "De systematische moord op Joden en andere groepen door de nazi's tijdens de Tweede Wereldoorlog.", "Een hongersnood in Nederland in 1944.", "De bombardementen op Rotterdam in 1940."], answer: 1, explanation: "De Holocaust was de systematische massamoord op ca. 6 miljoen Joden en miljoenen anderen (Roma, mensen met een beperking, homo's) door het nazi-regime." },
  { id: 63, theme: "🤝 Normen & Waarden", question: "Wat is antisemitisme?", options: ["Kritiek op de politiek van Israël.", "Haat, vooroordelen of discriminatie gericht tegen Joodse mensen.", "Een religieuze stroming.", "Een politieke partij."], answer: 1, explanation: "Antisemitisme is haat of discriminatie gericht op Joodse mensen. Het herkennen en bestrijden van antisemitisme is nu expliciet onderdeel van de KNM-eindtermen." },
  { id: 64, theme: "🤝 Normen & Waarden", question: "Wanneer wordt Carnaval gevierd in Nederland?", options: ["In december, voor Kerstmis.", "In de drie dagen voor Aswoensdag, meestal in januari of februari.", "Op 31 oktober.", "Op Koningsdag."], answer: 1, explanation: "Carnaval wordt gevierd in het zuiden van Nederland (Noord-Brabant en Limburg), de drie dagen voor Aswoensdag. Het is een feest met muziek, kostuums en optochten." },
  { id: 65, theme: "🤝 Normen & Waarden", question: "Wanneer viert Nederland Sinterklaas?", options: ["25 december.", "5 december (Pakjesavond).", "31 oktober.", "6 december."], answer: 1, explanation: "Sinterklaas wordt gevierd op de avond van 5 december (Pakjesavond). Sinterklaas komt elk jaar in november aan met de stoomboot vanuit Spanje." },

  // ── DIGITALISERING ─────────────────────────────────────────────────────────
  { id: 66, theme: "💻 Digitalisering", question: "Wat is DigiD?", options: ["Een bankpas voor online betalingen.", "Uw digitale identiteit waarmee u inlogt op overheidswebsites.", "Een e-mailadres van de overheid.", "Een app voor het leren van Nederlands."], answer: 1, explanation: "DigiD (Digitale Identiteit) is uw persoonlijke inlogcode voor overheidswebsites zoals Belastingdienst, DUO, Mijn Zorgverzekeraar en de gemeente." },
  { id: 67, theme: "💻 Digitalisering", question: "Waarvoor heeft u DigiD nodig?", options: ["Om geld te pinnen bij de bank.", "Om uw belastingaangifte online te doen, een uitkering aan te vragen of diploma's op te vragen.", "Om een ov-chipkaart te kopen.", "Om een rijbewijs te maken."], answer: 1, explanation: "DigiD heeft u nodig voor vrijwel alle digitale contacten met de overheid: belasting, UWV, zorgverzekering, DUO, gemeente en meer." },
  { id: 68, theme: "💻 Digitalisering", question: "Wat is phishing?", options: ["Een methode om vissen te vangen.", "Een manier om via valse e-mails of websites uw gegevens te stelen.", "Een soort computervirus dat bestanden verwijdert.", "Een techniek om wachtwoorden te verbeteren."], answer: 1, explanation: "Phishing is oplichting via valse e-mails of websites die eruitzien als officiële berichten, met als doel uw inloggegevens of persoonlijke informatie te stelen." },
  { id: 69, theme: "💻 Digitalisering", question: "Hoe bewaart u uw wachtwoord veilig?", options: ["Op een briefje op uw bureau.", "In een beveiligde wachtwoordmanager.", "Via een bericht op sociale media.", "U deelt het met een vriend zodat u het niet vergeet."], answer: 1, explanation: "Een wachtwoordmanager is de veiligste manier om wachtwoorden op te slaan. Schrijf wachtwoorden nooit op papier en deel ze nooit." },
  { id: 70, theme: "💻 Digitalisering", question: "Wat is het BSN?", options: ["Een bankrekeningnummer.", "Uw persoonlijk identificatienummer dat u gebruikt bij de overheid, zorg, werk en school.", "Uw DigiD-inlogcode.", "Een nummer op uw zorgverzekeringspas."], answer: 1, explanation: "BSN staat voor Burgerservicenummer. Het is een uniek nummer dat u krijgt bij inschrijving in Nederland. U heeft het nodig voor bijna alles: dokter, werkgever, school, belasting." },
  { id: 71, theme: "💻 Digitalisering", question: "Met wie mag u uw BSN zomaar delen?", options: ["Met iedereen die erom vraagt.", "Alleen met bevoegde instanties zoals de werkgever, dokter of overheid.", "U mag het met niemand delen.", "Alleen met familieleden."], answer: 1, explanation: "Uw BSN is privacygevoelig. U deelt het alleen met bevoegde partijen zoals uw werkgever (voor salarisadministratie), zorgverlener of overheidsinstantie." },

  // ── DIT IS NEDERLAND (GEOGRAFIE & GESCHIEDENIS) ─────────────────────────────
  { id: 72, theme: "🌷 Dit is Nederland", question: "Wat is de hoofdstad van Nederland?", options: ["Den Haag.", "Rotterdam.", "Amsterdam.", "Utrecht."], answer: 2, explanation: "Amsterdam is de officiële hoofdstad van Nederland. De Tweede Kamer en de meeste ministeries zijn echter gevestigd in Den Haag." },
  { id: 73, theme: "🌷 Dit is Nederland", question: "Welke landen horen bij het Koninkrijk der Nederlanden?", options: ["Nederland, België en Suriname.", "Nederland, Aruba, Curaçao en Sint Maarten.", "Nederland, Duitsland en de Nederlandse Antillen.", "Nederland en Indonesië."], answer: 1, explanation: "Het Koninkrijk der Nederlanden bestaat uit vier landen: Nederland (in Europa), Aruba, Curaçao en Sint Maarten (in het Caribisch gebied)." },
  { id: 74, theme: "🌷 Dit is Nederland", question: "Welke landen waren vroeger Nederlandse koloniën?", options: ["Amerika en Canada.", "Australië en Nieuw-Zeeland.", "Indonesië en Suriname.", "Zuid-Afrika en India."], answer: 2, explanation: "Indonesië (tot 1945/1949) en Suriname (tot 1975) waren de grootste voormalige Nederlandse kolonies. Suriname werd onafhankelijk in 1975." },
  { id: 75, theme: "🌷 Dit is Nederland", question: "Wie leidde de opstand tegen Spanje in de 16e eeuw?", options: ["Napoleon Bonaparte.", "Adolf Hitler.", "Willem van Oranje.", "Karel de Grote."], answer: 2, explanation: "Willem van Oranje (ook wel Willem de Zwijger) leidde de Tachtigjarige Oorlog (1568–1648) tegen de Spaanse overheersing. Dit leidde tot de onafhankelijkheid van Nederland." },
  { id: 76, theme: "🌷 Dit is Nederland", question: "Wanneer werd Nederland bevrijd van de Duitsers in de Tweede Wereldoorlog?", options: ["8 mei 1945.", "5 mei 1945.", "1 september 1939.", "30 april 1945."], answer: 1, explanation: "Op 5 mei 1945 werden de laatste delen van Nederland bevrijd. Duitsland capituleerde officieel op 8 mei 1945 (V-Day in Europa)." },
  { id: 77, theme: "🌷 Dit is Nederland", question: "Waar zit de Nederlandse regering (ministers en parlement)?", options: ["Amsterdam.", "Rotterdam.", "Utrecht.", "Den Haag."], answer: 3, explanation: "Den Haag is de regeringsstad van Nederland. Hier zijn de Tweede Kamer, Eerste Kamer, alle ministeries en de Koning gevestigd." },
  { id: 78, theme: "🌷 Dit is Nederland", question: "Wat zijn de kleuren van de Nederlandse vlag?", options: ["Rood, wit en blauw (van boven naar beneden).", "Blauw, wit en oranje.", "Oranje, wit en groen.", "Rood, geel en groen."], answer: 0, explanation: "De Nederlandse vlag heeft drie horizontale strepen: rood (boven), wit (midden) en blauw (onder). Oranje is de nationale kleur maar staat niet op de vlag." },

  // ── INSTANTIES ─────────────────────────────────────────────────────────────
  { id: 79, theme: "🏢 Instanties", question: "Wat doet het UWV?", options: ["Het UWV geeft paspoorten uit.", "Het UWV regelt uitkeringen voor werklozen en arbeidsongeschikten, en helpt bij het vinden van werk.", "Het UWV int belastingen.", "Het UWV geeft rijbewijzen uit."], answer: 1, explanation: "UWV staat voor Uitvoeringsinstituut Werknemersverzekeringen. Zij regelen WW, WIA en andere uitkeringen, en helpen mensen bij het vinden van werk." },
  { id: 80, theme: "🏢 Instanties", question: "U heeft juridische vragen maar kunt geen advocaat betalen. Waar gaat u naartoe?", options: ["Naar de politie.", "Naar het Juridisch Loket voor gratis juridisch advies.", "Naar de gemeente.", "Naar de Belastingdienst."], answer: 1, explanation: "Het Juridisch Loket biedt gratis eerste juridisch advies aan iedereen. Voor meer hulp kunt u worden doorverwezen naar een advocaat of mediator." },
  { id: 81, theme: "🏢 Instanties", question: "Wat doet de SVB (Sociale Verzekeringsbank)?", options: ["De SVB geeft leningen aan studenten.", "De SVB regelt de AOW-pensioen, kinderbijslag en andere sociale verzekeringen.", "De SVB int belastingen.", "De SVB geeft huurwoningen uit."], answer: 1, explanation: "De SVB voert sociale verzekeringen uit, zoals AOW (ouderdomspensioen), kinderbijslag (AKW), en AIO (aanvullende inkomensondersteuning voor ouderen)." },
  { id: 82, theme: "🏢 Instanties", question: "Wat doet DUO?", options: ["DUO geeft rijbewijzen uit.", "DUO voert onderwijswetten uit: studiefinanciering, inburgering en diplomaerkenning.", "DUO helpt bij het vinden van werk.", "DUO int parkeerboetes."], answer: 1, explanation: "DUO (Dienst Uitvoering Onderwijs) regelt studiefinanciering, bekostiging van scholen, het inburgeringsexamen en de erkenning van buitenlandse diploma's." },
  { id: 83, theme: "🏢 Instanties", question: "U bent slecht behandeld door de politie. Wat kunt u doen?", options: ["Niets, de politie heeft altijd gelijk.", "U kunt een klacht indienen bij de politie of naar een onafhankelijke klachtencommissie gaan.", "U belt 112.", "U gaat naar de Belastingdienst."], answer: 1, explanation: "Als u vindt dat de politie u onjuist heeft behandeld, kunt u een officiële klacht indienen bij het politiekorps of bij de Nationale ombudsman." },
  { id: 84, theme: "🏢 Instanties", question: "Wat doet het Anti-Discriminatie Bureau?", options: ["Het bureau helpt werkgevers bij het aannemen van personeel.", "Het bureau neemt klachten aan over discriminatie en helpt slachtoffers.", "Het bureau controleert of bedrijven de wet naleven.", "Het bureau int boetes voor discriminatie."], answer: 1, explanation: "Bij het Anti-Discriminatie Bureau kunt u gratis een klacht indienen als u gediscrimineerd bent, bijvoorbeeld bij het zoeken naar werk of een woning." },
  { id: 85, theme: "🏢 Instanties", question: "Welke instantie geeft diploma's uit en beheert studiefinanciering?", options: ["De gemeente.", "Het UWV.", "DUO (Dienst Uitvoering Onderwijs).", "De Belastingdienst."], answer: 2, explanation: "DUO beheert studiefinanciering voor studenten, bekostigt scholen en instellingen, en erkent buitenlandse diploma's." },
  { id: 86, theme: "🏢 Instanties", question: "Wat is de Kamer van Koophandel (KvK)?", options: ["Een adviesbureau voor grote bedrijven.", "Een register waar bedrijven en ondernemers zich moeten inschrijven.", "Een rechtbank voor handelsgeschillen.", "Een bank voor ondernemers."], answer: 1, explanation: "De Kamer van Koophandel (KvK) is het officiële register van alle bedrijven in Nederland. Als u een bedrijf start, moet u zich inschrijven bij de KvK." },

  // ── AANVULLENDE VRAGEN (PRAKTIJKSITUATIES) ───────────────────────────────────
  { id: 87, theme: "💼 Werk & Inkomen", question: "U wil voor uzelf beginnen als ondernemer. Wat doet u als eerste?", options: ["U opent een bankrekening.", "U schrijft uw bedrijf in bij de Kamer van Koophandel (KvK).", "U vraagt toestemming aan de gemeente.", "U meldt het bij de Belastingdienst."], answer: 1, explanation: "Om een bedrijf te starten in Nederland moet u uw onderneming als eerste inschrijven bij de Kamer van Koophandel (KvK). De Belastingdienst wordt daarna automatisch op de hoogte gesteld." },
  { id: 88, theme: "🏥 Gezondheid", question: "Uw kind heeft hoge koorts. Wat doet u?", options: ["U gaat direct naar de Spoedeisende Hulp van het ziekenhuis.", "U belt de huisarts voor advies of een afspraak.", "U belt 112.", "U gaat naar de apotheek voor medicijnen."], answer: 1, explanation: "Voor medische klachten bij kinderen belt u altijd eerst de huisarts. De huisarts beslist of u naar het ziekenhuis moet." },
  { id: 89, theme: "🎓 Onderwijs", question: "Uw kind is 4 jaar. Mag het al naar school?", options: ["Nee, kinderen mogen pas naar school vanaf 5 jaar.", "Ja, kinderen mogen al naar school (groep 1) vanaf 4 jaar.", "Nee, pas vanaf 6 jaar.", "Ja, maar alleen naar de peuterspeelzaal."], answer: 1, explanation: "Kinderen mogen al naar de basisschool (groep 1) vanaf 4 jaar, maar de leerplicht begint pas op 5-jarige leeftijd." },
  { id: 90, theme: "🏠 Wonen", question: "U wilt weten of u recht heeft op huurtoeslag. Waar kijkt u?", options: ["Bij de gemeente.", "Bij de Belastingdienst – via Mijn Toeslagen.", "Bij het UWV.", "Bij uw verhuurder."], answer: 1, explanation: "Huurtoeslag vraagt u aan via de Belastingdienst, op de website toeslagen.nl of via de Mijn Toeslagen-app." },
  { id: 91, theme: "🏛️ Overheid", question: "Hoe oud moet u zijn om te mogen stemmen in Nederland?", options: ["16 jaar.", "17 jaar.", "18 jaar.", "21 jaar."], answer: 2, explanation: "In Nederland heeft iedereen van 18 jaar en ouder met de Nederlandse nationaliteit stemrecht bij landelijke verkiezingen." },
  { id: 92, theme: "🤝 Normen & Waarden", question: "Wat is vrijheid van godsdienst?", options: ["Het verbod op andere religies dan het Christendom.", "Het recht van iedereen om een eigen religie te hebben of geen religie te hebben.", "De verplichting om een religie te kiezen.", "Het recht om religie te verbieden in openbare gebouwen."], answer: 1, explanation: "Vrijheid van godsdienst (en levensovertuiging) is een grondrecht. Iedereen mag zelf kiezen welke religie hij aanhangt, of helemaal geen religie." },
  { id: 93, theme: "🏢 Instanties", question: "Wat is de AOW?", options: ["Een uitkering voor werklozen.", "Het ouderdomspensioen van de overheid dat mensen ontvangen vanaf de pensioenleeftijd.", "Een ziekteverzekering.", "Een kinderuitkering."], answer: 1, explanation: "AOW staat voor Algemene Ouderdomswet. Iedereen die in Nederland heeft gewoond of gewerkt, heeft recht op AOW-pensioen na het bereiken van de AOW-leeftijd (momenteel 67 jaar)." },
  { id: 94, theme: "💻 Digitalisering", question: "U ontvangt een e-mail van 'de Belastingdienst' met een link om in te loggen. De e-mail ziet er vreemd uit. Wat doet u?", options: ["U klikt op de link en logt in.", "U verwijdert de e-mail – dit is waarschijnlijk phishing.", "U stuurt de e-mail door naar vrienden.", "U belt het telefoonnummer in de e-mail."], answer: 1, explanation: "De Belastingdienst verstuurt nooit e-mails met links om direct in te loggen. Dit is een klassieke phishing-aanval. Verwijder de e-mail en ga zelf naar belastingdienst.nl." },
  { id: 95, theme: "🌷 Dit is Nederland", question: "Hoeveel provincies heeft Nederland?", options: ["10", "12", "14", "15"], answer: 1, explanation: "Nederland heeft 12 provincies: Noord-Holland, Zuid-Holland, Utrecht, Zeeland, Noord-Brabant, Limburg, Gelderland, Overijssel, Drenthe, Groningen, Friesland en Flevoland." },
  { id: 96, theme: "🏛️ Overheid", question: "Wat is de rol van de burgemeester in een gemeente?", options: ["De burgemeester maakt nationale wetten.", "De burgemeester leidt het gemeentebestuur en vertegenwoordigt de gemeente.", "De burgemeester wordt gekozen door de inwoners van de gemeente.", "De burgemeester is verantwoordelijk voor het nationale politiebeleid."], answer: 1, explanation: "De burgemeester leidt het college van burgemeester en wethouders (B&W) en vertegenwoordigt de gemeente. In Nederland worden burgemeesters aangesteld, niet direct gekozen." },
  { id: 97, theme: "🤝 Normen & Waarden", question: "Uw buurman is overleden. Wat doet u?", options: ["U feliciteert de familie.", "U condoleert de familie – u betuigt uw medeleven.", "U doet niets – het is privé.", "U stuurt een verjaardagskaart."], answer: 1, explanation: "Als iemand overlijdt, gaat u naar de nabestaanden om uw medeleven te betuigen. Dit noemen we condoleren. Feliciteren is voor positieve gebeurtenissen zoals een verjaardag." },
  { id: 98, theme: "🎓 Onderwijs", question: "Wat is een startkwalificatie?", options: ["Een diploma van de basisschool.", "Een diploma op minimaal MBO niveau 2, HAVO of VWO.", "Een bewijs dat u kunt lezen en schrijven.", "Een inburgeringsdiploma."], answer: 1, explanation: "Een startkwalificatie is het minimale onderwijsniveau dat u nodig heeft om kans te maken op de arbeidsmarkt: minimaal MBO niveau 2, HAVO of VWO." },
  { id: 99, theme: "💼 Werk & Inkomen", question: "U bent al 2 jaar ziek en kunt niet meer werken. Welke uitkering kunt u aanvragen?", options: ["WW", "Bijstand", "WIA (Wet werk en inkomen naar arbeidsvermogen)", "Kinderbijslag"], answer: 2, explanation: "Na 2 jaar ziekte kunt u WIA aanvragen. Het UWV beoordeelt in hoeverre u nog kunt werken en bepaalt het type WIA-uitkering (WGA of IVA)." },
  { id: 100, theme: "🏠 Wonen", question: "U wil een klacht indienen over uw verhuurder die de huur onterecht verhoogt. Waar gaat u naartoe?", options: ["De politie.", "De gemeente.", "De Huurcommissie.", "Het Juridisch Loket voor gratis advies, of de Huurcommissie."], answer: 3, explanation: "U kunt eerst gratis advies vragen bij het Juridisch Loket en daarna een procedure starten bij de Huurcommissie, die onafhankelijk beslist over huurgeschillen." },

  // ── POLITIEK & DEMOCRATIE ────────────────────────────────────────────────────
  { id: 101, theme: "🏛️ Overheid", question: "Hoe vaak zijn er in Nederland verkiezingen voor de Tweede Kamer?", options: ["Elke 2 jaar.", "Elke 4 jaar (of eerder als de regering valt).", "Elke 5 jaar.", "Elke 6 jaar."], answer: 1, explanation: "Tweede Kamerverkiezingen vinden elke 4 jaar plaats. Als de coalitie uit elkaar valt, kunnen er tussentijdse verkiezingen worden uitgeschreven." },
  { id: 102, theme: "🏛️ Overheid", question: "Wat is een coalitie in de Nederlandse politiek?", options: ["Een oppositiepartij die de regering bekritiseert.", "Een samenwerking van meerdere partijen die samen de regering vormen.", "Een onafhankelijke toezichthouder op de overheid.", "Een soort referendum."], answer: 1, explanation: "In Nederland haalt zelden één partij een meerderheid. Meerdere partijen vormen samen een coalitie om een meerderheid te krijgen en te regeren." },
  { id: 103, theme: "🏛️ Overheid", question: "Wat is de minister-president?", options: ["Het hoofd van de Eerste Kamer.", "De leider van de grootste partij in de Tweede Kamer.", "De leider van de regering en voorzitter van de ministerraad.", "De secretaris van de Koning."], answer: 2, explanation: "De minister-president (ook wel 'premier') leidt de regering. In Nederland is dit de voorzitter van het kabinet. Hij werkt samen met de Koning bij het vormen van een regering." },
  { id: 104, theme: "🏛️ Overheid", question: "Wat is de oppositie in de politiek?", options: ["De partijen die in de regering zitten.", "De partijen die niet in de regering zitten en het beleid bekritiseren.", "Een groep burgers die protesteert.", "De rechters in de Tweede Kamer."], answer: 1, explanation: "De oppositie bestaat uit partijen die niet deelnemen aan de coalitie. Zij controleren de regering en presenteren alternatieven." },
  { id: 105, theme: "🏛️ Overheid", question: "Wat is de Nationale ombudsman?", options: ["De hoogste rechter in Nederland.", "Een onafhankelijke instantie waar burgers klachten kunnen indienen over de overheid.", "De baas van alle gemeenten.", "De voorzitter van de Tweede Kamer."], answer: 1, explanation: "De Nationale ombudsman onderzoekt klachten van burgers over de manier waarop de overheid hen heeft behandeld, zoals de gemeente, politie of Belastingdienst." },
  { id: 106, theme: "🏛️ Overheid", question: "Wat is een referendum?", options: ["Een verkiezing voor de Tweede Kamer.", "Een volksraadpleging waarbij burgers direct over een onderwerp stemmen.", "Een vergadering van alle burgemeesters.", "Een debat in de Eerste Kamer."], answer: 1, explanation: "Bij een referendum mogen burgers zelf direct stemmen over een specifiek onderwerp of wet. In Nederland worden referenda soms gehouden, maar ze zijn niet bindend." },
  { id: 107, theme: "🏛️ Overheid", question: "Wat doet de rechter in Nederland?", options: ["De rechter maakt nieuwe wetten.", "De rechter beslist in conflicten en beoordeelt of iemand de wet heeft overtreden.", "De rechter controleert de Tweede Kamer.", "De rechter geeft opdrachten aan de politie."], answer: 1, explanation: "Rechters zijn onafhankelijk en beslissen in rechtszaken. Zij leggen wetten uit en bepalen of iemand schuldig is en welke straf passend is." },
  { id: 108, theme: "🏛️ Overheid", question: "Wat is de taak van de politie in Nederland?", options: ["De politie maakt wetten.", "De politie handhaaft de wet, zorgt voor veiligheid en helpt bij noodsituaties.", "De politie int belastingen.", "De politie beslist over uitkeringen."], answer: 1, explanation: "De politie handhaaft de openbare orde en veiligheid, pakt misdaden aan en helpt burgers in noodsituaties. U kunt de politie bellen via 0900-8844 voor niet-spoedgevallen." },

  // ── GELD & BANKZAKEN ──────────────────────────────────────────────────────────
  { id: 109, theme: "💼 Werk & Inkomen", question: "Wat is een IBAN?", options: ["Een soort belastingformulier.", "Uw internationale bankrekeningnummer waarmee u betalingen ontvangt en doet.", "Een identiteitsnummer van de Belastingdienst.", "Een verzekeringsnummer."], answer: 1, explanation: "IBAN staat voor International Bank Account Number. In Nederland begint uw IBAN met 'NL'. U geeft het door aan uw werkgever voor salarisbetalingen." },
  { id: 110, theme: "💼 Werk & Inkomen", question: "Wat is een loonstrookje?", options: ["Een bewijs dat u uw belasting heeft betaald.", "Een overzicht van uw salaris, inhoudingen en nettoloon per maand.", "Een contract met uw werkgever.", "Een overzicht van uw pensioen."], answer: 1, explanation: "Een loonstrookje toont uw bruto salaris, belastingen en premies die worden ingehouden, en uw nettoloon – het bedrag dat u daadwerkelijk ontvangt." },
  { id: 111, theme: "💼 Werk & Inkomen", question: "Wat is het minimumloon?", options: ["Het maximale loon dat een werkgever mag betalen.", "Het wettelijke minimum bedrag dat een werkgever per uur moet betalen.", "Het loon dat de gemeente betaalt aan mensen met bijstand.", "Het loon voor parttimers."], answer: 1, explanation: "Het minimumloon is het laagste bedrag dat een werkgever wettelijk per uur moet betalen. Het wordt twee keer per jaar aangepast. In 2025 is het ca. €13,68 per uur." },
  { id: 112, theme: "💼 Werk & Inkomen", question: "Wat is bruto salaris?", options: ["Uw salaris na aftrek van belastingen en premies.", "Uw salaris vóór aftrek van belastingen en premies.", "Uw salaris inclusief vakantiegeld.", "Het minimumloon."], answer: 1, explanation: "Het bruto salaris is uw totale loon voordat belastingen en sociale premies worden ingehouden. Het nettoloon is wat u daadwerkelijk op uw rekening krijgt." },
  { id: 113, theme: "💼 Werk & Inkomen", question: "Wat is zorgtoeslag?", options: ["Gratis medische zorg voor mensen zonder inkomen.", "Een maandelijkse bijdrage van de overheid voor de kosten van uw zorgverzekering.", "Een uitkering als u ziek bent.", "Een korting op het eigen risico."], answer: 1, explanation: "Zorgtoeslag is een maandelijkse bijdrage van de Belastingdienst voor mensen met een laag of gemiddeld inkomen, om de kosten van de verplichte zorgverzekering te helpen betalen." },
  { id: 114, theme: "💼 Werk & Inkomen", question: "Wat is kinderbijslag (AKW)?", options: ["Gratis kinderopvang voor alle kinderen.", "Een uitkering van de SVB voor gezinnen met kinderen om de kosten van opvoeding te helpen betalen.", "Geld van de gemeente voor schoolreisjes.", "Een belastingkorting voor ouders."], answer: 1, explanation: "Kinderbijslag (Algemene Kinderbijslagwet) is een uitkering per kwartaal van de SVB voor kinderen tot 18 jaar. U ontvangt het automatisch als uw kind ingeschreven staat in Nederland." },

  // ── OPENBAAR VERVOER & PRAKTISCH LEVEN ──────────────────────────────────────
  { id: 115, theme: "🤝 Normen & Waarden", question: "Wat is een ov-chipkaart?", options: ["Een bankpas voor openbare gebouwen.", "Een kaart waarmee u betaalt in het openbaar vervoer (bus, tram, metro, trein).", "Een identiteitskaart voor minderjarigen.", "Een korting voor studenten in winkels."], answer: 1, explanation: "Met een ov-chipkaart in- en uitcheckt u bij het openbaar vervoer. U kunt de kaart opladen met saldo of een abonnement laden." },
  { id: 116, theme: "🤝 Normen & Waarden", question: "U wilt met de trein reizen maar u heeft geen geldig vervoersbewijs. Wat kan er gebeuren?", options: ["U mag gratis meerijden als u het uitleggt.", "U krijgt een boete van de conducteur.", "U wordt meegenomen door de politie.", "Niets, controleurs controleren zelden."], answer: 1, explanation: "Zwartrijden (reizen zonder geldig vervoersbewijs) is verboden. U krijgt een boete van de NS-conducteur of BOA. De boete kan hoog oplopen." },
  { id: 117, theme: "🤝 Normen & Waarden", question: "Wat is een ID-bewijs en wanneer heeft u het nodig?", options: ["Alleen bij het openen van een bankrekening.", "Bij controle door de politie, het kopen van alcohol, en andere officiële situaties. Iedereen vanaf 14 jaar moet het bij zich hebben.", "Alleen bij reizen naar het buitenland.", "Alleen bij het tekenen van een huurcontract."], answer: 1, explanation: "In Nederland bent u verplicht een geldig identiteitsbewijs bij u te dragen vanaf 14 jaar. Dit kan een paspoort, ID-kaart of rijbewijs zijn." },
  { id: 118, theme: "🤝 Normen & Waarden", question: "Hoe oud moet u zijn om in Nederland alcohol te kopen?", options: ["16 jaar.", "17 jaar.", "18 jaar.", "21 jaar."], answer: 2, explanation: "Vanaf 18 jaar mag u in Nederland alcohol kopen. Winkels en horecagelegenheden zijn verplicht uw leeftijd te controleren." },
  { id: 119, theme: "🤝 Normen & Waarden", question: "Hoe oud moet u zijn om te rijden met een auto in Nederland?", options: ["16 jaar.", "17 jaar met begeleider (2toDrive).", "18 jaar.", "Zowel B als C zijn juist."], answer: 3, explanation: "U mag zelfstandig autorijden vanaf 18 jaar. Met het 2toDrive-programma mag u al rijden vanaf 17 jaar, maar alleen met een begeleider van minimaal 25 jaar." },
  { id: 120, theme: "🤝 Normen & Waarden", question: "Wat doet u als u getuige bent van een misdrijf?", options: ["U doet niets – het is gevaarlijk om te helpen.", "U belt 112 als het spoedeisend is, of 0900-8844 voor niet-spoed.", "U spreekt de dader zelf aan.", "U neemt foto's en plaatst ze op sociale media."], answer: 1, explanation: "Als u getuige bent van een misdrijf, belt u 112 als er direct gevaar is. Voor aangifte of niet-spoedeisende situaties belt u 0900-8844 of gaat u naar het politiebureau." },

  // ── MILIEU & DUURZAAMHEID ────────────────────────────────────────────────────
  { id: 121, theme: "🌷 Dit is Nederland", question: "Hoe sorteert u afval in Nederland?", options: ["U gooit alles in één container.", "U scheidt afval: papier, glas, plastic/blik, GFT (groente/fruit/tuin) en restafval.", "Alleen plastic hoeft gescheiden te worden.", "Afval sorteren is niet verplicht maar vrijwillig."], answer: 1, explanation: "In Nederland moet u afval scheiden. Gemeenten hebben verschillende containers of inzamelpunten voor papier, glas, plastic/blik/pak, GFT-afval en restafval." },
  { id: 122, theme: "🌷 Dit is Nederland", question: "Wat is energiebesparing thuis?", options: ["De verwarming de hele dag op de hoogste stand zetten.", "Apparaten uitzetten als u ze niet gebruikt en de verwarming lager zetten als u weg bent.", "Altijd de koelkast op de koudste stand zetten.", "Lampen de hele nacht aan laten voor veiligheid."], answer: 1, explanation: "Energiebesparing helpt het milieu en verlaagt uw energierekening. Zet apparaten uit als u ze niet gebruikt, isoleer uw woning en zet de verwarming lager als u slaapt of weg bent." },
  { id: 123, theme: "🌷 Dit is Nederland", question: "Wat is het waterbeheer in Nederland zo bijzonder aan?", options: ["Nederland heeft de schoonste rivieren van Europa.", "Een groot deel van Nederland ligt onder zeeniveau; dijken en waterwerken beschermen het land.", "Nederland heeft de meeste regenval van Europa.", "De zeespiegel in Nederland daalt elk jaar."], answer: 1, explanation: "Circa 26% van Nederland ligt onder zeeniveau. Waterhuishouding is van levensbelang. Dijken, gemalen en de Deltawerken beschermen Nederland tegen overstromingen." },

  // ── GEZONDHEIDSZORG VERDIEPT ─────────────────────────────────────────────────
  { id: 124, theme: "🏥 Gezondheid", question: "Wat is de Eerste Hulp (SEH)?", options: ["De huisartsenpraktijk.", "De spoedafdeling van het ziekenhuis voor ernstige verwondingen en acute ziekten.", "Een ambulance.", "De GGD."], answer: 1, explanation: "De Spoedeisende Hulp (SEH) is de afdeling van het ziekenhuis voor acute, ernstige situaties. U mag er alleen heen als de huisarts of 112 u doorverwijst, tenzij het een echte noodsituatie is." },
  { id: 125, theme: "🏥 Gezondheid", question: "Wat is een specialist?", options: ["Een ervaren huisarts.", "Een dokter die gespecialiseerd is in een bepaald medisch gebied en werkt in het ziekenhuis.", "Een apotheker met veel ervaring.", "Een arts die thuis patiënten bezoekt."], answer: 1, explanation: "Een specialist (medisch specialist) werkt in het ziekenhuis en heeft extra opleiding in een specifiek vakgebied, zoals cardiologie, orthopedie of dermatologie. U heeft een verwijzing van de huisarts nodig." },
  { id: 126, theme: "🏥 Gezondheid", question: "Wat is de tandarts en hoe vaak moet u gaan?", options: ["De tandarts is dezelfde als de huisarts voor tandpijn.", "De tandarts behandelt tanden en kiezen; het wordt aangeraden 1 à 2 keer per jaar te gaan voor controle.", "Tandarts is gratis voor iedereen via de zorgverzekering.", "U mag de tandarts pas bezoeken na een verwijzing van de huisarts."], answer: 1, explanation: "De tandarts behandelt uw gebit. Preventieve controles (1–2 keer per jaar) zijn belangrijk. Tandheelkundige zorg voor volwassenen zit niet volledig in het basispakket van de zorgverzekering." },
  { id: 127, theme: "🏥 Gezondheid", question: "Wat doet u als u iemand op straat bewusteloos vindt?", options: ["U loopt door – het is gevaarlijk om te helpen.", "U belt 112, controleert of de persoon ademt en start zo nodig reanimatie.", "U geeft de persoon water.", "U belt de huisarts."], answer: 1, explanation: "Bij een bewusteloze persoon belt u direct 112. Controleer of de persoon ademt. De meldkamer kan u begeleiden bij eerste hulp en reanimatie totdat de ambulance er is." },
  { id: 128, theme: "🏥 Gezondheid", question: "Wat is een aanvullende zorgverzekering?", options: ["De verplichte basisverzekering.", "Een extra, vrijwillige verzekering bovenop de basisverzekering voor zorg die niet in het basispakket zit.", "Een verzekering voor buitenlandse reizen.", "Een verzekering die het eigen risico dekt."], answer: 1, explanation: "De aanvullende verzekering is optioneel en dekt zorg die niet in de verplichte basisverzekering zit, zoals fysiotherapie, tandarts of brillen." },

  // ── ONDERWIJS VERDIEPT ───────────────────────────────────────────────────────
  { id: 129, theme: "🎓 Onderwijs", question: "Wat is VMBO?", options: ["Voortgezet middelbaar beroepsonderwijs – een hogere variant van MBO.", "Voorbereidend middelbaar beroepsonderwijs – middelbare school die voorbereidt op MBO.", "Een soort universiteit voor beroepsopleidingen.", "Een basisschool voor bijzonder onderwijs."], answer: 1, explanation: "VMBO (Voorbereidend Middelbaar Beroepsonderwijs) duurt 4 jaar en bereidt leerlingen voor op het MBO. Er zijn vier leerwegen: theoretisch, gemengd, kaderberoepsgericht en basisberoepsgericht." },
  { id: 130, theme: "🎓 Onderwijs", question: "Hoe lang duurt de basisschool in Nederland?", options: ["6 jaar (groep 1–6).", "7 jaar (groep 1–7).", "8 jaar (groep 1–8).", "9 jaar (groep 0–8)."], answer: 2, explanation: "De basisschool in Nederland duurt 8 jaar, van groep 1 t/m groep 8. Leerlingen beginnen meestal op 4-jarige leeftijd (groep 1) en verlaten de basisschool op 12-jarige leeftijd." },
  { id: 131, theme: "🎓 Onderwijs", question: "Wat is studiefinanciering?", options: ["Een beurs van de gemeente voor kinderen op de basisschool.", "Financiële steun van DUO voor studenten in het hoger onderwijs (HBO of universiteit).", "Geld van de werkgever voor opleidingen.", "Een lening bij de bank voor studie."], answer: 1, explanation: "Studiefinanciering is een systeem van de overheid (DUO) dat HBO- en universiteitsstudenten financieel ondersteunt via een OV-kaart, eventueel een beurs of lening." },
  { id: 132, theme: "🎓 Onderwijs", question: "Wat is een leerplichtambtenaar?", options: ["Een leraar die extra les geeft aan achterblijvende leerlingen.", "Een gemeenteambtenaar die controleert of alle kinderen naar school gaan.", "Een inspecteur die de kwaliteit van scholen beoordeelt.", "Een medewerker van DUO."], answer: 1, explanation: "De leerplichtambtenaar werkt voor de gemeente en controleert of alle leerplichtige kinderen naar school gaan. Bij spijbelen of schoolverzuim neemt hij contact op met ouders." },
  { id: 133, theme: "🎓 Onderwijs", question: "Wat is het verschil tussen openbaar en bijzonder onderwijs?", options: ["Openbaar onderwijs is gratis, bijzonder onderwijs kost geld.", "Openbaar onderwijs is voor iedereen toegankelijk en neutraal; bijzonder onderwijs is gebaseerd op een religieuze of andere levensbeschouwelijke grondslag.", "Openbaar onderwijs is beter dan bijzonder onderwijs.", "Er is geen verschil – beide vallen onder dezelfde regels."], answer: 1, explanation: "Openbare scholen zijn voor iedereen en neutraal. Bijzondere scholen (zoals christelijke, islamitische of Montessori-scholen) hebben een eigen identiteit. Beide worden door de staat gefinancierd." },

  // ── WONEN VERDIEPT ──────────────────────────────────────────────────────────
  { id: 134, theme: "🏠 Wonen", question: "Wat is een hypotheek?", options: ["Een type huurcontract.", "Een lening bij de bank om een woning te kopen, waarbij de woning als onderpand dient.", "Een garantie van de gemeente bij het huren van een woning.", "Een subsidie voor het kopen van een eerste woning."], answer: 1, explanation: "Een hypotheek is een lening van de bank waarmee u een woning koopt. Als u de lening niet terugbetaalt, mag de bank de woning verkopen." },
  { id: 135, theme: "🏠 Wonen", question: "Wat is een woningcorporatie?", options: ["Een bedrijf dat luxe koopwoningen bouwt.", "Een organisatie die sociale huurwoningen beheert en verhuurt aan mensen met een laag inkomen.", "Een afdeling van de gemeente die bouwvergunningen geeft.", "Een bank die hypotheken verstrekt."], answer: 1, explanation: "Woningcorporaties (ook wel 'woningbouwcorporaties') zijn non-profitorganisaties die sociale huurwoningen beheren. Bekende corporaties zijn Ymere, Vestia en Portaal." },
  { id: 136, theme: "🏠 Wonen", question: "U heeft een huurcontract. Hoeveel opzegtermijn heeft u als huurder?", options: ["Geen – u kunt direct vertrekken.", "1 maand opzegtermijn.", "3 maanden opzegtermijn.", "6 maanden opzegtermijn."], answer: 1, explanation: "Als huurder heeft u doorgaans 1 maand opzegtermijn. U zegt op per aangetekende brief of via een door de verhuurder bevestigde andere methode." },
  { id: 137, theme: "🏠 Wonen", question: "Wat is servicekosten bij een huurwoning?", options: ["Extra kosten die de huurder altijd zelf mag bepalen.", "Kosten die de verhuurder naast de kale huur in rekening brengt, zoals voor gas, water, licht of schoonmaak van gemeenschappelijke ruimtes.", "Kosten voor het afsluiten van het huurcontract.", "Een boete als u te laat betaalt."], answer: 1, explanation: "Servicekosten zijn kosten die een verhuurder naast de kale huur vraagt. Denk aan kosten voor verwarming, water of schoonmaak. De verhuurder moet elk jaar een specificatie geven." },

  // ── RECHTEN & PLICHTEN ALS BURGER ───────────────────────────────────────────
  { id: 138, theme: "🏛️ Overheid", question: "Wat is het paspoort en hoe lang is het geldig?", options: ["5 jaar voor iedereen.", "10 jaar voor volwassenen (18+), 5 jaar voor kinderen.", "10 jaar voor iedereen.", "Onbeperkt geldig."], answer: 1, explanation: "Een Nederlands paspoort is 10 jaar geldig voor volwassenen (18 jaar en ouder) en 5 jaar voor kinderen (jonger dan 18). U vraagt het aan bij uw gemeente." },
  { id: 139, theme: "🏛️ Overheid", question: "Wat is de BRP?", options: ["Bureau voor Regelgeving en Procedures – een adviesorgaan.", "De Basisregistratie Personen – het officiële register van alle inwoners van Nederland.", "Een rijbewijs voor buitenlandse chauffeurs.", "Een belastingregister."], answer: 1, explanation: "De BRP (Basisregistratie Personen) is de database van alle inwoners van Nederland. Gemeenten beheren de BRP. Als u verhuist, werkt u uw adres bij in de BRP via de gemeente." },
  { id: 140, theme: "🏛️ Overheid", question: "Wat is een verblijfsvergunning?", options: ["Een vergunning om in Nederland te mogen werken als zelfstandige.", "Een officieel document dat niet-EU-burgers het recht geeft om in Nederland te wonen en/of te werken.", "Een identiteitsbewijs voor asielzoekers.", "Een toeristenvisum."], answer: 1, explanation: "Een verblijfsvergunning geeft niet-EU/EER-burgers het recht om in Nederland te verblijven. Er zijn tijdelijke en permanente vergunningen. IND (Immigratie- en Naturalisatiedienst) beslist hierover." },
  { id: 141, theme: "🏛️ Overheid", question: "Wat is naturalisatie?", options: ["Het officieel worden van Nederlander na aan bepaalde voorwaarden te voldoen.", "Het aanvragen van een tijdelijke verblijfsvergunning.", "Het inburgeringsexamen afleggen.", "Het leren van de Nederlandse taal."], answer: 0, explanation: "Naturalisatie is het verkrijgen van de Nederlandse nationaliteit. Vereisten zijn o.a.: minimaal 5 jaar legaal wonen in Nederland, inburgeringsdiploma, geen ernstige strafblad." },
  { id: 142, theme: "🏛️ Overheid", question: "Wat doet de IND?", options: ["De IND regelt belastingen voor buitenlanders.", "De IND beoordeelt aanvragen voor verblijfsvergunningen en naturalisatie.", "De IND helpt inburgeraars met hun examen.", "De IND geeft rijbewijzen uit aan buitenlandse bestuurders."], answer: 1, explanation: "De IND (Immigratie- en Naturalisatiedienst) beslist over verblijfsaanvragen, asielaanvragen en naturalisatieverzoeken in Nederland." },

  // ── KINDEREN & GEZIN ─────────────────────────────────────────────────────────
  { id: 143, theme: "🎓 Onderwijs", question: "Wat is jeugdzorg?", options: ["Een sport- en recreatieprogramma voor kinderen.", "Hulp en ondersteuning voor kinderen en jongeren met problemen in hun opvoeding, gezin of ontwikkeling.", "Onderwijs voor kinderen met een beperking.", "Kinderopvang gefinancierd door de gemeente."], answer: 1, explanation: "Jeugdzorg biedt hulp aan kinderen (0–18 jaar) en hun gezinnen bij opvoedings- en ontwikkelingsproblemen. De gemeente regelt de toegang tot jeugdzorg." },
  { id: 144, theme: "🎓 Onderwijs", question: "Wat is het Centrum voor Jeugd en Gezin (CJG)?", options: ["Een school voor kinderen met gedragsproblemen.", "Een gemeentelijke instelling met informatie en hulp voor ouders, kinderen en jongeren.", "Een kinderopvangorganisatie.", "Een rechtbank voor jeugdzaken."], answer: 1, explanation: "Het CJG is een laagdrempelig centrum in vrijwel elke gemeente waar ouders, kinderen en jongeren terecht kunnen met vragen over opvoeding, gezondheid en ontwikkeling." },
  { id: 145, theme: "🎓 Onderwijs", question: "Wat is een peuterspeelzaal of kinderdagverblijf?", options: ["Een school voor kinderen van 4–6 jaar.", "Opvang voor jonge kinderen (0–4 jaar) waar ze spelen en zich ontwikkelen.", "Een basisschool voor kinderen met een taalachterstand.", "Een school voor kinderen die extra ondersteuning nodig hebben."], answer: 1, explanation: "Een kinderdagverblijf (KDV) is voor kinderen van 0–4 jaar. De peuterspeelzaal is voor 2–4-jarigen. Beide zijn gericht op spelen en sociale ontwikkeling voor de basisschool." },

  // ── VEILIGHEID & RECHT ───────────────────────────────────────────────────────
  { id: 146, theme: "🏛️ Overheid", question: "Wat is fraude?", options: ["Een meningsverschil met de belastingdienst.", "Het opzettelijk misleiden of bedriegen om voordeel te behalen, bijvoorbeeld het invullen van valse informatie.", "Een te late belastingbetaling.", "Het niet naleven van een huurcontract."], answer: 1, explanation: "Fraude is opzettelijk bedrog om geld of voordelen te krijgen waar u geen recht op heeft, zoals uitkeringsfraude, belastingfraude of identiteitsfraude. Het is strafbaar." },
  { id: 147, theme: "🏛️ Overheid", question: "Wat is huiselijk geweld en waar kunt u terecht?", options: ["Geweld door buren; u belt de politie.", "Geweld of mishandeling binnen een gezin of relatie; u kunt bellen met Veilig Thuis (0800-2000).", "Problemen tussen buren over geluidsoverlast.", "Alleen lichamelijk geweld telt als huiselijk geweld."], answer: 1, explanation: "Huiselijk geweld is geweld door iemand in de huiselijke kring: partner, familielid. U kunt 24/7 bellen met Veilig Thuis (0800-2000) voor advies, hulp en aangifte." },
  { id: 148, theme: "🏛️ Overheid", question: "Wat is de maximumsnelheid op de snelweg in Nederland?", options: ["100 km/u altijd.", "120 km/u overdag, 100 km/u 's nachts op sommige wegen.", "130 km/u altijd.", "Afhankelijk van de weg: 100 of 130 km/u."], answer: 3, explanation: "De maximumsnelheid op Nederlandse snelwegen is 100 km/u overdag (06:00–19:00) op de meeste wegen en 130 km/u op sommige wegen 's avonds en 's nachts. Borden geven de exacte limiet aan." },

  // ── SOCIALE ZEKERHEID VERDIEPT ──────────────────────────────────────────────
  { id: 149, theme: "💼 Werk & Inkomen", question: "Wat is een uitzendbureau?", options: ["Een bureau dat vakantiewoningen verhuurt.", "Een bedrijf dat tijdelijk personeel levert aan werkgevers.", "Een overheidsinstantie die werklozen begeleidt.", "Een bureau dat visa regelt voor buitenlandse werknemers."], answer: 1, explanation: "Een uitzendbureau (of uitzendorganisatie) matcht werknemers aan werkgevers voor tijdelijk werk. U heeft een arbeidscontract met het uitzendbureau, niet met het bedrijf waar u werkt." },
  { id: 150, theme: "💼 Werk & Inkomen", question: "Wat is een proeftijd in een arbeidscontract?", options: ["De periode waarover vakantiegeld wordt berekend.", "Een korte periode aan het begin van een dienstverband waarbij beide partijen het contract kunnen beëindigen zonder opzegtermijn.", "De periode dat u recht heeft op WW als u ontslagen wordt.", "De tijd die u krijgt om het werk te leren."], answer: 1, explanation: "Een proeftijd duurt maximaal 1 maand bij tijdelijke contracten en maximaal 2 maanden bij vaste contracten. Tijdens de proeftijd mag de werkgever u ontslaan zonder opzegtermijn." },
  { id: 151, theme: "💼 Werk & Inkomen", question: "Wat is cao?", options: ["Een soort arbeidscontract voor zelfstandigen.", "Een collectieve arbeidsovereenkomst met afspraken over lonen en arbeidsvoorwaarden voor een hele sector.", "Een cursus voor werklozen.", "Een contract met het uitzendbureau."], answer: 1, explanation: "De cao (collectieve arbeidsovereenkomst) wordt afgesloten tussen werkgevers(organisaties) en vakbonden. Hierin staan afspraken over loon, werktijden, vakantiedagen en meer voor een hele bedrijfstak." },
  { id: 152, theme: "💼 Werk & Inkomen", question: "Wat doet een vakbond?", options: ["Een vakbond geeft beroepsopleidingen.", "Een vakbond behartigt de belangen van werknemers en onderhandelt met werkgevers over arbeidsvoorwaarden.", "Een vakbond int belastingen voor de overheid.", "Een vakbond controleert of bedrijven zich aan de wet houden."], answer: 1, explanation: "Een vakbond (zoals FNV of CNV) vertegenwoordigt werknemers en onderhandelt met werkgevers over lonen en arbeidsomstandigheden. Leden kunnen juridische hulp krijgen bij problemen op het werk." },

  // ── GEOGRAFIE & CULTUUR VERDIEPT ────────────────────────────────────────────
  { id: 153, theme: "🌷 Dit is Nederland", question: "Wat is de grootste stad van Nederland?", options: ["Den Haag.", "Rotterdam.", "Amsterdam.", "Utrecht."], answer: 2, explanation: "Amsterdam is zowel de hoofdstad als de grootste stad van Nederland qua bevolking. Rotterdam is de grootste haven van Europa en de tweede stad van Nederland." },
  { id: 154, theme: "🌷 Dit is Nederland", question: "Wat is typisch voor het Nederlandse landschap?", options: ["Hoge bergen en diepe valleien.", "Vlak land, polders, dijken, windmolens en veel water.", "Uitgestrekte woestijnen en droog klimaat.", "Tropisch regenwoud en kustlijnen."], answer: 1, explanation: "Nederland is bekend om zijn vlakke landschap, polders (drooggelegde gebieden), dijken, kanalen, windmolens en tulpenvelden. Het land wordt ook wel 'de lage landen' genoemd." },
  { id: 155, theme: "🌷 Dit is Nederland", question: "Wat is de officiële taal van Nederland?", options: ["Duits en Nederlands.", "Nederlands (en Fries in de provincie Friesland).", "Alleen Nederlands.", "Nederlands, Fries en Papiaments."], answer: 1, explanation: "De officiële taal is Nederlands. In de provincie Friesland is Fries ook een erkende officiële taal. In het Caribisch deel van het Koninkrijk wordt ook Papiaments en Engels gesproken." },
  { id: 156, theme: "🌷 Dit is Nederland", question: "Wat is Prinsjesdag?", options: ["De verjaardag van de Koning.", "De dag waarop de Koning de troonrede voorleest en het kabinet de begroting presenteert, elk jaar op de derde dinsdag van september.", "De dag waarop nieuwe ministers worden benoemd.", "Een nationale feestdag in november."], answer: 1, explanation: "Op Prinsjesdag (derde dinsdag van september) rijdt de Koning in de Gouden Koets naar de Ridderzaal in Den Haag en leest de troonrede voor. Het kabinet presenteert ook de begroting." },
  { id: 157, theme: "🌷 Dit is Nederland", question: "Wat is Kerst in Nederland?", options: ["Alleen 25 december.", "25 en 26 december – eerste en tweede Kerstdag.", "24 december (Kerstavond) en 25 december.", "24, 25 en 26 december – drie Kerstdagen."], answer: 1, explanation: "In Nederland zijn zowel 25 december (eerste Kerstdag) als 26 december (tweede Kerstdag) officiële nationale feestdagen." },
  { id: 158, theme: "🌷 Dit is Nederland", question: "Wat is Nieuwjaarsdag?", options: ["1 december.", "31 december.", "1 januari.", "2 januari."], answer: 2, explanation: "Nieuwjaarsdag is 1 januari en is een officiële nationale feestdag in Nederland. Op oudejaarsavond (31 december) worden vuurwerk en oliebollen geassocieerd met de jaarwisseling." },
  { id: 159, theme: "🌷 Dit is Nederland", question: "Wat is Hemelvaartsdag?", options: ["Een feestdag 40 dagen na Pasen, altijd op donderdag.", "Een feestdag 50 dagen na Pasen.", "De verjaardag van de Koningin.", "Een regionale feestdag in Noord-Brabant."], answer: 0, explanation: "Hemelvaartsdag valt altijd op een donderdag, 40 dagen na Pasen. Het is een christelijke feestdag en een nationale vrije dag in Nederland." },
  { id: 160, theme: "🌷 Dit is Nederland", question: "Wat zijn de Deltawerken?", options: ["Een netwerk van autosnelwegen in het zuiden van Nederland.", "Een systeem van dammen, sluizen en stormvloedkeringen dat Zeeland en Zuid-Holland beschermt tegen overstromingen.", "Een waterleiding die drinkwater van de rivieren naar steden transporteert.", "Havenfaciliteiten in Rotterdam voor de scheepvaart."], answer: 1, explanation: "De Deltawerken zijn een reeks waterbouwkundige werken in Zeeland en Zuid-Holland, gebouwd na de watersnoodramp van 1953. De Maeslantkering bij Rotterdam is een van de bekendste onderdelen." },
];

const THEME_COLORS = {
  "🏥 Gezondheid": "#e74c3c",
  "🎓 Onderwijs": "#3498db",
  "💼 Werk & Inkomen": "#27ae60",
  "🏠 Wonen": "#e67e22",
  "🏛️ Overheid": "#8e44ad",
  "🤝 Normen & Waarden": "#16a085",
  "💻 Digitalisering": "#2980b9",
  "🌷 Dit is Nederland": "#c0392b",
  "🏢 Instanties": "#d35400",
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function KNMExam() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 600;
  const [mode, setMode] = useState("menu"); // menu | exam | results
  const [selectedTheme, setSelectedTheme] = useState("all");
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState([]);
  const [showExplanation, setShowExplanation] = useState(false);

  const themes = ["all", ...Object.keys(THEME_COLORS)];

  const startExam = useCallback(() => {
    const pool = selectedTheme === "all"
      ? allQuestions
      : allQuestions.filter(q => q.theme === selectedTheme);
    const shuffled = shuffle(pool).map(q => ({
      ...q,
      shuffledOptions: shuffle(q.options.map((o, i) => ({ text: o, originalIndex: i }))),
    }));
    setQuestions(shuffled);
    setCurrent(0);
    setSelected(null);
    setAnswered(false);
    setScore(0);
    setWrong([]);
    setShowExplanation(false);
    setMode("exam");
  }, [selectedTheme]);

  const handleOption = (shuffledIndex) => {
    if (answered) return;
    const q = questions[current];
    const originalIndex = q.shuffledOptions[shuffledIndex].originalIndex;
    setSelected(shuffledIndex);
    setAnswered(true);
    if (originalIndex === q.answer) {
      setScore(s => s + 1);
    } else {
      setWrong(w => [...w, { ...q, chosen: shuffledIndex }]);
    }
    setShowExplanation(false);
  };

  const next = () => {
    if (current + 1 >= questions.length) {
      setMode("results");
    } else {
      setCurrent(c => c + 1);
      setSelected(null);
      setAnswered(false);
      setShowExplanation(false);
    }
  };

  const q = questions[current];
  const progress = questions.length ? ((current + (answered ? 1 : 0)) / questions.length) * 100 : 0;
  const grade = questions.length ? Math.round((score / questions.length) * 9 + 1) : 0;
  const passed = score >= Math.ceil(questions.length * 0.65);

  const styles = {
    root: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a1628 0%, #1a2a4a 50%, #0d1f3c 100%)",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "0",
      overflowX: "hidden",
      WebkitTextSizeAdjust: "100%",
    },
    header: {
      width: "100%",
      background: "rgba(255,255,255,0.04)",
      borderBottom: "1px solid rgba(255,159,10,0.2)",
      padding: isMobile ? "14px 16px" : "20px 32px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      boxSizing: "border-box",
    },
    flagStripe: {
      display: "flex",
      flexDirection: "column",
      width: "32px",
      height: "32px",
      borderRadius: "3px",
      overflow: "hidden",
      boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
    },
    titleBox: { flex: 1, minWidth: 0 },
    title: {
      margin: 0,
      fontSize: isMobile ? "16px" : "22px",
      fontWeight: "700",
      color: "#fff",
      letterSpacing: "0.5px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    subtitle: {
      margin: "2px 0 0",
      fontSize: isMobile ? "10px" : "12px",
      color: "rgba(255,255,255,0.5)",
      letterSpacing: "1px",
      textTransform: "uppercase",
      fontFamily: "'Arial', sans-serif",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    container: {
      width: "100%",
      maxWidth: "760px",
      padding: isMobile ? "16px 12px 60px" : "32px 20px 60px",
      boxSizing: "border-box",
    },

    // MENU
    menuCard: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "16px",
      padding: isMobile ? "20px 16px" : "36px",
      WebkitBackdropFilter: "blur(10px)",
      backdropFilter: "blur(10px)",
    },
    menuTitle: {
      color: "#fff",
      fontSize: isMobile ? "20px" : "26px",
      margin: "0 0 8px",
      fontWeight: "700",
    },
    menuDesc: {
      color: "rgba(255,255,255,0.55)",
      fontSize: "14px",
      margin: "0 0 32px",
      lineHeight: "1.6",
      fontFamily: "'Arial', sans-serif",
    },
    label: {
      display: "block",
      color: "rgba(255,255,255,0.7)",
      fontSize: "12px",
      letterSpacing: "1px",
      textTransform: "uppercase",
      marginBottom: "10px",
      fontFamily: "'Arial', sans-serif",
    },
    select: {
      width: "100%",
      padding: isMobile ? "12px 14px" : "14px 16px",
      borderRadius: "10px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "rgba(0,0,0,0.3)",
      color: "#fff",
      fontSize: isMobile ? "14px" : "15px",
      marginBottom: "24px",
      outline: "none",
      fontFamily: "'Arial', sans-serif",
      cursor: "pointer",
      WebkitAppearance: "none",
      appearance: "none",
      boxSizing: "border-box",
    },
    statsRow: {
      display: "flex",
      gap: "10px",
      marginBottom: "24px",
      flexWrap: "wrap",
    },
    statBox: {
      flex: 1,
      minWidth: "80px",
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px",
      padding: isMobile ? "12px 8px" : "16px",
      textAlign: "center",
    },
    statNum: {
      fontSize: isMobile ? "22px" : "28px",
      fontWeight: "700",
      color: "#ff9f0a",
      display: "block",
    },
    statLabel: {
      fontSize: "11px",
      color: "rgba(255,255,255,0.5)",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      fontFamily: "'Arial', sans-serif",
    },
    startBtn: {
      width: "100%",
      padding: "16px",
      minHeight: "52px",
      background: "linear-gradient(135deg, #ff9f0a, #ff6b35)",
      border: "none",
      borderRadius: "12px",
      color: "#fff",
      fontSize: isMobile ? "16px" : "18px",
      fontWeight: "700",
      cursor: "pointer",
      letterSpacing: "0.5px",
      boxShadow: "0 4px 20px rgba(255,159,10,0.3)",
      transition: "all 0.2s",
      touchAction: "manipulation",
    },

    // EXAM
    progressWrap: {
      marginBottom: "28px",
    },
    progressRow: {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: "8px",
      fontFamily: "'Arial', sans-serif",
    },
    progressLabel: { color: "rgba(255,255,255,0.6)", fontSize: "13px" },
    progressScore: { color: "#ff9f0a", fontSize: "13px", fontWeight: "700" },
    progressBar: {
      height: "6px",
      background: "rgba(255,255,255,0.1)",
      borderRadius: "3px",
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: "3px",
      background: "linear-gradient(90deg, #ff9f0a, #ff6b35)",
      transition: "width 0.4s ease",
    },
    questionCard: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "16px",
      padding: isMobile ? "16px" : "32px",
      WebkitBackdropFilter: "blur(10px)",
      backdropFilter: "blur(10px)",
      marginBottom: "12px",
    },
    themeTag: (theme) => ({
      display: "inline-block",
      padding: "4px 12px",
      borderRadius: "20px",
      fontSize: "12px",
      fontWeight: "600",
      marginBottom: "16px",
      fontFamily: "'Arial', sans-serif",
      background: `${THEME_COLORS[theme] || "#555"}22`,
      color: THEME_COLORS[theme] || "#aaa",
      border: `1px solid ${THEME_COLORS[theme] || "#555"}44`,
    }),
    questionText: {
      color: "#fff",
      fontSize: isMobile ? "16px" : "20px",
      lineHeight: "1.55",
      margin: 0,
      wordBreak: "break-word",
    },
    optionsGrid: {
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      marginBottom: "20px",
    },
    optionBtn: (state) => {
      const base = {
        padding: isMobile ? "13px 14px" : "16px 20px",
        minHeight: "52px",
        borderRadius: "12px",
        border: "2px solid",
        cursor: answered ? "default" : "pointer",
        textAlign: "left",
        fontSize: isMobile ? "14px" : "15px",
        fontFamily: "'Arial', sans-serif",
        lineHeight: "1.45",
        transition: "all 0.2s",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        wordBreak: "break-word",
        overflowWrap: "break-word",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      };
      if (state === "correct") return { ...base, background: "rgba(39,174,96,0.15)", borderColor: "#27ae60", color: "#2ecc71" };
      if (state === "wrong") return { ...base, background: "rgba(231,76,60,0.15)", borderColor: "#e74c3c", color: "#ff6b6b" };
      if (state === "reveal") return { ...base, background: "rgba(39,174,96,0.08)", borderColor: "rgba(39,174,96,0.4)", color: "rgba(255,255,255,0.7)" };
      return { ...base, background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" };
    },
    optionLetter: (state) => ({
      width: "28px",
      height: "28px",
      minWidth: "28px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "13px",
      fontWeight: "700",
      flexShrink: 0,
      marginTop: "1px",
      background: state === "correct" ? "#27ae60" : state === "wrong" ? "#e74c3c" : state === "reveal" ? "rgba(39,174,96,0.3)" : "rgba(255,255,255,0.1)",
      color: "#fff",
    }),
    explanationBox: {
      background: "rgba(255,159,10,0.08)",
      border: "1px solid rgba(255,159,10,0.25)",
      borderRadius: "12px",
      padding: "16px 20px",
      marginBottom: "16px",
    },
    explanationLabel: {
      color: "#ff9f0a",
      fontSize: "11px",
      fontWeight: "700",
      letterSpacing: "1px",
      textTransform: "uppercase",
      fontFamily: "'Arial', sans-serif",
      marginBottom: "8px",
    },
    explanationText: {
      color: "rgba(255,255,255,0.8)",
      fontSize: "14px",
      lineHeight: "1.6",
      margin: 0,
      fontFamily: "'Arial', sans-serif",
    },
    btnRow: {
      display: "flex",
      gap: "10px",
      flexDirection: isMobile ? "column" : "row",
    },
    explainBtn: {
      flex: 1,
      padding: "14px",
      minHeight: "48px",
      background: "rgba(255,159,10,0.1)",
      border: "1px solid rgba(255,159,10,0.3)",
      borderRadius: "10px",
      color: "#ff9f0a",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "'Arial', sans-serif",
      touchAction: "manipulation",
    },
    nextBtn: {
      flex: isMobile ? "none" : 2,
      padding: "14px",
      minHeight: "48px",
      background: "linear-gradient(135deg, #ff9f0a, #ff6b35)",
      border: "none",
      borderRadius: "10px",
      color: "#fff",
      fontSize: "16px",
      fontWeight: "700",
      cursor: "pointer",
      fontFamily: "'Arial', sans-serif",
      touchAction: "manipulation",
    },

    // RESULTS
    resultCard: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "16px",
      padding: isMobile ? "24px 16px" : "36px",
      textAlign: "center",
      WebkitBackdropFilter: "blur(10px)",
      backdropFilter: "blur(10px)",
      marginBottom: "20px",
    },
    resultGrade: (pass) => ({
      fontSize: isMobile ? "56px" : "72px",
      fontWeight: "700",
      color: pass ? "#27ae60" : "#e74c3c",
      lineHeight: 1,
      margin: "8px 0",
    }),
    resultStatus: (pass) => ({
      display: "inline-block",
      padding: "6px 20px",
      borderRadius: "20px",
      fontSize: "14px",
      fontWeight: "700",
      letterSpacing: "1px",
      fontFamily: "'Arial', sans-serif",
      background: pass ? "rgba(39,174,96,0.15)" : "rgba(231,76,60,0.15)",
      color: pass ? "#2ecc71" : "#ff6b6b",
      border: pass ? "1px solid #27ae6044" : "1px solid #e74c3c44",
      marginBottom: "20px",
    }),
    resultStats: {
      display: "flex",
      gap: "16px",
      justifyContent: "center",
      marginTop: "20px",
      flexWrap: "wrap",
    },
    resultStat: {
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px",
      padding: "16px 24px",
      textAlign: "center",
    },
    wrongList: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "16px",
      padding: "24px",
      marginBottom: "20px",
    },
    wrongTitle: {
      color: "#fff",
      fontSize: "16px",
      margin: "0 0 20px",
      fontWeight: "700",
    },
    wrongItem: {
      padding: "16px",
      borderRadius: "10px",
      background: "rgba(231,76,60,0.08)",
      border: "1px solid rgba(231,76,60,0.2)",
      marginBottom: "12px",
    },
    wrongQ: {
      color: "rgba(255,255,255,0.9)",
      fontSize: "14px",
      marginBottom: "8px",
      fontFamily: "'Arial', sans-serif",
    },
    wrongCorrect: {
      color: "#2ecc71",
      fontSize: "13px",
      fontFamily: "'Arial', sans-serif",
    },
    retryBtn: {
      width: "100%",
      padding: "16px",
      background: "linear-gradient(135deg, #ff9f0a, #ff6b35)",
      border: "none",
      borderRadius: "12px",
      color: "#fff",
      fontSize: "18px",
      fontWeight: "700",
      cursor: "pointer",
      marginBottom: "12px",
      fontFamily: "'Arial', sans-serif",
    },
    menuBtn: {
      width: "100%",
      padding: "14px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "12px",
      color: "rgba(255,255,255,0.8)",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "'Arial', sans-serif",
    },
  };

  const letters = ["A", "B", "C", "D"];

  const getOptionState = (shuffledIndex) => {
    if (!answered) return "neutral";
    const q = questions[current];
    const originalIndex = q.shuffledOptions[shuffledIndex].originalIndex;
    if (originalIndex === q.answer) return selected === shuffledIndex ? "correct" : "reveal";
    if (selected === shuffledIndex) return "wrong";
    return "neutral";
  };

  const poolCount = selectedTheme === "all"
    ? allQuestions.length
    : allQuestions.filter(q => q.theme === selectedTheme).length;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.flagStripe}>
          <div style={{ flex: 1, background: "#AE1C28" }} />
          <div style={{ flex: 1, background: "#FFFFFF" }} />
          <div style={{ flex: 1, background: "#21468B" }} />
        </div>
        <div style={styles.titleBox}>
          <h1 style={styles.title}>KNM Oefenexamen</h1>
          <p style={styles.subtitle}>Kennis van de Nederlandse Maatschappij · A2</p>
        </div>
        {mode === "exam" && (
          <button onClick={() => setMode("menu")} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontFamily: "'Arial', sans-serif" }}>
            ← Menu
          </button>
        )}
      </div>

      <div style={styles.container}>
        {/* ── MENU ── */}
        {mode === "menu" && (
          <div style={styles.menuCard}>
            <h2 style={styles.menuTitle}>Kies uw oefensessie</h2>
            <p style={styles.menuDesc}>
              Oefen met {allQuestions.length} examenvragen verdeeld over alle KNM-thema's.
              Kies een thema of oefen met alle vragen door elkaar.
              U heeft 26 van de 40 vragen goed nodig om te slagen (65%).
            </p>
            <label style={styles.label}>Selecteer thema</label>
            <select
              style={styles.select}
              value={selectedTheme}
              onChange={e => setSelectedTheme(e.target.value)}
            >
              <option value="all">Alle thema's ({allQuestions.length} vragen)</option>
              {Object.keys(THEME_COLORS).map(t => (
                <option key={t} value={t}>
                  {t} ({allQuestions.filter(q => q.theme === t).length} vragen)
                </option>
              ))}
            </select>
            <div style={styles.statsRow}>
              <div style={styles.statBox}>
                <span style={styles.statNum}>{poolCount}</span>
                <span style={styles.statLabel}>Vragen</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statNum}>45</span>
                <span style={styles.statLabel}>Min (echt examen)</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statNum}>65%</span>
                <span style={styles.statLabel}>Slagingspercentage</span>
              </div>
            </div>
            <button style={styles.startBtn} onClick={startExam}>
              Start oefenexamen →
            </button>
          </div>
        )}

        {/* ── EXAM ── */}
        {mode === "exam" && q && (
          <>
            <div style={styles.progressWrap}>
              <div style={styles.progressRow}>
                <span style={styles.progressLabel}>Vraag {current + 1} van {questions.length}</span>
                <span style={styles.progressScore}>✓ {score} goed</span>
              </div>
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: `${progress}%` }} />
              </div>
            </div>

            <div style={styles.questionCard}>
              <div style={styles.themeTag(q.theme)}>{q.theme}</div>
              <p style={styles.questionText}>{q.question}</p>
            </div>

            <div style={styles.optionsGrid}>
              {q.shuffledOptions.map((opt, i) => {
                const state = getOptionState(i);
                return (
                  <button
                    key={i}
                    style={styles.optionBtn(state)}
                    onClick={() => handleOption(i)}
                  >
                    <span style={styles.optionLetter(state)}>{letters[i]}</span>
                    {opt.text}
                  </button>
                );
              })}
            </div>

            {answered && showExplanation && (
              <div style={styles.explanationBox}>
                <div style={styles.explanationLabel}>💡 Uitleg</div>
                <p style={styles.explanationText}>{q.explanation}</p>
              </div>
            )}

            {answered && (
              <div style={styles.btnRow}>
                <button style={styles.explainBtn} onClick={() => setShowExplanation(e => !e)}>
                  {showExplanation ? "Verberg uitleg" : "Toon uitleg"}
                </button>
                <button style={styles.nextBtn} onClick={next}>
                  {current + 1 >= questions.length ? "Bekijk resultaten →" : "Volgende vraag →"}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── RESULTS ── */}
        {mode === "results" && (
          <>
            <div style={styles.resultCard}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", fontFamily: "'Arial', sans-serif" }}>Uw eindcijfer</div>
              <div style={styles.resultGrade(passed)}>{grade}</div>
              <div style={styles.resultStatus(passed)}>
                {passed ? "✓ GESLAAGD" : "✗ NIET GESLAAGD"}
              </div>
              <p style={{ color: "rgba(255,255,255,0.55)", fontSize: "14px", fontFamily: "'Arial', sans-serif", margin: 0 }}>
                {passed
                  ? "Goed gedaan! U heeft de slagingsgrens gehaald."
                  : `U had ${Math.ceil(questions.length * 0.65)} vragen goed nodig. Blijf oefenen!`}
              </p>
              <div style={styles.resultStats}>
                <div style={styles.resultStat}>
                  <span style={{ ...styles.statNum, color: "#2ecc71" }}>{score}</span>
                  <span style={styles.statLabel}>Goed</span>
                </div>
                <div style={styles.resultStat}>
                  <span style={{ ...styles.statNum, color: "#e74c3c" }}>{questions.length - score}</span>
                  <span style={styles.statLabel}>Fout</span>
                </div>
                <div style={styles.resultStat}>
                  <span style={{ ...styles.statNum, color: "#ff9f0a" }}>{Math.round((score / questions.length) * 100)}%</span>
                  <span style={styles.statLabel}>Score</span>
                </div>
              </div>
            </div>

            {wrong.length > 0 && (
              <div style={styles.wrongList}>
                <h3 style={styles.wrongTitle}>❌ Foute antwoorden — leer hiervan</h3>
                {wrong.map((w, i) => (
                  <div key={i} style={styles.wrongItem}>
                    <div style={styles.wrongQ}><strong>{w.theme}</strong> — {w.question}</div>
                    <div style={styles.wrongCorrect}>✓ Juist antwoord: {w.options[w.answer]}</div>
                    <div style={{ ...styles.explanationText, marginTop: "6px", fontSize: "12px" }}>{w.explanation}</div>
                  </div>
                ))}
              </div>
            )}

            <button style={styles.retryBtn} onClick={startExam}>
              🔄 Opnieuw oefenen
            </button>
            <button style={styles.menuBtn} onClick={() => setMode("menu")}>
              ← Terug naar menu
            </button>
          </>
        )}
      </div>
    </div>
  );
}
