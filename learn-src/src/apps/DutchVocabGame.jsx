import { useState, useEffect, useCallback, useRef } from "react";

const WORD_BANK = {
  easy: [
    { dutch: "de", english: "the" },
    { dutch: "en", english: "and" },
    { dutch: "een", english: "a" },
    { dutch: "het", english: "it" },
    { dutch: "in", english: "in" },
    { dutch: "te", english: "too" },
    { dutch: "ik", english: "I" },
    { dutch: "hebben", english: "to have" },
    { dutch: "hij", english: "he" },
    { dutch: "niet", english: "not" },
    { dutch: "op", english: "on" },
    { dutch: "dat", english: "that" },
    { dutch: "voor", english: "before" },
    { dutch: "er", english: "there" },
    { dutch: "je", english: "you" },
    { dutch: "zullen", english: "shall" },
    { dutch: "kunnen", english: "can/to be able to" },
    { dutch: "haar", english: "her" },
    { dutch: "of", english: "or" },
    { dutch: "wat", english: "what" },
    { dutch: "gaan", english: "to go" },
    { dutch: "hem", english: "him" },
    { dutch: "komen", english: "come" },
    { dutch: "dan", english: "then" },
    { dutch: "zo", english: "so" },
    { dutch: "moeten", english: "should" },
    { dutch: "mijn", english: "my" },
    { dutch: "zij", english: "she" },
    { dutch: "deze", english: "this" },
    { dutch: "we", english: "we" },
    { dutch: "meer", english: "more" },
    { dutch: "dit", english: "this" },
    { dutch: "maken", english: "to make" },
    { dutch: "staan", english: "stand" },
    { dutch: "goed", english: "good" },
    { dutch: "ander", english: "other" },
    { dutch: "doen", english: "to do" },
    { dutch: "me", english: "me" },
    { dutch: "u", english: "you" },
    { dutch: "mij", english: "me" },
    { dutch: "laten", english: "to let" },
    { dutch: "al", english: "already" },
    { dutch: "daar", english: "there" },
    { dutch: "denken", english: "to think" },
    { dutch: "toen", english: "then (past)" },
    { dutch: "geven", english: "to give" },
    { dutch: "hoe", english: "how" },
    { dutch: "nu", english: "now" },
    { dutch: "vinden", english: "find" },
    { dutch: "man", english: "man" },
    { dutch: "jaar", english: "year" },
    { dutch: "hier", english: "here" },
    { dutch: "wij", english: "we" },
    { dutch: "houden", english: "to keep" },
    { dutch: "zitten", english: "to sit" },
    { dutch: "hand", english: "hand" },
    { dutch: "lang", english: "long" },
    { dutch: "twee", english: "two" },
    { dutch: "dag", english: "day" },
    { dutch: "eerst", english: "first" },
    { dutch: "alleen", english: "only" },
    { dutch: "brengen", english: "bring" },
    { dutch: "beginnen", english: "to begin" },
    { dutch: "zelf", english: "self" },
    { dutch: "horen", english: "to hear" },
    { dutch: "nieuw", english: "new" },
    { dutch: "laat", english: "late" },
    { dutch: "voelen", english: "to feel" },
    { dutch: "plaats", english: "place" },
    { dutch: "leven", english: "life" },
    { dutch: "huis", english: "house" },
    { dutch: "vallen", english: "fall" },
    { dutch: "moeder", english: "mother" },
    { dutch: "spreken", english: "to speak" },
    { dutch: "woord", english: "word" },
    { dutch: "ja", english: "yes" },
    { dutch: "wanneer", english: "when" },
    { dutch: "vader", english: "father" },
    { dutch: "werk", english: "work" },
    { dutch: "elk", english: "each" },
    { dutch: "ver", english: "far" },
    { dutch: "later", english: "later" },
    { dutch: "vertellen", english: "to tell" },
    { dutch: "jij", english: "you" },
    { dutch: "drie", english: "three" },
    { dutch: "oud", english: "old" },
    { dutch: "soms", english: "sometimes" },
    { dutch: "wereld", english: "world" },
    { dutch: "uur", english: "hour" },
    { dutch: "naam", english: "name" },
    { dutch: "soort", english: "kind" },
    { dutch: "werken", english: "to work" },
    { dutch: "vol", english: "full" },
    { dutch: "welk", english: "which" },
    { dutch: "boek", english: "book" },
    { dutch: "deur", english: "door" },
    { dutch: "ding", english: "thing" },
    { dutch: "nee", english: "no" },
    { dutch: "water", english: "water" },
    { dutch: "feit", english: "fact" },
    { dutch: "wachten", english: "to wait" },
    { dutch: "leren", english: "to learn" },
    { dutch: "open", english: "open" },
    { dutch: "probleem", english: "problem" },
    { dutch: "groep", english: "group" },
    { dutch: "jong", english: "young" },
    { dutch: "wit", english: "white" },
    { dutch: "zodat", english: "so that" },
    { dutch: "lachen", english: "laugh" },
    { dutch: "bed", english: "bed" },
    { dutch: "verder", english: "further" },
    { dutch: "moment", english: "moment" },
    { dutch: "staat", english: "state" },
    { dutch: "vriend", english: "friend" },
    { dutch: "week", english: "week" },
    { dutch: "laatste", english: "last" },
    { dutch: "helpen", english: "to help" },
    { dutch: "licht", english: "light" },
    { dutch: "diep", english: "deep" },
    { dutch: "nacht", english: "night" },
    { dutch: "langs", english: "along" },
    { dutch: "beide", english: "both" },
    { dutch: "jullie", english: "you" },
    { dutch: "vrij", english: "free" },
    { dutch: "gevoel", english: "feeling" },
    { dutch: "half", english: "half" },
    { dutch: "tafel", english: "table" },
    { dutch: "school", english: "school" },
    { dutch: "vier", english: "four" },
    { dutch: "dood", english: "death" },
    { dutch: "sociaal", english: "social" },
    { dutch: "hard", english: "hard" },
    { dutch: "wijn", english: "wine" },
    { dutch: "maand", english: "month" },
    { dutch: "mond", english: "mouth" },
    { dutch: "reden", english: "reason" },
    { dutch: "voet", english: "foot" },
    { dutch: "idee", english: "idea" },
    { dutch: "rol", english: "role" },
    { dutch: "jou", english: "you" },
    { dutch: "antwoord", english: "answer" },
    { dutch: "slapen", english: "to sleep" },
    { dutch: "plan", english: "plan" },
    { dutch: "meestal", english: "mostly" },
    { dutch: "straat", english: "street" },
    { dutch: "persoon", english: "person" },
    { dutch: "schouder", english: "shoulder" },
    { dutch: "luisteren", english: "listen" },
    { dutch: "invloed", english: "influence" },
    { dutch: "hart", english: "heart" },
    { dutch: "zoon", english: "son" },
    { dutch: "bezig", english: "busy" },
    { dutch: "arm", english: "arm" },
    { dutch: "tien", english: "ten" },
    { dutch: "los", english: "loose" },
    { dutch: "vijf", english: "five" },
    { dutch: "minuut", english: "minute" },
    { dutch: "liefde", english: "love" },
    { dutch: "sommige", english: "some" },
    { dutch: "direct", english: "directly" },
    { dutch: "relatie", english: "relationship" },
    { dutch: "systeem", english: "system" },
    { dutch: "proces", english: "process" },
    { dutch: "menen", english: "mean" },
    { dutch: "derde", english: "third" },
    { dutch: "drinken", english: "drink" },
    { dutch: "contact", english: "contact" },
    { dutch: "functie", english: "function" },
    { dutch: "warm", english: "warm" },
    { dutch: "vinger", english: "finger" },
    { dutch: "kleur", english: "color" },
    { dutch: "pijn", english: "pain" },
    { dutch: "glas", english: "glass" },
    { dutch: "artikel", english: "article" },
    { dutch: "eind", english: "end" },
    { dutch: "persoonlijk", english: "personally" },
    { dutch: "rood", english: "red" },
    { dutch: "dokter", english: "doctor" },
    { dutch: "zee", english: "sea" },
    { dutch: "groeien", english: "to grow" },
    { dutch: "koud", english: "cold" },
    { dutch: "leiden", english: "to lead" },
    { dutch: "familie", english: "family" },
    { dutch: "periode", english: "period" },
    { dutch: "sinds", english: "since" },
    { dutch: "resultaat", english: "result" },
    { dutch: "normaal", english: "normal" },
    { dutch: "rond", english: "round" },
    { dutch: "organisatie", english: "organization" },
    { dutch: "speciaal", english: "special" },
    { dutch: "patiënt", english: "patient" },
    { dutch: "broer", english: "brother" },
    { dutch: "leveren", english: "to deliver" },
    { dutch: "hopen", english: "to hope" },
    { dutch: "totaal", english: "total" },
    { dutch: "zes", english: "six" },
    { dutch: "blauw", english: "blue" },
    { dutch: "stap", english: "step" },
    { dutch: "karakter", english: "character" },
    { dutch: "theorie", english: "theory" },
    { dutch: "bloed", english: "blood" },
    { dutch: "beter", english: "better" },
    { dutch: "dochter", english: "daughter" },
    { dutch: "stappen", english: "to step" },
    { dutch: "droom", english: "dream" },
    { dutch: "meter", english: "meter" },
    { dutch: "steen", english: "stone" },
    { dutch: "hulp", english: "help" },
    { dutch: "rest", english: "rest" },
    { dutch: "muziek", english: "music" },
    { dutch: "maaltijd", english: "meal" },
    { dutch: "openen", english: "to open" },
    { dutch: "bank", english: "bank" },
    { dutch: "papier", english: "paper" },
    { dutch: "hoop", english: "hope" },
    { dutch: "minister", english: "minister" },
    { dutch: "wind", english: "wind" },
    { dutch: "koffie", english: "coffee" },
    { dutch: "stoppen", english: "stop" },
    { dutch: "oor", english: "ear" },
    { dutch: "informatie", english: "information" },
    { dutch: "methode", english: "method" },
    { dutch: "lip", english: "lip" },
    { dutch: "positie", english: "position" },
    { dutch: "alle", english: "all" },
    { dutch: "enorm", english: "enormous" },
    { dutch: "foto", english: "photo" },
    { dutch: "film", english: "movie" },
    { dutch: "activiteit", english: "activity" },
    { dutch: "modern", english: "modern" },
    { dutch: "geluk", english: "luck" },
    { dutch: "basis", english: "base" },
    { dutch: "zuster", english: "sister" },
    { dutch: "wakker", english: "awake" },
    { dutch: "tante", english: "aunt" },
    { dutch: "vuur", english: "fire" },
    { dutch: "prijs", english: "price" },
    { dutch: "reactie", english: "reaction" },
    { dutch: "praktijk", english: "practice" },
    { dutch: "neus", english: "nose" },
    { dutch: "terrein", english: "terrain" },
    { dutch: "koning", english: "king" },
    { dutch: "zingen", english: "to sing" },
    { dutch: "vliegen", english: "fly" },
    { dutch: "cultuur", english: "culture" },
    { dutch: "missen", english: "to miss" },
    { dutch: "politie", english: "law enforcement" },
    { dutch: "wensen", english: "to wish" },
    { dutch: "factor", english: "factor" },
    { dutch: "begin", english: "get started" },
    { dutch: "succes", english: "good luck" },
    { dutch: "kosten", english: "to cost" },
    { dutch: "natuur", english: "nature" },
    { dutch: "hotel", english: "hotel" },
    { dutch: "studie", english: "study" },
    { dutch: "vriendelijk", english: "friendly" },
    { dutch: "aspect", english: "aspect" },
    { dutch: "figuur", english: "figure" },
    { dutch: "ontbreken", english: "lack" },
    { dutch: "nationaal", english: "national" },
    { dutch: "ziek", english: "sick" },
    { dutch: "term", english: "term" },
    { dutch: "geef", english: "give" },
    { dutch: "rennen", english: "To run" },
    { dutch: "Engels", english: "english" },
    { dutch: "effect", english: "effect" },
    { dutch: "plant", english: "plant" },
    { dutch: "product", english: "product" },
    { dutch: "slaap", english: "sleep" },
    { dutch: "tekst", english: "text" },
    { dutch: "knie", english: "knee" },
    { dutch: "geboren", english: "born" },
    { dutch: "telefoon", english: "phone" },
    { dutch: "individueel", english: "individually" },
    { dutch: "structuur", english: "structure" },
    { dutch: "helft", english: "half" },
    { dutch: "trein", english: "train" },
    { dutch: "praktisch", english: "practical" },
    { dutch: "zomer", english: "summer" },
    { dutch: "winnen", english: "to win" },
    { dutch: "conclusie", english: "conclusion" },
    { dutch: "baby", english: "baby" },
    { dutch: "internationaal", english: "international" },
    { dutch: "eiland", english: "island" },
    { dutch: "meester", english: "master" },
    { dutch: "kwaliteit", english: "quality" },
    { dutch: "vullen", english: "to fill" },
    { dutch: "individu", english: "individual" },
    { dutch: "vervullen", english: "fulfill" },
    { dutch: "plaatsen", english: "place" },
    { dutch: "bespreken", english: "discuss" },
    { dutch: "discussie", english: "discussion" },
    { dutch: "sigaret", english: "cigarette" },
    { dutch: "vis", english: "fish" },
    { dutch: "absoluut", english: "absolutely" },
    { dutch: "historisch", english: "historical" },
    { dutch: "nummer", english: "number" },
    { dutch: "schaduw", english: "shadow" },
    { dutch: "leiding", english: "leadership" },
    { dutch: "kat", english: "cat" },
    { dutch: "universiteit", english: "university" },
    { dutch: "mezelf", english: "myself" },
    { dutch: "fase", english: "phase" },
    { dutch: "technisch", english: "technical" },
    { dutch: "positief", english: "positive" },
    { dutch: "programma", english: "program" },
    { dutch: "leider", english: "leader" },
    { dutch: "wapen", english: "weapon" },
    { dutch: "literatuur", english: "literature" },
    { dutch: "brood", english: "bread" },
    { dutch: "medisch", english: "medical" },
    { dutch: "officier", english: "officer" },
    { dutch: "rivier", english: "river" },
    { dutch: "dansen", english: "to dance" },
    { dutch: "interessant", english: "interesting" },
    { dutch: "markt", english: "market" },
    { dutch: "officieel", english: "officially" },
    { dutch: "baas", english: "boss" },
    { dutch: "schoen", english: "shoe" },
    { dutch: "boot", english: "boat" },
    { dutch: "vloer", english: "floor" },
    { dutch: "dromen", english: "to dream" },
    { dutch: "winter", english: "winter" },
    { dutch: "maan", english: "moon" },
    { dutch: "kilometer", english: "kilometers" },
    { dutch: "wens", english: "wish" },
    { dutch: "miljoen", english: "million" },
    { dutch: "seconde", english: "second" },
    { dutch: "rijk", english: "rich" },
    { dutch: "bier", english: "beer" },
    { dutch: "collega", english: "colleague" },
    { dutch: "actie", english: "action" },
    { dutch: "plezier", english: "pleasure" },
    { dutch: "psychologie", english: "psychology" },
    { dutch: "techniek", english: "technic" },
    { dutch: "vechten", english: "to fight" },
    { dutch: "gras", english: "grass" },
    { dutch: "pad", english: "path" },
    { dutch: "financieel", english: "financial" },
    { dutch: "beïnvloeden", english: "to influence" },
    { dutch: "actief", english: "active" },
    { dutch: "ster", english: "star" },
    { dutch: "machine", english: "machine" },
    { dutch: "energie", english: "energy" },
    { dutch: "gouden", english: "golden" },
    { dutch: "nek", english: "neck" },
    { dutch: "rusten", english: "to rest" },
    { dutch: "auteur", english: "author" },
    { dutch: "procent", english: "per cent" },
    { dutch: "museum", english: "museum" },
    { dutch: "realiseren", english: "realize" },
    { dutch: "cultureel", english: "cultural" },
    { dutch: "bus", english: "bus" },
    { dutch: "directeur", english: "director" },
    { dutch: "materiaal", english: "material" },
    { dutch: "produceren", english: "to produce" },
    { dutch: "veld", english: "field" },
    { dutch: "gast", english: "guest" },
    { dutch: "dubbel", english: "double" },
    { dutch: "zand", english: "sand" },
    { dutch: "centrum", english: "centre" },
    { dutch: "productie", english: "production" },
    { dutch: "westen", english: "west" },
    { dutch: "specifiek", english: "specific" },
    { dutch: "koel", english: "cool" },
    { dutch: "wassen", english: "To wash" },
    { dutch: "klant", english: "client" },
    { dutch: "tong", english: "tongue" },
    { dutch: "argument", english: "argument" },
    { dutch: "negatief", english: "negative" },
    { dutch: "kaas", english: "cheese" },
    { dutch: "titel", english: "title" },
    { dutch: "visie", english: "vision" },
    { dutch: "persoonlijkheid", english: "personality" },
    { dutch: "kust", english: "coast" },
    { dutch: "danken", english: "to thank" },
    { dutch: "radio", english: "radio" },
    { dutch: "wijd", english: "wide" },
    { dutch: "jezelf", english: "yourself" },
    { dutch: "interesseren", english: "to be interested" },
    { dutch: "olie", english: "oil" },
    { dutch: "thee", english: "tea" },
    { dutch: "risico", english: "risk" },
    { dutch: "president", english: "president" },
    { dutch: "groen", english: "green" },
    { dutch: "honger", english: "hungry" },
    { dutch: "traditioneel", english: "traditional" },
    { dutch: "adres", english: "address" },
    { dutch: "experiment", english: "experiment" },
    { dutch: "fundamenteel", english: "fundamentally" },
    { dutch: "advies", english: "advice" },
    { dutch: "klimmen", english: "to climb" },
    { dutch: "typisch", english: "typical" },
    { dutch: "stijl", english: "style" },
    { dutch: "top", english: "top" },
    { dutch: "traditie", english: "tradition" },
    { dutch: "heet", english: "hot" },
    { dutch: "psychologisch", english: "psychological" },
    { dutch: "computer", english: "computer" },
    { dutch: "generatie", english: "generation" },
    { dutch: "bodem", english: "bottom" },
    { dutch: "student", english: "student" },
    { dutch: "relatief", english: "relatively" },
    { dutch: "categorie", english: "category" },
    { dutch: "kalm", english: "calm" },
    { dutch: "eindigen", english: "to end" },
    { dutch: "goederen", english: "goods" },
    { dutch: "formuleren", english: "to formulate" },
    { dutch: "instrument", english: "instrument" },
    { dutch: "klas", english: "class" },
    { dutch: "combinatie", english: "combination" },
    { dutch: "publiceren", english: "to publish" },
    { dutch: "landschap", english: "landscape" },
    { dutch: "warmte", english: "warmth" },
    { dutch: "televisie", english: "television" },
    { dutch: "organiseren", english: "to organize" },
    { dutch: "patroon", english: "pattern" },
    { dutch: "agent", english: "agent" },
    { dutch: "emotie", english: "emotion" },
    { dutch: "orgaan", english: "organ" },
    { dutch: "provincie", english: "province" },
    { dutch: "detail", english: "detail" },
    { dutch: "restaurant", english: "restaurant" },
    { dutch: "wild", english: "wild" },
    { dutch: "pijnlijk", english: "painful" },
    { dutch: "station", english: "station" },
    { dutch: "klassiek", english: "classic" },
    { dutch: "sector", english: "sector" },
    { dutch: "eindeloos", english: "endless" },
    { dutch: "emotioneel", english: "emotional" },
    { dutch: "studeren", english: "to study" },
    { dutch: "symbool", english: "symbol" },
    { dutch: "luitenant", english: "lieutenant" },
    { dutch: "passeren", english: "pass" },
    { dutch: "motief", english: "motive" },
    { dutch: "fabriek", english: "factory" },
    { dutch: "lijst", english: "list" },
    { dutch: "serieus", english: "serious" },
    { dutch: "logisch", english: "logical" },
    { dutch: "mama", english: "mom" },
    { dutch: "vluchten", english: "to flee" },
    { dutch: "noorden", english: "north" },
    { dutch: "bijten", english: "to bite" },
    { dutch: "vorming", english: "formation" },
    { dutch: "café", english: "cafe" },
    { dutch: "object", english: "object" },
    { dutch: "Holland", english: "Holland" },
    { dutch: "kamp", english: "camp" },
    { dutch: "dun", english: "thin" },
    { dutch: "ideaal", english: "ideal" },
    { dutch: "juni", english: "june" },
    { dutch: "accepteren", english: "to accept" },
    { dutch: "initiatief", english: "initiative" },
    { dutch: "bitter", english: "bitter" },
    { dutch: "verspreiden", english: "to spread" },
    { dutch: "verbieden", english: "to forbid" },
    { dutch: "consequentie", english: "consequence" },
    { dutch: "oktober", english: "October" },
    { dutch: "westers", english: "western" },
    { dutch: "jongeman", english: "young man" },
    { dutch: "hoed", english: "hat" },
    { dutch: "zenden", english: "to send" },
    { dutch: "zondag", english: "sunday" },
    { dutch: "theoretisch", english: "theoretically" },
    { dutch: "psycholoog", english: "psychologist" },
    { dutch: "pers", english: "press" },
    { dutch: "terras", english: "terrace" },
    { dutch: "crisis", english: "crisis" },
    { dutch: "pot", english: "pot" },
    { dutch: "operatie", english: "operation" },
    { dutch: "partner", english: "partner" },
    { dutch: "suiker", english: "sugar" },
    { dutch: "gemeen", english: "mean" },
    { dutch: "plaat", english: "plate" },
    { dutch: "stijf", english: "stiff" },
    { dutch: "economie", english: "economy" },
    { dutch: "bruin", english: "brown" },
    { dutch: "sneeuw", english: "snow" },
    { dutch: "kruis", english: "cross" },
    { dutch: "automatisch", english: "automatically" },
    { dutch: "project", english: "project" },
    { dutch: "hut", english: "hut" },
    { dutch: "fruit", english: "fruit" },
    { dutch: "communicatie", english: "communication" },
    { dutch: "dom", english: "dumb" },  ],
  medium: [
    { dutch: "boom, de", english: "tree" },
    { dutch: "stoel, de", english: "chair" },
    { dutch: "van", english: "from / of" },
    { dutch: "zijn", english: "to be" },
    { dutch: "met", english: "with" },
    { dutch: "als", english: "if/when" },
    { dutch: "er", english: "there" },
    { dutch: "maar", english: "but" },
    { dutch: "om", english: "around" },
    { dutch: "naar", english: "to" },
    { dutch: "ook", english: "also" },
    { dutch: "bij", english: "at" },
    { dutch: "nog", english: "yet" },
    { dutch: "tot", english: "until" },
    { dutch: "ons/onze", english: "our" },
    { dutch: "veel", english: "many" },
    { dutch: "mens", english: "human" },
    { dutch: "toch", english: "however" },
    { dutch: "na", english: "after" },
    { dutch: "tijd", english: "time" },
    { dutch: "kind", english: "child" },
    { dutch: "vrouw", english: "woman" },
    { dutch: "oog", english: "eye" },
    { dutch: "dus", english: "so" },
    { dutch: "heel", english: "very" },
    { dutch: "even", english: "for a bit, for a while" },
    { dutch: "zelfs", english: "even" },
    { dutch: "elk", english: "each" },
    { dutch: "ver", english: "far" },
    { dutch: "hoofd", english: "head" },
    { dutch: "zeer, heel", english: "very" },
    { dutch: "een paar", english: "a couple" },
    { dutch: "vraag", english: "question" },
    { dutch: "vaak", english: "often" },
    { dutch: "keer", english: "times" },
    { dutch: "eerst", english: "first" },
    { dutch: "weg", english: "away" },
    { dutch: "zaak", english: "matter, business" },
    { dutch: "net", english: "just" },
    { dutch: "heen", english: "away" },
    { dutch: "hoog", english: "high" },
    { dutch: "juist", english: "right" },
    { dutch: "sterk", english: "strong" },
    { dutch: "waar", english: "true" },
    { dutch: "deel", english: "part" },
    { dutch: "snel", english: "fast" },
    { dutch: "mooi", english: "beautiful, pretty" },
    { dutch: "feit", english: "fact" },
    { dutch: "zin", english: "sentence" },
    { dutch: "kort", english: "short" },
    { dutch: "vast", english: "fixed" },
    { dutch: "stad", english: "city" },
    { dutch: "vroeg", english: "early" },
    { dutch: "stem", english: "voice" },
    { dutch: "kant", english: "side" },
    { dutch: "geld", english: "money" },
    { dutch: "stuk", english: "piece" },
    { dutch: "graag", english: "gladly" },
    { dutch: "nou", english: "well" },
    { dutch: "pas", english: "only" },
    { dutch: "recht", english: "straight" },
    { dutch: "zwaar", english: "heavy" },
    { dutch: "lid", english: "member" },
    { dutch: "eeuw", english: "century" },
    { dutch: "mond", english: "mouth" },
    { dutch: "opnieuw", english: "again" },
    { dutch: "thuis", english: "at home" },
    { dutch: "kracht", english: "power" },
    { dutch: "ooit", english: "ever" },
    { dutch: "kerk", english: "church" },
    { dutch: "blik", english: "look" },
    { dutch: "kans", english: "opportunity" },
    { dutch: "brief", english: "letter" },
    { dutch: "beeld", english: "statue" },
    { dutch: "zacht", english: "soft" },
    { dutch: "macht", english: "power" },
    { dutch: "via / door", english: "through" },
    { dutch: "gang", english: "corridor" },
    { dutch: "been", english: "leg" },
    { dutch: "slecht", english: "bad" },
    { dutch: "wet", english: "law" },
    { dutch: "bang", english: "afraid" },
    { dutch: "dier", english: "animal" },
    { dutch: "lucht", english: "sky" },
    { dutch: "rug", english: "back" },
    { dutch: "angst", english: "fear" },
    { dutch: "laag", english: "low" },
    { dutch: "raam", english: "window" },
    { dutch: "hond", english: "dog" },
    { dutch: "stil", english: "quiet" },
    { dutch: "doel", english: "target" },
    { dutch: "dienst", english: "shift" },
    { dutch: "zwart", english: "black" },
    { dutch: "menen", english: "mean" },
    { dutch: "dik", english: "fat" },
    { dutch: "paard", english: "horse" },
    { dutch: "vreemd", english: "strange" },
    { dutch: "taal", english: "language" },
    { dutch: "volk", english: "people" },
    { dutch: "aarde", english: "soil" },
    { dutch: "stoel", english: "chair" },
    { dutch: "muur", english: "wall" },
    { dutch: "raad", english: "advice" },
    { dutch: "boom", english: "tree" },
    { dutch: "dorp", english: "village" },
    { dutch: "breed", english: "wide" },
    { dutch: "leeg", english: "empty" },
    { dutch: "lief", english: "sweet" },
    { dutch: "klaar", english: "ready" },
    { dutch: "zorg", english: "care" },
    { dutch: "gauw", english: "soon" },
    { dutch: "trap", english: "stairs" },
    { dutch: "gek", english: "crazy" },
    { dutch: "blad", english: "sheet" },
    { dutch: "spel", english: "game" },
    { dutch: "zak", english: "bag" },
    { dutch: "borst", english: "chest" },
    { dutch: "hoop", english: "pile" },
    { dutch: "fles", english: "bottle" },
    { dutch: "grens", english: "border" },
    { dutch: "hoek", english: "corner" },
    { dutch: "oom", english: "uncle" },
    { dutch: "vlak", english: "flat" },
    { dutch: "buurt", english: "neighborhood" },
    { dutch: "ruim", english: "spacious" },
    { dutch: "blij", english: "happy" },
    { dutch: "eten", english: "food" },
    { dutch: "stof", english: "dust" },
    { dutch: "gat", english: "hole" },
    { dutch: "boer", english: "farmer" },
    { dutch: "reis", english: "trip, journey" },
    { dutch: "druk", english: "busy" },
    { dutch: "vlug / snel", english: "quickly" },
    { dutch: "schuld", english: "debt" },
    { dutch: "leuk", english: "fun" },
    { dutch: "bloem", english: "flower" },
    { dutch: "huisarts", english: "doctor" },
    { dutch: "fijn", english: "nice" },
    { dutch: "links", english: "left" },
    { dutch: "plek", english: "place" },
    { dutch: "niks", english: "nothing" },
    { dutch: "tand", english: "tooth" },
    { dutch: "rand", english: "edge" },
    { dutch: "bos", english: "forest" },
    { dutch: "rust", english: "peace/calm" },
    { dutch: "kring", english: "circle" },
    { dutch: "grijs", english: "gray" },
    { dutch: "haast", english: "rush" },
    { dutch: "vlees", english: "meat" },
    { dutch: "eis", english: "demand" },
    { dutch: "streek", english: "region" },
    { dutch: "smaak", english: "taste" },
    { dutch: "traan", english: "tear" },
    { dutch: "rij", english: "queue" },
    { dutch: "spoor", english: "track" },
    { dutch: "last", english: "burden" },
    { dutch: "smal", english: "narrow" },
    { dutch: "slot", english: "key lock" },
    { dutch: "zwak", english: "weak" },
    { dutch: "geur", english: "smell" },
    { dutch: "buik", english: "stomach" },
    { dutch: "flink", english: "hefty" },
    { dutch: "beurt", english: "turn" },
    { dutch: "wangen", english: "cheeks" },
    { dutch: "vloer", english: "floor" },
    { dutch: "rook", english: "smoke" },
    { dutch: "slag", english: "battle" },
    { dutch: "maan", english: "moon" },
    { dutch: "wens", english: "wish" },
    { dutch: "sfeer", english: "ambiance" },
    { dutch: "bron", english: "source" },
    { dutch: "rijk", english: "rich" },
    { dutch: "droog", english: "dry" },
    { dutch: "bord", english: "plate" },
    { dutch: "jeugd", english: "youth" },
    { dutch: "schoon", english: "clean" },
    { dutch: "keel", english: "throat" },
    { dutch: "pak", english: "business suit" },
    { dutch: "broek", english: "pants" },
    { dutch: "golf", english: "wave" },
    { dutch: "lichaam", english: "body" },
    { dutch: "groei", english: "growth" },
    { dutch: "nat", english: "wet" },
    { dutch: "duur", english: "expensive" },
    { dutch: "feest", english: "party" },
    { dutch: "reeks", english: "series" },
    { dutch: "strak", english: "tight" },
    { dutch: "kleed", english: "carpet" },
    { dutch: "vlucht", english: "flight" },
    { dutch: "dak", english: "roof" },
    { dutch: "hals", english: "neck" },
    { dutch: "geel", english: "yellow" },
    { dutch: "streng", english: "strict" },
    { dutch: "veld", english: "field" },
    { dutch: "moe", english: "tired" },
    { dutch: "geloof", english: "faith, belief" },
    { dutch: "tak", english: "branch" },
    { dutch: "tong", english: "tongue" },
    { dutch: "kwijt", english: "lost" },
    { dutch: "kaas", english: "cheese" },
    { dutch: "zaal", english: "hall" },
    { dutch: "greep", english: "grip" },
    { dutch: "kust", english: "coast" },
    { dutch: "boos", english: "angry" },
    { dutch: "brug", english: "bridge" },
    { dutch: "vak", english: "field, subject" },
    { dutch: "strand", english: "beach" },
    { dutch: "klant", english: "customer" },
    { dutch: "fout", english: "mistake" },
    { dutch: "moed", english: "courage" },
    { dutch: "dom", english: "stupid" },
    { dutch: "jas", english: "jacket" },
    { dutch: "trots", english: "pride" },
    { dutch: "zoet", english: "sweet" },
    { dutch: "fiets", english: "bicycle" },
    { dutch: "wolk", english: "cloud" },
    { dutch: "kast", english: "closet" },
    { dutch: "klap", english: "blow" },
    { dutch: "stroom", english: "flow" },
    { dutch: "winst", english: "profit" },
    { dutch: "knap", english: "good looking" },
    { dutch: "straf", english: "punishment" },
    { dutch: "langzaam", english: "slow" },
    { dutch: "boog", english: "bow" },
    { dutch: "een poos", english: "a while" },
    { dutch: "strekken", english: "stretch" },
    { dutch: "brand", english: "fire" },
    { dutch: "dwars", english: "transverse" },
    { dutch: "kist", english: "chest" },
    { dutch: "wand", english: "wall" },
    { dutch: "klacht", english: "complaint" },
    { dutch: "stuur", english: "steering wheel" },
    { dutch: "kern", english: "core" },
    { dutch: "leer", english: "leather" },
    { dutch: "het liefst", english: "most preferably" },
    { dutch: "dun", english: "thin" },
    { dutch: "jurk", english: "dress" },
    { dutch: "troep", english: "mess" },
    { dutch: "hoed", english: "hat" },
    { dutch: "sturen", english: "to send" },
    { dutch: "tocht", english: "tour" },
    { dutch: "mes", english: "knife" },
    { dutch: "maat", english: "measure" },
    { dutch: "poot", english: "leg" },
    { dutch: "vent", english: "guy" },
    { dutch: "maag", english: "stomach" },
    { dutch: "lijk", english: "corpse" },
    { dutch: "eer", english: "honor" },
    { dutch: "kruis", english: "cross" },
    { dutch: "doos", english: "box" },
    { dutch: "vrucht", english: "fruit" },
    { dutch: "klein", english: "small" },
    { dutch: "makkelijk", english: "easy" },  ],
  difficult: [
    { dutch: "eigenlijk", english: "actually" },
    { dutch: "misschien", english: "maybe" },
    { dutch: "over", english: "about" },
    { dutch: "ander", english: "other" },
    { dutch: "zoals", english: "such as" },
    { dutch: "zonder", english: "without" },
    { dutch: "altijd", english: "always" },
    { dutch: "eigen", english: "own" },
    { dutch: "alles", english: "everything" },
    { dutch: "terwijl", english: "while" },
    { dutch: "anders", english: "different" },
    { dutch: "terug", english: "back" },
    { dutch: "mogelijk", english: "possible" },
    { dutch: "geval", english: "case" },
    { dutch: "echter", english: "however" },
    { dutch: "zeker", english: "sure" },
    { dutch: "enkel", english: "only" },
    { dutch: "natuurlijk", english: "of course" },
    { dutch: "gezicht", english: "face" },
    { dutch: "iemand", english: "someone" },
    { dutch: "wereld", english: "world" },
    { dutch: "duidelijk", english: "clearly" },
    { dutch: "vooral", english: "mostly" },
    { dutch: "nodig", english: "required" },
    { dutch: "bijna", english: "almost" },
    { dutch: "alsof", english: "as if" },
    { dutch: "helemaal", english: "completely" },
    { dutch: "binnen", english: "within, inside" },
    { dutch: "aantal", english: "number of" },
    { dutch: "manier", english: "way" },
    { dutch: "kamer", english: "room" },
    { dutch: "allemaal", english: "all of them" },
    { dutch: "zichzelf", english: "himself" },
    { dutch: "niemand", english: "nobody" },
    { dutch: "daarom", english: "therefore" },
    { dutch: "gewoon", english: "just" },
    { dutch: "samen", english: "together" },
    { dutch: "genoeg", english: "enough" },
    { dutch: "verder", english: "further" },
    { dutch: "daarna", english: "after that" },
    { dutch: "verschillende", english: "various" },
    { dutch: "volgens", english: "according to" },
    { dutch: "moeilijk", english: "difficult" },
    { dutch: "weinig", english: "little, few" },
    { dutch: "iedereen", english: "everyone" },
    { dutch: "dezelfde", english: "the same" },
    { dutch: "gedachte", english: "thought" },
    { dutch: "geheel", english: "whole" },
    { dutch: "bijvoorbeeld", english: "for example" },
    { dutch: "belang", english: "interest" },
    { dutch: "ontwikkeling", english: "development" },
    { dutch: "zoveel", english: "that much" },
    { dutch: "gevoel", english: "feeling" },
    { dutch: "boven", english: "upstairs" },
    { dutch: "algemeen", english: "general" },
    { dutch: "gebied", english: "area" },
    { dutch: "bijzonder", english: "special" },
    { dutch: "buiten", english: "outside" },
    { dutch: "verhaal", english: "story" },
    { dutch: "gevolg", english: "consequence" },
    { dutch: "voorbeeld", english: "example" },
    { dutch: "opnieuw", english: "again" },
    { dutch: "vroeger", english: "back in the days" },
    { dutch: "bovendien", english: "moreover" },
    { dutch: "mogelijkheid", english: "possibility" },
    { dutch: "reden", english: "reason" },
    { dutch: "eerder", english: "earlier" },
    { dutch: "bepaald", english: "determined" },
    { dutch: "vanuit", english: "from" },
    { dutch: "tegenover", english: "opposite" },
    { dutch: "gebruik", english: "use" },
    { dutch: "meteen", english: "right away" },
    { dutch: "onderzoek", english: "research" },
    { dutch: "beweging", english: "movement" },
    { dutch: "waarschijnlijk", english: "probably" },
    { dutch: "zaken", english: "affairs" },
    { dutch: "aandacht", english: "attention" },
    { dutch: "langzaam", english: "slowly" },
    { dutch: "richting", english: "towards" },
    { dutch: "verschillen", english: "differences" },
    { dutch: "oorlog", english: "war" },
    { dutch: "meestal", english: "mostly" },
    { dutch: "nauwelijks", english: "barely" },
    { dutch: "hetzelfde", english: "the same" },
    { dutch: "tenslotte", english: "finally" },
    { dutch: "menselijk", english: "human" },
    { dutch: "invloed", english: "influence" },
    { dutch: "bezig", english: "busy" },
    { dutch: "verband", english: "bandage" },
    { dutch: "plotseling", english: "suddenly" },
    { dutch: "inderdaad", english: "indeed" },
    { dutch: "maatschappij", english: "society" },
    { dutch: "gemakkelijk", english: "easy" },
    { dutch: "donker", english: "dark" },
    { dutch: "verschil", english: "difference" },
    { dutch: "gelukkig", english: "happy" },
    { dutch: "betekenis", english: "meaning" },
    { dutch: "ervaring", english: "experience" },
    { dutch: "begrip", english: "understanding" },
    { dutch: "mevrouw", english: "Mrs." },
    { dutch: "volgende", english: "next" },
    { dutch: "volledig", english: "complete" },
    { dutch: "verschillend", english: "different" },
    { dutch: "onderwijs", english: "education" },
    { dutch: "behoefte", english: "need" },
    { dutch: "rustig", english: "quiet" },
    { dutch: "eenmaal", english: "once" },
    { dutch: "eenvoudig", english: "simple" },
    { dutch: "ongeveer", english: "approximately" },
    { dutch: "waarde", english: "value" },
    { dutch: "ergens", english: "somewhere" },
    { dutch: "gesprek", english: "conversation" },
    { dutch: "indruk", english: "impression" },
    { dutch: "aarde", english: "soil" },
    { dutch: "onmiddellijk", english: "immediately" },
    { dutch: "werkelijkheid", english: "reality" },
    { dutch: "persoonlijk", english: "in person" },
    { dutch: "ruimte", english: "space" },
    { dutch: "moeite", english: "effort" },
    { dutch: "verandering", english: "change" },
    { dutch: "geluid", english: "sound" },
    { dutch: "gedrag", english: "behaviour" },
    { dutch: "bewust", english: "conscious" },
    { dutch: "namelijk", english: "namely" },
    { dutch: "regel", english: "rule" },
    { dutch: "voordat", english: "before" },
    { dutch: "gelijk", english: "equal" },
    { dutch: "geschiedenis", english: "history" },
    { dutch: "kop", english: "headline" },
    { dutch: "voldoende", english: "enough" },
    { dutch: "overal", english: "everywhere" },
    { dutch: "ernstig", english: "serious" },
    { dutch: "nogal", english: "quite" },
    { dutch: "overigens", english: "moreover" },
    { dutch: "omstandigheid", english: "circumstance" },
    { dutch: "noch", english: "neither" },
    { dutch: "trouwens", english: "besides, by the way" },
    { dutch: "toekomst", english: "future" },
    { dutch: "opeens", english: "suddenly" },
    { dutch: "omgeving", english: "surroundings" },
    { dutch: "opvatting", english: "view" },
    { dutch: "overheid", english: "government" },
    { dutch: "afstand", english: "distance" },
    { dutch: "vervolgens", english: "thereafter" },
    { dutch: "wetenschap", english: "science" },
    { dutch: "ondanks", english: "despite" },
    { dutch: "eindelijk", english: "finally" },
    { dutch: "vrijheid", english: "freedom" },
    { dutch: "omhoog", english: "up" },
    { dutch: "ziekte", english: "disease" },
    { dutch: "hoogte", english: "height" },
    { dutch: "beleid", english: "policy" },
    { dutch: "schrijver", english: "writer" },
    { dutch: "bedrijf", english: "company" },
    { dutch: "beneden", english: "down" },
    { dutch: "vandaag", english: "today" },
    { dutch: "samenleving", english: "society" },
    { dutch: "verhouding", english: "ratio" },
    { dutch: "houding", english: "attitude" },
    { dutch: "gevaar", english: "danger" },
    { dutch: "regering", english: "government" },
    { dutch: "rekening", english: "bill" },
    { dutch: "wetenschappelijk", english: "scientific" },
    { dutch: "soldaat", english: "soldier" },
    { dutch: "waarheid", english: "truth" },
    { dutch: "tenminste", english: "at least" },
    { dutch: "prachtig", english: "magnificent" },
    { dutch: "beroep", english: "profession" },
    { dutch: "poging", english: "attempt" },
    { dutch: "oorzaak", english: "cause" },
    { dutch: "mening", english: "opinion" },
    { dutch: "allen", english: "all" },
    { dutch: "gezin", english: "family" },
    { dutch: "voorzichtig", english: "careful" },
    { dutch: "beslissing", english: "decision" },
    { dutch: "uiteindelijk", english: "in the end" },
    { dutch: "geleden", english: "ago" },
    { dutch: "gelegenheid", english: "opportunity" },
    { dutch: "noodzakelijk", english: "necessary" },
    { dutch: "aanwezig", english: "present" },
    { dutch: "leeftijd", english: "age" },
    { dutch: "bellen", english: "dial" },
    { dutch: "onmogelijk", english: "impossible" },
    { dutch: "stilte", english: "silence" },
    { dutch: "behandeling", english: "therapy" },
    { dutch: "huwelijk", english: "wedding" },
    { dutch: "vorige", english: "last, previous" },
    { dutch: "verklaring", english: "statement" },
    { dutch: "verleden", english: "past" },
    { dutch: "bezoek", english: "visit" },
    { dutch: "oplossing", english: "solution" },
    { dutch: "doordat", english: "because" },
    { dutch: "verlangen", english: "desire" },
    { dutch: "bevatten", english: "contain" },
    { dutch: "moeilijkheid", english: "difficulty" },
    { dutch: "keuken", english: "kitchen" },
    { dutch: "herinnering", english: "reminder" },
    { dutch: "dagelijks", english: "daily" },
    { dutch: "ziekenhuis", english: "hospital" },
    { dutch: "zodra", english: "as soon as" },
    { dutch: "onderwerp", english: "topic, subject" },
    { dutch: "vrijwel", english: "almost" },
    { dutch: "blijkbaar", english: "apparently" },
    { dutch: "bureau", english: "desk" },
    { dutch: "opdracht", english: "assignment, exercise" },
    { dutch: "gebouw", english: "building" },
    { dutch: "uitdrukking", english: "expression" },
    { dutch: "zolang", english: "as long as" },
    { dutch: "lekker", english: "tasty, nice" },
    { dutch: "bestuur", english: "board" },
    { dutch: "keuze", english: "choice" },
    { dutch: "behalve", english: "except" },
    { dutch: "uitspraak", english: "pronunciation" },
    { dutch: "nergens", english: "nowhere" },
    { dutch: "gezond", english: "healthy" },
    { dutch: "voorstel", english: "proposal" },
    { dutch: "veilig", english: "safe" },
    { dutch: "stijgen", english: "rise" },
    { dutch: "besluit", english: "decision" },
    { dutch: "eiland", english: "island" },
    { dutch: "tegenstelling", english: "contrary" },
    { dutch: "oordeel", english: "judgment" },
    { dutch: "twijfel", english: "doubt" },
    { dutch: "glimlach", english: "smile" },
    { dutch: "uitsluitend", english: "exclusively" },
    { dutch: "wellicht", english: "perhaps" },
    { dutch: "spanning", english: "tension, stress" },
    { dutch: "arbeid", english: "labor" },
    { dutch: "gevaarlijk", english: "dangerous" },
    { dutch: "rechter", english: "judge" },
    { dutch: "leraar", english: "teacher" },
    { dutch: "vriendin", english: "girlfriend" },
    { dutch: "zekerheid", english: "security" },
    { dutch: "gewoonlijk", english: "usually" },
    { dutch: "heerlijk", english: "delicious" },
    { dutch: "geur", english: "smell" },
    { dutch: "openbaar", english: "public" },
    { dutch: "voordeel", english: "benefit" },
    { dutch: "opmerking", english: "comment" },
    { dutch: "intussen", english: "meanwhile" },
    { dutch: "gezag", english: "authority" },
    { dutch: "herhalen", english: "to repeat" },
    { dutch: "tevreden", english: "satisfied; pleased" },
    { dutch: "kantoor", english: "office" },
    { dutch: "gedeelte", english: "part" },
    { dutch: "afdeling", english: "department" },
    { dutch: "maatregel", english: "measure" },
    { dutch: "voedsel", english: "food" },
    { dutch: "boodschap", english: "message" },
    { dutch: "krachtige", english: "powerful" },
    { dutch: "vrolijk", english: "cheerful" },
    { dutch: "vertrek", english: "departure" },
    { dutch: "toevallig", english: "coincidentally" },
    { dutch: "uitstekend", english: "excellent; outstanding" },
    { dutch: "bewijs", english: "proof" },
    { dutch: "voorkeur", english: "preference" },
    { dutch: "achtergrond", english: "background" },
    { dutch: "eigenschap", english: "charachteristic" },
    { dutch: "bezit", english: "possession" },
    { dutch: "handeling", english: "act" },
    { dutch: "arbeider", english: "worker" },
    { dutch: "prettig", english: "pleasant" },
    { dutch: "geheim", english: "secret" },
    { dutch: "gedicht", english: "poem" },
    { dutch: "vijand", english: "enemy" },
    { dutch: "verwachting", english: "expectation" },
    { dutch: "inmiddels", english: "in the meantime" },
    { dutch: "ongetwijfeld", english: "undoubtedly, surely" },
    { dutch: "vergadering", english: "meeting" },
    { dutch: "buitenlands", english: "foreign" },
    { dutch: "opleiding", english: "education" },
    { dutch: "verschrikkelijk", english: "terrible" },
    { dutch: "ambtenaar", english: "civil servant" },
    { dutch: "redelijk", english: "reasonable, reasonably" },
    { dutch: "gewoonte", english: "habit" },
    { dutch: "verzoek", english: "request" },
    { dutch: "leerling", english: "pupil" },
    { dutch: "geweld", english: "violence" },
    { dutch: "uitzondering", english: "exception" },
    { dutch: "voorwerp", english: "object" },
    { dutch: "gunstig", english: "favorable" },
    { dutch: "regeling", english: "regulation" },
    { dutch: "doelstelling", english: "goal, objective" },
    { dutch: "verdriet", english: "sadness" },
    { dutch: "dichtbij", english: "nearby" },
    { dutch: "afspraak", english: "appointment" },
    { dutch: "allebei", english: "both" },
    { dutch: "heuvel", english: "hill" },
    { dutch: "voorhoofd", english: "forehead" },
    { dutch: "vreselijk", english: "horrible" },
    { dutch: "vrede", english: "peace" },
    { dutch: "godsdienst", english: "religion" },
    { dutch: "samenwerking", english: "cooperation" },
    { dutch: "spiegel", english: "mirror" },
    { dutch: "verstand", english: "wit, wiseness" },
    { dutch: "onderscheid", english: "difference, distinction" },
    { dutch: "aanval", english: "attack" },
    { dutch: "ongeluk", english: "accident" },
    { dutch: "sleutel", english: "key" },
    { dutch: "koffer", english: "suitcase" },
    { dutch: "afscheid", english: "goodbye" },
    { dutch: "vereniging", english: "association, club" },
    { dutch: "geweldig", english: "awesome, great" },
    { dutch: "bodem", english: "bottom, ground" },
    { dutch: "woning", english: "house" },
    { dutch: "overeenkomst", english: "agreement" },
    { dutch: "voorzitter", english: "chairman" },
    { dutch: "milieu", english: "environment" },
    { dutch: "kenmerken", english: "characteristics" },
    { dutch: "landschap", english: "landscape" },
    { dutch: "definitief", english: "final" },
    { dutch: "nauwkeurig", english: "accurate" },
    { dutch: "bijdrage", english: "contribution" },
    { dutch: "overleg", english: "consultation" },
    { dutch: "man, echtgenoot", english: "husband" },
    { dutch: "verbazing", english: "surprise" },
    { dutch: "gordijnen", english: "curtains" },
    { dutch: "goedkoop", english: "cheap" },
    { dutch: "evenwicht", english: "balance" },
    { dutch: "vochtig", english: "moist" },
    { dutch: "vergelijking", english: "comparison" },
    { dutch: "gezondheid", english: "health" },
    { dutch: "kern", english: "core" },
    { dutch: "gevangenis", english: "jail, prison" },
    { dutch: "slaapkamer", english: "bedroom" },
    { dutch: "kleren", english: "clothes" },
    { dutch: "makkelijk", english: "easy" },
    { dutch: "verbaasd", english: "surprised" },
    { dutch: "deken", english: "blanket" },
    { dutch: "vreugde", english: "joy" },
    { dutch: "gemak", english: "ease" },
    { dutch: "kunstenaar", english: "artist" },
    { dutch: "burgemeester", english: "mayor" },
    { dutch: "verlies", english: "loss" },
    { dutch: "burgerlijk", english: "civil" },
    { dutch: "lelijk", english: "ugly" },
    { dutch: "overig", english: "other, remaining" },
    { dutch: "bereid", english: "prepared" },
    { dutch: "koningin", english: "queen" },
    { dutch: "eigenaar", english: "owner" },
    { dutch: "ontmoeting", english: "meeting" },
    { dutch: "verslag", english: "report" },
    { dutch: "onverwacht", english: "unexpected" },
    { dutch: "personeel", english: "staff" },
    { dutch: "gezellig", english: "cozy" },
    { dutch: "geheugen", english: "memory" },
    { dutch: "verdrietig", english: "sad" },
    { dutch: "snelheid", english: "speed" },
    { dutch: "gemeen", english: "mean" },
    { dutch: "nuttig", english: "helpful; useful" },
    { dutch: "schade", english: "damage" },
    { dutch: "kapot", english: "broken" },
    { dutch: "bescherming", english: "protection" },
    { dutch: "noodzaak", english: "need" },
    { dutch: "jammer", english: "unfortunately" },
    { dutch: "toekomstig", english: "future" },
    { dutch: "tijdschrift", english: "magazine" },
    { dutch: "verdieping", english: "floor" },
    { dutch: "aantrekkelijk", english: "attractive" },
    { dutch: "opvoeding", english: "education" },
    { dutch: "tegenstander", english: "opponent" },
    { dutch: "verantwoordelijkheid", english: "responsibility" },  ],
};

const WRONG_REACTIONS = [
  "Oeps! 😅", "Bijna! 🤏", "Nee nee nee! 🙈",
  "Probeer opnieuw! 💪", "Niet helemaal! 😬",
  "Mis! 🎯", "Volgende keer beter! 🌟",
  "Ai ai ai! 😄", "Helaas! 🫠", "Foutje! 🤭"
];

const RIGHT_REACTIONS = [
  "Goed zo! 🎉", "Perfect! ⭐", "Geweldig! 🔥",
  "Uitstekend! 💯", "Fantastisch! 🚀",
  "Top! 👑", "Bravo! 🎊", "Heel goed! 💎"
];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function generateOptions(correctWord, allWords) {
  const others = allWords.filter(w => w.dutch !== correctWord.dutch);
  const distractors = shuffle(others).slice(0, 3);
  return shuffle([correctWord, ...distractors]);
}

function weightedPick(words, stats) {
  const weights = words.map(w => {
    const s = stats[w.dutch] || { wrong: 0, right: 0, lastSeen: 0 };
    const errorWeight = 1 + s.wrong * 3;
    const freshness = s.lastSeen === 0 ? 2 : 1;
    const masteryDiscount = s.right >= 3 && s.wrong === 0 ? 0.2 : 1;
    return errorWeight * freshness * masteryDiscount;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < words.length; i++) {
    r -= weights[i];
    if (r <= 0) return words[i];
  }
  return words[words.length - 1];
}

const STOP_WORDS = new Set(["to", "a", "the", "of", "in", "on", "at", "is", "be", "it", "and", "or", "for", "not"]);

function findRelatedWords(currentWord, allWords) {
  const eng = currentWord.english.toLowerCase();
  // Split into meaningful keywords
  const keywords = eng.split(/[\s,;\/()]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  
  const related = allWords.filter(w => {
    if (w.dutch === currentWord.dutch) return false;
    const other = w.english.toLowerCase();
    // Exact match
    if (other === eng) return true;
    // Keyword overlap
    return keywords.some(kw => other.split(/[\s,;\/()]+/).some(ow => 
      ow === kw || ow.startsWith(kw) || kw.startsWith(ow)
    ));
  });
  return related.slice(0, 4); // Max 4 related words
}

function parseBulkWords(text) {
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      const pairs = [];
      for (let i = 0; i < arr.length - 1; i += 2) {
        const d = String(arr[i]).trim();
        const e = String(arr[i + 1]).trim();
        if (d && e) pairs.push({ dutch: d, english: e });
      }
      if (pairs.length > 0) return pairs;
    }
  } catch {}
  const lines = text.trim().split("\n").filter(Boolean);
  const pairs = [];
  for (const line of lines) {
    const parts = line.split(/[,\t;|]/).map(s => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      pairs.push({ dutch: parts[0], english: parts[1] });
    }
  }
  return pairs;
}

const font = "'Nunito', sans-serif";
const displayFont = "'Fredoka', sans-serif";
const colors = {
  bg: "#0f1729", card: "#1a2340", accent: "#ff6b35",
  accentGlow: "rgba(255,107,53,0.3)", correct: "#22c55e",
  correctGlow: "rgba(34,197,94,0.4)", wrong: "#ef4444",
  wrongGlow: "rgba(239,68,68,0.4)", text: "#e8eaf0",
  textMuted: "#8892a8", border: "#2a3558", surface: "#141d33",
  easy: "#22c55e", medium: "#f59e0b", difficult: "#ef4444", all: "#818cf8",
};

export default function DutchVocabGame() {
  const [screen, setScreen] = useState("menu");
  const [wordBank, setWordBank] = useState(WORD_BANK);
  const [activeLevel, setActiveLevel] = useState(null);
  const [words, setWords] = useState([]);
  const [stats, setStats] = useState({});
  const [current, setCurrent] = useState(null);
  const [options, setOptions] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [importLevel, setImportLevel] = useState("easy");
  const [bulkInput, setBulkInput] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [managerFilter, setManagerFilter] = useState("");
  const [managerLevel, setManagerLevel] = useState("easy");
  const [newDutch, setNewDutch] = useState("");
  const [newEnglish, setNewEnglish] = useState("");
  const feedbackTimer = useRef(null);
  const pendingNext = useRef(null);

  const pauseFeedback = () => {
    clearTimeout(feedbackTimer.current);
  };

  const releaseFeedback = () => {
    if (pendingNext.current) {
      const { wordList, statsSnapshot } = pendingNext.current;
      pendingNext.current = null;
      nextQuestion(wordList, statsSnapshot);
    }
  };

  const allWords = [...wordBank.easy, ...wordBank.medium, ...wordBank.difficult];

  const nextQuestion = useCallback((wordList, currentStats) => {
    const w = wordList || words;
    const s = currentStats || stats;
    if (w.length < 4) return;
    const word = weightedPick(w, s);
    setCurrent(word);
    setOptions(generateOptions(word, w));
    setFeedback(null);
    setSelected(null);
  }, [words, stats]);

  const handleAnswer = (option) => {
    if (feedback) return;
    setSelected(option.dutch);
    const correct = option.dutch === current.dutch;
    const now = Date.now();
    const newStats = { ...stats };
    const old = newStats[current.dutch] || { wrong: 0, right: 0, lastSeen: 0 };
    newStats[current.dutch] = {
      wrong: correct ? Math.max(0, old.wrong - 1) : old.wrong + 1,
      right: correct ? old.right + 1 : old.right,
      lastSeen: now
    };
    setStats(newStats);

    if (correct) {
      setScore(s => ({ ...s, right: s.right + 1 }));
      setStreak(s => { const n = s + 1; setBestStreak(b => Math.max(b, n)); return n; });
      setFeedback({ correct: true, message: pickRandom(RIGHT_REACTIONS) });
    } else {
      setScore(s => ({ ...s, wrong: s.wrong + 1 }));
      setStreak(0);
      setFeedback({ correct: false, message: pickRandom(WRONG_REACTIONS), correctAnswer: current.english });
    }

    clearTimeout(feedbackTimer.current);
    pendingNext.current = { wordList: words, statsSnapshot: newStats };
    feedbackTimer.current = setTimeout(() => {
      pendingNext.current = null;
      nextQuestion(words, newStats);
    }, correct ? 1200 : 4500);
  };

  const startGame = (level) => {
    const levelWords = level === "all" ? allWords : wordBank[level];
    if (levelWords.length < 4) return;
    setActiveLevel(level);
    setWords(levelWords);
    setScore({ right: 0, wrong: 0 });
    setStreak(0);
    setBestStreak(0);
    setScreen("play");
    const word = weightedPick(levelWords, stats);
    setCurrent(word);
    setOptions(generateOptions(word, levelWords));
    setFeedback(null);
    setSelected(null);
  };

  const handleImport = () => {
    const pairs = parseBulkWords(bulkInput);
    if (pairs.length === 0) {
      setImportResult({ success: false, message: "No valid word pairs found." });
      return;
    }
    const existing = new Set(wordBank[importLevel].map(w => w.dutch));
    const newWords = pairs.filter(p => !existing.has(p.dutch));
    setWordBank(prev => ({ ...prev, [importLevel]: [...prev[importLevel], ...newWords] }));
    setImportResult({ success: true, message: `Added ${newWords.length} new words to ${importLevel}! (${pairs.length - newWords.length} duplicates skipped)` });
    setBulkInput("");
  };

  const addWord = (level) => {
    const d = newDutch.trim().toLowerCase();
    const e = newEnglish.trim();
    if (!d || !e) return;
    if (wordBank[level].some(w => w.dutch === d)) return;
    setWordBank(prev => ({ ...prev, [level]: [...prev[level], { dutch: d, english: e }] }));
    setNewDutch(""); setNewEnglish("");
  };

  const removeWord = (level, dutch) => {
    setWordBank(prev => ({ ...prev, [level]: prev[level].filter(w => w.dutch !== dutch) }));
  };

  const getMastery = (dutch) => {
    const s = stats[dutch];
    if (!s) return 0;
    const total = s.right + s.wrong;
    return total === 0 ? 0 : Math.round((s.right / total) * 100);
  };

  const totalAnswered = score.right + score.wrong;
  const accuracy = totalAnswered > 0 ? Math.round((score.right / totalAnswered) * 100) : 0;

  const LevelButton = ({ level, count }) => {
    const c = colors[level]; const isDisabled = count < 4;
    const labels = { easy: "Easy", medium: "Medium", difficult: "Difficult", all: "All Words" };
    const icons = { easy: "🟢", medium: "🟡", difficult: "🔴", all: "🌐" };
    return (
      <button onClick={isDisabled ? undefined : () => startGame(level)} style={{
        fontFamily: displayFont, fontSize: 16, fontWeight: 600,
        background: isDisabled ? colors.surface : colors.card,
        color: isDisabled ? colors.textMuted : colors.text,
        border: `2px solid ${isDisabled ? colors.border : c}`,
        borderRadius: 16, padding: "16px 20px",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.45 : 1, transition: "all 0.2s", width: "100%",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>{icons[level]} {labels[level]}</span>
        <span style={{ fontSize: 13, color: isDisabled ? colors.textMuted : c, fontWeight: 700 }}>
          {count}{isDisabled && count < 4 ? " (need 4+)" : ""}
        </span>
      </button>
    );
  };

  const TabBtn = ({ lvl, active, cnt }) => (
    <button onClick={() => { screen === "import" ? setImportLevel(lvl) : setManagerLevel(lvl); }}
      style={{
        flex: 1, fontFamily: displayFont, fontSize: 13, fontWeight: 600,
        background: active ? `${colors[lvl]}20` : colors.surface,
        color: active ? colors[lvl] : colors.textMuted,
        border: `2px solid ${active ? colors[lvl] : colors.border}`,
        borderRadius: 10, padding: "10px 8px", cursor: "pointer", textTransform: "capitalize",
      }}>{lvl}{cnt !== undefined ? ` (${cnt})` : ""}</button>
  );

  return (
    <div style={{
      fontFamily: font,
      background: `linear-gradient(160deg, ${colors.bg} 0%, #0a1020 50%, #141028 100%)`,
      minHeight: "100vh", color: colors.text, position: "relative", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,107,53,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: "-15%", left: "-10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 16px", position: "relative", zIndex: 1 }}>

        {/* MENU */}
        {screen === "menu" && (
          <div style={{ paddingTop: 32 }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ fontSize: 44, marginBottom: 6 }}>🇳🇱</div>
              <h1 style={{
                fontFamily: displayFont, fontSize: 34, fontWeight: 700,
                background: `linear-gradient(135deg, ${colors.accent}, #ff9a5c)`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4
              }}>Nederlands!</h1>
              <p style={{ color: colors.textMuted, fontSize: 13 }}>Inburgering A2 Vocabulary Trainer</p>
            </div>

            <p style={{ fontFamily: displayFont, fontSize: 12, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>Choose Level</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <LevelButton level="easy" count={wordBank.easy.length} />
              <LevelButton level="medium" count={wordBank.medium.length} />
              <LevelButton level="difficult" count={wordBank.difficult.length} />
              <LevelButton level="all" count={allWords.length} />
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
              <button onClick={() => setScreen("manage")} style={{
                flex: 1, fontFamily: font, fontSize: 14, fontWeight: 600,
                background: colors.card, color: colors.textMuted,
                border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px", cursor: "pointer",
              }}>📚 Word Bank</button>
              <button onClick={() => { setImportResult(null); setScreen("import"); }} style={{
                flex: 1, fontFamily: font, fontSize: 14, fontWeight: 600,
                background: colors.card, color: colors.textMuted,
                border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px", cursor: "pointer",
              }}>📋 Import Words</button>
            </div>

            {Object.keys(stats).length > 0 && (
              <div style={{ background: colors.card, borderRadius: 16, padding: 20, border: `1px solid ${colors.border}` }}>
                <p style={{ fontFamily: displayFont, fontSize: 12, color: colors.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>Progress</p>
                <div style={{ display: "flex", justifyContent: "center", gap: 32 }}>
                  {[
                    { val: allWords.filter(w => getMastery(w.dutch) >= 80).length, label: "Mastered", c: colors.correct },
                    { val: allWords.filter(w => { const m = getMastery(w.dutch); return m > 0 && m < 80; }).length, label: "Learning", c: colors.accent },
                    { val: allWords.filter(w => getMastery(w.dutch) === 0).length, label: "New", c: colors.textMuted },
                  ].map(({ val, label, c }) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: displayFont, fontSize: 26, fontWeight: 700, color: c }}>{val}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PLAY */}
        {screen === "play" && current && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <button onClick={() => { clearTimeout(feedbackTimer.current); pendingNext.current = null; setScreen("menu"); }} style={{
                background: "none", border: "none", color: colors.textMuted,
                fontSize: 14, cursor: "pointer", fontFamily: font, fontWeight: 600,
              }}>← Menu</button>
              <div style={{
                fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8,
                background: `${colors[activeLevel]}18`, color: colors[activeLevel],
                textTransform: "uppercase", letterSpacing: 1,
              }}>{activeLevel === "all" ? "All" : activeLevel}</div>
              <div style={{ display: "flex", gap: 14, fontSize: 13, color: colors.textMuted }}>
                <span>✅ {score.right}</span>
                <span>❌ {score.wrong}</span>
                {streak >= 3 && <span style={{ color: colors.accent }}>🔥 {streak}</span>}
              </div>
            </div>

            <div style={{ height: 4, background: colors.surface, borderRadius: 2, marginBottom: 28, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${colors.accent}, #ff9a5c)`, width: `${accuracy}%`, transition: "width 0.5s ease" }} />
            </div>

            <div style={{
              background: colors.card, borderRadius: 24, padding: "40px 24px",
              textAlign: "center", border: `1px solid ${colors.border}`,
              marginBottom: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.3)"
            }}>
              <p style={{ fontSize: 12, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>What does this mean?</p>
              <h2 style={{ fontFamily: displayFont, fontSize: 42, fontWeight: 700, color: "#fff", margin: "8px 0 0" }}>{current.dutch}</h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {options.map((opt, i) => {
                const isSelected = selected === opt.dutch;
                const isCorrect = opt.dutch === current.dutch;
                const showResult = feedback !== null;
                let bg = colors.card, borderColor = colors.border, shadow = "none";
                if (showResult && isCorrect) { bg = "rgba(34,197,94,0.15)"; borderColor = colors.correct; shadow = `0 0 20px ${colors.correctGlow}`; }
                else if (showResult && isSelected && !isCorrect) { bg = "rgba(239,68,68,0.15)"; borderColor = colors.wrong; shadow = `0 0 20px ${colors.wrongGlow}`; }
                return (
                  <button key={opt.dutch + i} onClick={() => handleAnswer(opt)} style={{
                    fontFamily: font, fontSize: 15, fontWeight: 600,
                    background: bg, color: colors.text,
                    border: `2px solid ${borderColor}`, borderRadius: 16,
                    padding: "16px 12px", cursor: feedback ? "default" : "pointer",
                    transition: "all 0.2s", boxShadow: shadow,
                    opacity: showResult && !isCorrect && !isSelected ? 0.4 : 1
                  }}>{opt.english}</button>
                );
              })}
            </div>

            {feedback && (
              <div
                {...(!feedback.correct ? {
                  onMouseDown: pauseFeedback,
                  onMouseUp: releaseFeedback,
                  onMouseLeave: releaseFeedback,
                  onTouchStart: pauseFeedback,
                  onTouchEnd: releaseFeedback,
                } : {})}
                style={{
                marginTop: 20, textAlign: "center", padding: 20, borderRadius: 16,
                background: feedback.correct ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${feedback.correct ? colors.correct : colors.wrong}`,
                animation: "fadeIn 0.3s ease",
                cursor: !feedback.correct ? "grab" : "default",
              }}>
                <p style={{ fontFamily: displayFont, fontSize: 22, fontWeight: 600, margin: 0 }}>{feedback.message}</p>
                {!feedback.correct && (() => {
                  const related = findRelatedWords(current, allWords);
                  return (
                    <>
                      <p style={{ color: colors.textMuted, fontSize: 15, marginTop: 8 }}>
                        <strong style={{ color: colors.correct }}>{current.dutch}</strong> = {feedback.correctAnswer}
                      </p>
                      {/* All 4 options explained */}
                      <div style={{
                        marginTop: 12, paddingTop: 12,
                        borderTop: `1px solid ${colors.border}`,
                        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6,
                        textAlign: "left",
                      }}>
                        {options.map((opt) => {
                          const isCorrect = opt.dutch === current.dutch;
                          const wasSelected = opt.dutch === selected;
                          return (
                            <div key={opt.dutch} style={{
                              fontSize: 13, padding: "6px 10px", borderRadius: 8,
                              background: isCorrect ? "rgba(34,197,94,0.12)" : wasSelected ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
                              border: `1px solid ${isCorrect ? colors.correct + "40" : "transparent"}`,
                            }}>
                              <span style={{ fontWeight: 700, color: isCorrect ? colors.correct : wasSelected ? colors.wrong : colors.text }}>{opt.dutch}</span>
                              <span style={{ color: colors.textMuted, marginLeft: 6 }}>{opt.english}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Related/synonym words */}
                      {related.length > 0 && (
                        <div style={{
                          marginTop: 10, paddingTop: 10,
                          borderTop: `1px solid ${colors.border}`,
                          textAlign: "left",
                        }}>
                          <p style={{ fontSize: 11, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                            🔗 Also means "{current.english}"
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {related.map(r => (
                              <span key={r.dutch} style={{
                                fontSize: 13, padding: "4px 10px", borderRadius: 8,
                                background: "rgba(129,140,248,0.12)",
                                border: "1px solid rgba(129,140,248,0.25)",
                                color: "#818cf8",
                              }}>
                                <strong>{r.dutch}</strong>
                                <span style={{ color: colors.textMuted, marginLeft: 5, fontSize: 12 }}>{r.english}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                {feedback.correct && streak >= 5 && <p style={{ color: colors.accent, fontSize: 14, marginTop: 4 }}>{streak} in a row! 🔥</p>}
                {!feedback.correct && (
                  <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 12, opacity: 0.5 }}>hold to pause · release to continue</p>
                )}
              </div>
            )}
            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          </div>
        )}

        {/* IMPORT */}
        {screen === "import" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <button onClick={() => setScreen("menu")} style={{ background: "none", border: "none", color: colors.textMuted, fontSize: 14, cursor: "pointer", fontFamily: font, fontWeight: 600 }}>← Back</button>
              <h2 style={{ fontFamily: displayFont, fontSize: 20, margin: 0 }}>Import Words</h2>
              <div style={{ width: 50 }} />
            </div>

            <div style={{ background: colors.card, borderRadius: 16, padding: 16, border: `1px solid ${colors.border}`, marginBottom: 16 }}>
              <p style={{ fontFamily: displayFont, fontSize: 15, fontWeight: 600, color: colors.accent, marginBottom: 8 }}>From Quizlet Console</p>
              <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6, margin: 0 }}>
                On Quizlet, open DevTools (F12) → Console → type <code style={{ color: colors.accent, background: colors.surface, padding: "1px 6px", borderRadius: 4 }}>allow pasting</code> then paste:
              </p>
              <div style={{
                background: colors.surface, borderRadius: 8, padding: "10px 12px", marginTop: 8,
                fontSize: 11, fontFamily: "monospace", color: colors.text, overflowX: "auto",
                border: `1px solid ${colors.border}`, wordBreak: "break-all",
              }}>
                {"console.log(JSON.stringify([...document.querySelectorAll('[class*=\"TermText\"]')].map(e => e.innerText)))"}
              </div>
              <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 10, marginBottom: 0 }}>
                Right-click output → Copy string → paste below. Also accepts <code style={{ color: colors.accent }}>dutch, english</code> per line.
              </p>
            </div>

            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>Import into:</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["easy", "medium", "difficult"].map(lvl => <TabBtn key={lvl} lvl={lvl} active={importLevel === lvl} />)}
            </div>

            <textarea value={bulkInput} onChange={e => setBulkInput(e.target.value)} rows={10}
              placeholder={'Paste Quizlet console output here...\n\nOr word pairs:\nhuis, house\nstraat, street'}
              style={{
                width: "100%", fontFamily: "monospace", fontSize: 13, padding: 14,
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 12, color: colors.text, outline: "none", resize: "vertical",
                boxSizing: "border-box", lineHeight: 1.5,
              }} />

            <button onClick={handleImport} disabled={!bulkInput.trim()} style={{
              fontFamily: displayFont, fontWeight: 600, fontSize: 16, marginTop: 12,
              background: bulkInput.trim() ? `linear-gradient(135deg, ${colors.accent}, #e85d2a)` : colors.surface,
              color: bulkInput.trim() ? "#fff" : colors.textMuted,
              border: "none", borderRadius: 12, padding: "14px 32px",
              cursor: bulkInput.trim() ? "pointer" : "default", width: "100%",
              boxShadow: bulkInput.trim() ? `0 4px 20px ${colors.accentGlow}` : "none",
            }}>Import Words</button>

            {importResult && (
              <div style={{
                marginTop: 16, padding: 14, borderRadius: 12, textAlign: "center",
                background: importResult.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${importResult.success ? colors.correct : colors.wrong}`,
                color: importResult.success ? colors.correct : colors.wrong,
                fontWeight: 600, fontSize: 14,
              }}>{importResult.message}</div>
            )}
          </div>
        )}

        {/* MANAGE */}
        {screen === "manage" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <button onClick={() => setScreen("menu")} style={{ background: "none", border: "none", color: colors.textMuted, fontSize: 14, cursor: "pointer", fontFamily: font, fontWeight: 600 }}>← Back</button>
              <h2 style={{ fontFamily: displayFont, fontSize: 20, margin: 0 }}>Word Bank</h2>
              <span style={{ fontSize: 13, color: colors.textMuted }}>{allWords.length} total</span>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["easy", "medium", "difficult"].map(lvl => <TabBtn key={lvl} lvl={lvl} active={managerLevel === lvl} cnt={wordBank[lvl].length} />)}
            </div>

            <div style={{ background: colors.card, borderRadius: 14, padding: 12, border: `1px solid ${colors.border}`, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newDutch} onChange={e => setNewDutch(e.target.value)}
                  placeholder="Nederlands" onKeyDown={e => e.key === "Enter" && addWord(managerLevel)}
                  style={{ flex: 1, fontFamily: font, fontSize: 14, padding: "10px 12px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, outline: "none" }} />
                <input value={newEnglish} onChange={e => setNewEnglish(e.target.value)}
                  placeholder="English" onKeyDown={e => e.key === "Enter" && addWord(managerLevel)}
                  style={{ flex: 1, fontFamily: font, fontSize: 14, padding: "10px 12px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, outline: "none" }} />
                <button onClick={() => addWord(managerLevel)} style={{
                  fontFamily: font, fontWeight: 700, fontSize: 18, background: colors.accent, color: "#fff",
                  border: "none", borderRadius: 10, width: 44, cursor: "pointer"
                }}>+</button>
              </div>
            </div>

            <input value={managerFilter} onChange={e => setManagerFilter(e.target.value)}
              placeholder="🔍 Search words..."
              style={{ width: "100%", fontFamily: font, fontSize: 14, padding: "10px 12px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />

            <div style={{ maxHeight: 380, overflowY: "auto", borderRadius: 14, border: `1px solid ${colors.border}` }}>
              {wordBank[managerLevel]
                .filter(w => !managerFilter || w.dutch.includes(managerFilter.toLowerCase()) || w.english.toLowerCase().includes(managerFilter.toLowerCase()))
                .map((w, i) => {
                  const mastery = getMastery(w.dutch);
                  return (
                    <div key={w.dutch + i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 14px", borderBottom: `1px solid ${colors.border}`, background: colors.card,
                    }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{w.dutch}</span>
                        <span style={{ color: colors.textMuted, fontSize: 14, marginLeft: 10 }}>{w.english}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {mastery > 0 && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                            background: mastery >= 80 ? "rgba(34,197,94,0.15)" : "rgba(255,107,53,0.15)",
                            color: mastery >= 80 ? colors.correct : colors.accent
                          }}>{mastery}%</span>
                        )}
                        <button onClick={() => removeWord(managerLevel, w.dutch)} style={{
                          background: "none", border: "none", color: colors.textMuted,
                          cursor: "pointer", fontSize: 16, padding: "2px 6px"
                        }}>×</button>
                      </div>
                    </div>
                  );
                })}
              {wordBank[managerLevel].length === 0 && (
                <div style={{ padding: 30, textAlign: "center", color: colors.textMuted, fontSize: 14 }}>
                  No words yet. Use <strong style={{ color: colors.accent }}>Import Words</strong> to add from Quizlet!
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
