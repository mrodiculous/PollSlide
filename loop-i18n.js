/* LoopSlide — interface language for play.html (phones), screen.html (TV), tv.html
 * (pairing) and loop.html (Studio).
 *
 * KEYED BY THE EXACT ENGLISH STRING, like ui-lang.js: a string with no entry falls back
 * to English, never to a missing-key placeholder. {name} placeholders are filled by t().
 *
 * WHICH LANGUAGE
 *   Studio  → the language the user picked in PollSlide (ps_ui_lang), else the browser's
 *   Phones  → the viewer's choice on the answer page (ql_viewer_lang), else the phone's
 *   TV      → the loop's "screen language", where 'auto' means the TV browser's own
 *   Pairing → the TV browser's own
 *
 * NEVER TRANSLATED here: anything the organiser or a player typed. Question text comes
 * translated separately (api/loop-translate.js → LoopEngine.localize) and is labelled.
 *
 * Register, matching the rest of PollSlide (scripts/qa-i18n.js enforces it for the site):
 * es tú · de du · fr tu · it tu · pt European Portuguese.
 *
 * Deliberately ES5 — tv.html loads this on smart-TV browsers. */
(function (root) {
  var LANGS = ['en', 'es', 'de', 'fr', 'pt', 'it'];
  var NAMES = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', pt: 'Português', it: 'Italiano' };
  var D = { es: {}, de: {}, fr: {}, pt: {}, it: {} };
  var ORDER = ['es', 'de', 'fr', 'pt', 'it'];
  var lang = 'en';

  // rows: [english, es, de, fr, pt, it]
  function add(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      for (var j = 0; j < ORDER.length; j++) if (r[j + 1]) D[ORDER[j]][r[0]] = r[j + 1];
    }
  }
  function valid(l) { return LANGS.indexOf(l) >= 0; }
  function nav() {
    var n = (navigator.languages && navigator.languages[0]) || navigator.language || navigator.userLanguage || 'en';
    n = String(n).slice(0, 2).toLowerCase();
    return valid(n) ? n : 'en';
  }
  function stored(key) {
    try { var v = localStorage.getItem(key); return valid(v) ? v : null; } catch (e) { return null; }
  }
  function t(en, vars, l) {
    l = l || lang;
    var s = (l !== 'en' && D[l] && D[l][en]) || en;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
    return s;
  }

  /* Translate an already-rendered tree by exact match: text nodes, placeholder, title,
     aria-label. Skips [data-noi18n] (user content), inputs' values, scripts and styles. */
  function walk(el, l) {
    l = l || lang;
    if (!el || l === 'en' || !D[l]) return;
    var d = D[l];
    var skip = function (n) {
      for (var p = n; p && p !== el.parentNode; p = p.parentNode) {
        if (p.nodeType === 1) {
          var tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return true;
          if (p.hasAttribute('data-noi18n')) return true;
        }
      }
      return false;
    };
    var tw = document.createTreeWalker(el, 4 /* SHOW_TEXT */, null, false), n, list = [];
    while ((n = tw.nextNode())) list.push(n);
    for (var i = 0; i < list.length; i++) {
      n = list[i];
      var raw = n.nodeValue, key = raw.replace(/^\s+|\s+$/g, '');
      if (!key || !d[key] || skip(n)) continue;
      n.nodeValue = raw.replace(key, d[key]);
    }
    var attrs = ['placeholder', 'title', 'aria-label'];
    var all = el.querySelectorAll ? el.querySelectorAll('[placeholder],[title],[aria-label]') : [];
    for (var k = 0; k < all.length; k++) {
      if (all[k].closest && all[k].closest('[data-noi18n]')) continue;
      for (var a = 0; a < attrs.length; a++) {
        var v = all[k].getAttribute(attrs[a]);
        if (v && d[v]) all[k].setAttribute(attrs[a], d[v]);
      }
    }
  }
  // Keep translating whatever the page renders later.
  function observe(el) {
    if (!window.MutationObserver || lang === 'en') return;
    walk(el);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var added = ms[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var x = added[j];
          if (x.nodeType === 1) walk(x);
          else if (x.nodeType === 3 && x.parentNode) walk(x.parentNode);
        }
      }
    }).observe(el, { childList: true, subtree: true });
  }
  function picker(current, onchange) {
    var s = document.createElement('select');
    s.setAttribute('aria-label', t('Language'));
    s.setAttribute('data-noi18n', '');
    for (var i = 0; i < LANGS.length; i++) {
      var o = document.createElement('option'); o.value = LANGS[i]; o.textContent = NAMES[LANGS[i]];
      if (LANGS[i] === current) o.selected = true; s.appendChild(o);
    }
    s.onchange = function () { onchange(s.value); };
    return s;
  }

  root.LoopI18n = {
    LANGS: LANGS, NAMES: NAMES, add: add, nav: nav, stored: stored, t: t, walk: walk, observe: observe, picker: picker,
    set: function (l) { lang = valid(l) ? l : 'en'; try { document.documentElement.lang = lang; } catch (e) {} return lang; },
    get: function () { return lang; },
    dict: D
  };
})(typeof window !== 'undefined' ? window : this);

/* ── Phones (play.html) ──────────────────────────────────────────────────── */
LoopI18n.add([
['Scan the code on the screen','Escanea el código de la pantalla','Scann den Code auf dem Bildschirm','Scanne le code à l’écran','Leia o código no ecrã','Scansiona il codice sullo schermo'],
['This page opens from the QR code on a LoopSlide screen.','Esta página se abre desde el código QR de una pantalla LoopSlide.','Diese Seite öffnet sich über den QR-Code auf einem LoopSlide-Bildschirm.','Cette page s’ouvre depuis le QR code d’un écran LoopSlide.','Esta página abre a partir do código QR de um ecrã LoopSlide.','Questa pagina si apre dal codice QR di uno schermo LoopSlide.'],
['Game not found','Juego no encontrado','Spiel nicht gefunden','Jeu introuvable','Jogo não encontrado','Gioco non trovato'],
['Scan the code on the screen again.','Vuelve a escanear el código de la pantalla.','Scann den Code auf dem Bildschirm noch einmal.','Scanne à nouveau le code à l’écran.','Leia novamente o código no ecrã.','Scansiona di nuovo il codice sullo schermo.'],
['{n} pts','{n} pts','{n} Pkt.','{n} pts','{n} pts','{n} pt'],
['Pick your player','Elige tu jugador','Wähl deinen Spieler','Choisis ton joueur','Escolha o seu jogador','Scegli il tuo giocatore'],
['Your nickname and emoji show on the big screen when you make the leaderboard.','Tu apodo y tu emoji aparecen en la pantalla grande cuando entras en la clasificación.','Dein Spitzname und dein Emoji erscheinen auf dem großen Bildschirm, wenn du in die Rangliste kommst.','Ton pseudo et ton emoji s’affichent sur le grand écran quand tu entres au classement.','A sua alcunha e o seu emoji aparecem no ecrã grande quando entra na classificação.','Il tuo nickname e la tua emoji compaiono sul grande schermo quando entri in classifica.'],
['Nickname','Apodo','Spitzname','Pseudo','Alcunha','Nickname'],
['I am {n} or older.','Tengo {n} años o más.','Ich bin {n} oder älter.','J’ai {n} ans ou plus.','Tenho {n} anos ou mais.','Ho {n} anni o più.'],
['Play →','Jugar →','Spielen →','Jouer →','Jogar →','Gioca →'],
['No sign-up and no real name needed.','Sin registro y sin nombre real.','Keine Anmeldung, kein echter Name nötig.','Pas d’inscription, pas de vrai nom.','Sem registo e sem nome verdadeiro.','Nessuna registrazione e nessun nome reale.'],
['Run by {name}.','Organizado por {name}.','Veranstaltet von {name}.','Organisé par {name}.','Organizado por {name}.','Organizzato da {name}.'],
['Your nickname and answers are shown on the screen here and kept only while this leaderboard runs, then deleted.','Tu apodo y tus respuestas se muestran en la pantalla de aquí y solo se guardan mientras dura esta clasificación; después se borran.','Dein Spitzname und deine Antworten werden hier auf dem Bildschirm gezeigt und nur so lange gespeichert, wie diese Rangliste läuft – danach gelöscht.','Ton pseudo et tes réponses s’affichent sur l’écran ici et ne sont conservés que pendant ce classement, puis supprimés.','A sua alcunha e as suas respostas aparecem no ecrã aqui e só ficam guardadas enquanto esta classificação decorre; depois são apagadas.','Il tuo nickname e le tue risposte compaiono sullo schermo qui e restano salvati solo finché dura questa classifica, poi vengono cancellati.'],
['no purchase necessary','no es necesario comprar nada','kein Kauf erforderlich','aucun achat nécessaire','não é necessária qualquer compra','nessun acquisto necessario'],
['Official rules','Bases oficiales','Teilnahmebedingungen','Règlement officiel','Regulamento oficial','Regolamento ufficiale'],
['Privacy','Privacidad','Datenschutz','Confidentialité','Privacidade','Privacy'],
['This game is for ages {n}+.','Este juego es para mayores de {n} años.','Dieses Spiel ist ab {n} Jahren.','Ce jeu est réservé aux {n} ans et plus.','Este jogo é para maiores de {n} anos.','Questo gioco è per maggiori di {n} anni.'],
['Pick a different nickname.','Elige otro apodo.','Wähl einen anderen Spitznamen.','Choisis un autre pseudo.','Escolha outra alcunha.','Scegli un altro nickname.'],
['You can’t play this game','No puedes jugar a este juego','Du kannst dieses Spiel nicht spielen','Tu ne peux pas jouer à ce jeu','Não pode jogar este jogo','Non puoi giocare a questo gioco'],
['The venue has removed this player.','El local ha eliminado a este jugador.','Der Veranstalter hat diesen Spieler entfernt.','L’établissement a retiré ce joueur.','O espaço removeu este jogador.','Il locale ha rimosso questo giocatore.'],
['Get ready','Prepárate','Mach dich bereit','Prépare-toi','Prepare-se','Preparati'],
['The next game hasn’t started yet.','La próxima partida aún no ha empezado.','Die nächste Runde hat noch nicht begonnen.','La prochaine partie n’a pas encore commencé.','O próximo jogo ainda não começou.','La prossima partita non è ancora iniziata.'],
['New round!','¡Nueva ronda!','Neue Runde!','Nouvelle manche !','Nova ronda!','Nuovo round!'],
['Scan the code on the screen again to keep playing.','Vuelve a escanear el código de la pantalla para seguir jugando.','Scann den Code auf dem Bildschirm erneut, um weiterzuspielen.','Scanne à nouveau le code à l’écran pour continuer à jouer.','Leia novamente o código no ecrã para continuar a jogar.','Scansiona di nuovo il codice sullo schermo per continuare a giocare.'],
['✨ AI-generated','✨ Generado con IA','✨ KI-generiert','✨ Généré par IA','✨ Gerado por IA','✨ Generato con IA'],
['🌐 Auto-translated','🌐 Traducción automática','🌐 Automatisch übersetzt','🌐 Traduction automatique','🌐 Tradução automática','🌐 Traduzione automatica'],
['Report a problem','Informar de un problema','Problem melden','Signaler un problème','Comunicar um problema','Segnala un problema'],
['Sponsored by {name}','Patrocinado por {name}','Gesponsert von {name}','Sponsorisé par {name}','Patrocinado por {name}','Sponsorizzato da {name}'],
['Sponsored','Patrocinado','Gesponsert','Sponsorisé','Patrocinado','Sponsorizzato'],
['Next question coming up','Ahora viene la siguiente pregunta','Gleich kommt die nächste Frage','La prochaine question arrive','A próxima pergunta vem aí','Sta per arrivare la prossima domanda'],
['Stay tuned','No te vayas','Bleib dran','Reste connecté','Fique atento','Resta sintonizzato'],
['See the offer','Ver la oferta','Zum Angebot','Voir l’offre','Ver a oferta','Vedi l’offerta'],
['Question','Pregunta','Frage','Question','Pergunta','Domanda'],
['Locked in — watch the screen for the answer.','¡Respuesta enviada! Mira la pantalla para ver la solución.','Antwort gespeichert – die Lösung kommt gleich auf dem Bildschirm.','C’est validé — regarde l’écran pour la réponse.','Resposta registada — veja a solução no ecrã.','Risposta inviata — guarda lo schermo per la soluzione.'],
['Faster right answers score more.','Cuanto más rápido aciertas, más puntos.','Je schneller richtig, desto mehr Punkte.','Plus tu réponds vite et juste, plus tu marques.','Quanto mais rápido acertar, mais pontos.','Più rispondi giusto in fretta, più punti fai.'],
['Too late — time was up.','Demasiado tarde: se acabó el tiempo.','Zu spät – die Zeit war um.','Trop tard — le temps était écoulé.','Tarde demais — o tempo acabou.','Troppo tardi — il tempo è scaduto.'],
['That didn’t go through — tap again.','No se ha enviado: vuelve a tocar.','Das hat nicht geklappt – tipp noch einmal.','Ça n’est pas passé — touche à nouveau.','Não foi enviado — toque novamente.','Non è andata — tocca di nuovo.'],
['You missed this one','Esta se te escapó','Die hast du verpasst','Tu as raté celle-ci','Esta escapou-lhe','Questa ti è sfuggita'],
['Answer: {x}','Respuesta: {x}','Antwort: {x}','Réponse : {x}','Resposta: {x}','Risposta: {x}'],
['Thanks for voting!','¡Gracias por votar!','Danke fürs Abstimmen!','Merci d’avoir voté !','Obrigado por votar!','Grazie per aver votato!'],
['You picked {x}.','Elegiste {x}.','Du hast {x} gewählt.','Tu as choisi {x}.','Escolheu {x}.','Hai scelto {x}.'],
['Correct!','¡Correcto!','Richtig!','Bonne réponse !','Certo!','Esatto!'],
['🔥 {n} in a row — bonus points!','🔥 {n} seguidas: ¡puntos extra!','🔥 {n} in Folge – Bonuspunkte!','🔥 {n} d’affilée — points bonus !','🔥 {n} seguidas — pontos bónus!','🔥 {n} di fila — punti bonus!'],
['Keep it going.','Sigue así.','Weiter so.','Continue comme ça.','Continue assim.','Continua così.'],
['Not this time','Esta vez no','Diesmal nicht','Pas cette fois','Desta vez não','Non stavolta'],
['It was {x}.','Era {x}.','Es war {x}.','C’était {x}.','Era {x}.','Era {x}.'],
['🏁 Round over','🏁 Fin de la ronda','🏁 Runde vorbei','🏁 Fin de la manche','🏁 Fim da ronda','🏁 Round finito'],
['🏆 Leaderboard','🏆 Clasificación','🏆 Rangliste','🏆 Classement','🏆 Classificação','🏆 Classifica'],
['⬆️ You moved up to #{n}!','⬆️ ¡Has subido al puesto {n}!','⬆️ Du bist auf Platz {n} aufgestiegen!','⬆️ Tu passes à la {n}e place !','⬆️ Subiu para o {n}.º lugar!','⬆️ Sei salito al {n}° posto!'],
['👑 You’re on top of the leaderboard!','👑 ¡Vas primero en la clasificación!','👑 Du bist an der Spitze der Rangliste!','👑 Tu es en tête du classement !','👑 Está no topo da classificação!','👑 Sei in testa alla classifica!'],
['Your rank','Tu posición','Dein Platz','Ton rang','A sua posição','La tua posizione'],
['of {n}','de {n}','von {n}','sur {n}','de {n}','su {n}'],
['Answer a question to get on the board.','Responde una pregunta para entrar en la clasificación.','Beantworte eine Frage, um in die Rangliste zu kommen.','Réponds à une question pour entrer au classement.','Responda a uma pergunta para entrar na classificação.','Rispondi a una domanda per entrare in classifica.'],
['{n} points to take the crown from {x}.','Te faltan {n} puntos para quitarle la corona a {x}.','Noch {n} Punkte, um {x} die Krone abzunehmen.','Encore {n} points pour prendre la couronne à {x}.','Faltam {n} pontos para tirar a coroa a {x}.','Ti mancano {n} punti per strappare la corona a {x}.'],
['Personal best: {n}','Tu mejor marca: {n}','Persönliche Bestleistung: {n}','Ton record : {n}','Recorde pessoal: {n}','Record personale: {n}'],
['No scores yet.','Todavía no hay puntuaciones.','Noch keine Punkte.','Pas encore de scores.','Ainda não há pontuações.','Ancora nessun punteggio.'],
['No purchase necessary.','No es necesario comprar nada.','Kein Kauf erforderlich.','Aucun achat nécessaire.','Não é necessária qualquer compra.','Nessun acquisto necessario.'],
['Change nickname','Cambiar apodo','Spitznamen ändern','Changer de pseudo','Mudar de alcunha','Cambia nickname'],
['This game is full','Esta partida está llena','Dieses Spiel ist voll','Cette partie est complète','Este jogo está cheio','Questa partita è al completo'],
['This game has room for {n} players per leaderboard. Try again when the leaderboard resets.','Esta partida admite {n} jugadores por clasificación. Vuelve a intentarlo cuando se reinicie.','Dieses Spiel hat Platz für {n} Spieler pro Rangliste. Versuch es wieder, wenn die Rangliste neu startet.','Cette partie accueille {n} joueurs par classement. Réessaie quand le classement repart à zéro.','Este jogo tem lugar para {n} jogadores por classificação. Tente de novo quando a classificação recomeçar.','Questa partita ha posto per {n} giocatori per classifica. Riprova quando la classifica si azzera.'],
['Language','Idioma','Sprache','Langue','Idioma','Lingua'],
]);

/* ── TV (screen.html) ────────────────────────────────────────────────────── */
LoopI18n.add([
['Loading LoopSlide…','Cargando LoopSlide…','LoopSlide wird geladen…','Chargement de LoopSlide…','A carregar o LoopSlide…','Caricamento di LoopSlide…'],
['This screen needs a LoopSlide code.','Esta pantalla necesita un código de LoopSlide.','Dieser Bildschirm braucht einen LoopSlide-Code.','Cet écran a besoin d’un code LoopSlide.','Este ecrã precisa de um código LoopSlide.','Questo schermo ha bisogno di un codice LoopSlide.'],
['Pair it at pollslide.com/tv.','Emparéjala en pollslide.com/tv.','Kopple ihn unter pollslide.com/tv.','Associe-le sur pollslide.com/tv.','Emparelhe-o em pollslide.com/tv.','Associalo su pollslide.com/tv.'],
['No LoopSlide called {x}.','No existe ningún LoopSlide llamado {x}.','Es gibt keinen LoopSlide namens {x}.','Aucun LoopSlide ne s’appelle {x}.','Não existe nenhum LoopSlide chamado {x}.','Nessun LoopSlide si chiama {x}.'],
['Check the link in LoopSlide Studio.','Comprueba el enlace en LoopSlide Studio.','Prüf den Link in LoopSlide Studio.','Vérifie le lien dans LoopSlide Studio.','Verifique o link no LoopSlide Studio.','Controlla il link in LoopSlide Studio.'],
['Scan to play','Escanea para jugar','Scannen und mitspielen','Scanne pour jouer','Leia para jogar','Scansiona per giocare'],
['answered this one','han respondido','haben geantwortet','ont répondu','já responderam','hanno risposto'],
['{x} leads with {n}.','{x} va en cabeza con {n}.','{x} führt mit {n}.','{x} mène avec {n}.','{x} lidera com {n}.','{x} è in testa con {n}.'],
['Can you beat them?','¿Puedes superarlo?','Schaffst du es vorbei?','Tu peux faire mieux ?','Consegue ultrapassar?','Riesci a superarlo?'],
['No one on the board yet — first to answer takes the crown.','Aún no hay nadie en la clasificación: quien responda primero se lleva la corona.','Noch niemand in der Rangliste – wer zuerst antwortet, holt sich die Krone.','Personne au classement pour l’instant — le premier à répondre prend la couronne.','Ainda ninguém na classificação — quem responder primeiro fica com a coroa.','Ancora nessuno in classifica: chi risponde per primo si prende la corona.'],
['No purchase necessary · rules on your phone','No es necesario comprar nada · bases en tu móvil','Kein Kauf erforderlich · Bedingungen auf deinem Handy','Aucun achat nécessaire · règlement sur ton téléphone','Não é necessária qualquer compra · regulamento no telemóvel','Nessun acquisto necessario · regolamento sul telefono'],
['Run by {name}','Organizado por {name}','Veranstaltet von {name}','Organisé par {name}','Organizado por {name}','Organizzato da {name}'],
['Some content made with AI','Parte del contenido se ha creado con IA','Einige Inhalte wurden mit KI erstellt','Une partie du contenu a été créée avec l’IA','Parte do conteúdo foi criada com IA','Alcuni contenuti sono stati creati con l’IA'],
['This LoopSlide has no questions yet.','Este LoopSlide aún no tiene preguntas.','Dieser LoopSlide hat noch keine Fragen.','Ce LoopSlide n’a pas encore de questions.','Este LoopSlide ainda não tem perguntas.','Questo LoopSlide non ha ancora domande.'],
['Add some in LoopSlide Studio and publish.','Añade algunas en LoopSlide Studio y publica.','Füg in LoopSlide Studio welche hinzu und veröffentliche.','Ajoutes-en dans LoopSlide Studio et publie.','Acrescente algumas no LoopSlide Studio e publique.','Aggiungine in LoopSlide Studio e pubblica.'],
['{n}% got it right','{n}% acertaron','{n}% lagen richtig','{n}% ont trouvé','{n}% acertaram','{n}% hanno indovinato'],
['The answer','La respuesta','Die Antwort','La réponse','A resposta','La risposta'],
['How the room voted','Así votó la sala','So hat der Raum abgestimmt','Comment la salle a voté','Como a sala votou','Come ha votato la sala'],
['⚡ Fastest right','⚡ Los más rápidos en acertar','⚡ Am schnellsten richtig','⚡ Les plus rapides','⚡ Os mais rápidos a acertar','⚡ I più veloci a indovinare'],
['🙌 First in','🙌 Los primeros','🙌 Die Ersten','🙌 Les premiers','🙌 Os primeiros','🙌 I primi'],
['Scan for the offer','Escanea para ver la oferta','Scannen für das Angebot','Scanne pour l’offre','Leia para ver a oferta','Scansiona per l’offerta'],
['🏁 {x} — this round','🏁 {x}: esta ronda','🏁 {x} – diese Runde','🏁 {x} — cette manche','🏁 {x} — esta ronda','🏁 {x} — questo round'],
['Round','Ronda','Runde','Manche','Ronda','Round'],
['Counting…','Contando…','Wird gezählt…','Décompte…','A contar…','Conteggio…'],
['Nobody played this round — scan the code and be first next time!','Nadie jugó esta ronda: ¡escanea el código y sé el primero la próxima vez!','Diese Runde hat niemand gespielt – scann den Code und sei nächstes Mal der Erste!','Personne n’a joué cette manche — scanne le code et sois le premier la prochaine fois !','Ninguém jogou esta ronda — leia o código e seja o primeiro da próxima vez!','Nessuno ha giocato questo round: scansiona il codice e sii il primo la prossima volta!'],
['All-time leaders','Líderes de siempre','Ewige Bestenliste','Meilleurs de tous les temps','Líderes de sempre','Migliori di sempre'],
['Leaders this loop','Líderes de este bucle','Die Besten dieses Loops','Meilleurs de cette boucle','Líderes deste loop','Migliori di questo loop'],
['Today’s leaders','Líderes de hoy','Die Besten heute','Meilleurs du jour','Líderes de hoje','Migliori di oggi'],
['Leaders — {n}-day board','Líderes: clasificación de {n} días','Die Besten – {n}-Tage-Rangliste','Meilleurs — classement sur {n} jours','Líderes — classificação de {n} dias','Migliori — classifica di {n} giorni'],
['The board is empty — scan the code and claim the top spot!','La clasificación está vacía: ¡escanea el código y quédate con el primer puesto!','Die Rangliste ist leer – scann den Code und hol dir Platz 1!','Le classement est vide — scanne le code et prends la première place !','A classificação está vazia — leia o código e fique com o primeiro lugar!','La classifica è vuota: scansiona il codice e prenditi il primo posto!'],
['⛶ Full screen','⛶ Pantalla completa','⛶ Vollbild','⛶ Plein écran','⛶ Ecrã inteiro','⛶ Schermo intero'],
]);

/* ── Pairing (tv.html) ───────────────────────────────────────────────────── */
LoopI18n.add([
['Pair this TV','Empareja esta tele','Diesen Fernseher koppeln','Associer cette télé','Emparelhar esta televisão','Associa questa TV'],
['Scan the QR with your phone, or go to pollslide.com/loop → Screens','Escanea el QR con el móvil o ve a pollslide.com/loop → Screens','Scann den QR-Code mit dem Handy oder geh zu pollslide.com/loop → Screens','Scanne le QR avec ton téléphone, ou va sur pollslide.com/loop → Screens','Leia o QR com o telemóvel ou vá a pollslide.com/loop → Screens','Scansiona il QR col telefono oppure vai su pollslide.com/loop → Screens'],
['Sign in, enter the code above and pick a loop','Inicia sesión, escribe el código de arriba y elige un bucle','Melde dich an, gib den Code oben ein und wähl einen Loop','Connecte-toi, saisis le code ci-dessus et choisis une boucle','Inicie sessão, escreva o código acima e escolha um loop','Accedi, inserisci il codice qui sopra e scegli un loop'],
['This TV starts playing on its own','Esta tele empieza a reproducir sola','Dieser Fernseher legt von allein los','Cette télé démarre toute seule','Esta televisão começa a passar sozinha','Questa TV parte da sola'],
['Turn off the TV’s sleep timer so it stays on. The code changes every 10 minutes.','Desactiva el temporizador de apagado de la tele para que siga encendida. El código cambia cada 10 minutos.','Schalte den Sleep-Timer des Fernsehers aus, damit er an bleibt. Der Code ändert sich alle 10 Minuten.','Désactive la mise en veille de la télé pour qu’elle reste allumée. Le code change toutes les 10 minutes.','Desligue o temporizador de suspensão da televisão para ela ficar ligada. O código muda a cada 10 minutos.','Disattiva lo spegnimento programmato della TV così resta accesa. Il codice cambia ogni 10 minuti.'],
['Scan to pair','Escanea para emparejar','Zum Koppeln scannen','Scanne pour associer','Leia para emparelhar','Scansiona per associare'],
['This TV browser does not keep settings, so it may ask to be paired again after it restarts.','El navegador de esta tele no guarda los ajustes, así que puede pedir emparejarse otra vez al reiniciarse.','Der Browser dieses Fernsehers speichert keine Einstellungen, daher kann er nach einem Neustart erneut nach der Kopplung fragen.','Le navigateur de cette télé ne garde pas les réglages : elle peut redemander l’association après un redémarrage.','O navegador desta televisão não guarda as definições, por isso pode pedir novo emparelhamento depois de reiniciar.','Il browser di questa TV non conserva le impostazioni, quindi potrebbe chiedere di nuovo l’associazione dopo il riavvio.'],
['Could not get a pairing code. Check this TV is connected to the internet.','No se pudo obtener un código. Comprueba que la tele está conectada a internet.','Kein Kopplungscode möglich. Prüf, ob der Fernseher mit dem Internet verbunden ist.','Impossible d’obtenir un code. Vérifie que la télé est connectée à internet.','Não foi possível obter um código. Verifique se a televisão está ligada à internet.','Impossibile ottenere un codice. Controlla che la TV sia connessa a internet.'],
['Waiting for the internet connection…','Esperando la conexión a internet…','Warte auf die Internetverbindung…','En attente de la connexion internet…','À espera da ligação à internet…','In attesa della connessione internet…'],
]);

/* ── Studio (loop.html) ──────────────────────────────────────────────────── */
LoopI18n.add([
['← Back to PollSlide','← Volver a PollSlide','← Zurück zu PollSlide','← Retour à PollSlide','← Voltar ao PollSlide','← Torna a PollSlide'],
['Sign in to LoopSlide','Inicia sesión en LoopSlide','Bei LoopSlide anmelden','Connecte-toi à LoopSlide','Iniciar sessão no LoopSlide','Accedi a LoopSlide'],
['Use your PollSlide account.','Usa tu cuenta de PollSlide.','Nutz dein PollSlide-Konto.','Utilise ton compte PollSlide.','Use a sua conta PollSlide.','Usa il tuo account PollSlide.'],
['Sign in','Iniciar sesión','Anmelden','Se connecter','Iniciar sessão','Accedi'],
['No account?','¿No tienes cuenta?','Kein Konto?','Pas de compte ?','Não tem conta?','Non hai un account?'],
['Create one free in PollSlide','Crea una gratis en PollSlide','Erstell eins kostenlos in PollSlide','Crées-en un gratuitement dans PollSlide','Crie uma grátis no PollSlide','Creane uno gratis in PollSlide'],
[', then come back.','y luego vuelve.',' und komm dann zurück.',', puis reviens.',' e depois volte.',', poi torna qui.'],
['Email','Email','E-Mail','E-mail','Email','Email'],
['Password','Contraseña','Passwort','Mot de passe','Palavra-passe','Password'],
['Your loops','Tus bucles','Deine Loops','Tes boucles','Os seus loops','I tuoi loop'],
['A loop plays your questions on a screen, over and over. People scan the QR, play on their phones, and climb the leaderboard.','Un bucle reproduce tus preguntas en una pantalla, una y otra vez. La gente escanea el QR, juega desde el móvil y sube en la clasificación.','Ein Loop spielt deine Fragen immer wieder auf einem Bildschirm ab. Die Leute scannen den QR-Code, spielen auf dem Handy und klettern in der Rangliste.','Une boucle diffuse tes questions sur un écran, encore et encore. Les gens scannent le QR, jouent sur leur téléphone et grimpent au classement.','Um loop passa as suas perguntas num ecrã, vezes sem conta. As pessoas leem o QR, jogam no telemóvel e sobem na classificação.','Un loop manda in onda le tue domande su uno schermo, a ciclo continuo. Le persone scansionano il QR, giocano dal telefono e scalano la classifica.'],
['📺 Screens','📺 Pantallas','📺 Bildschirme','📺 Écrans','📺 Ecrãs','📺 Schermi'],
['+ New loop','+ Nuevo bucle','+ Neuer Loop','+ Nouvelle boucle','+ Novo loop','+ Nuovo loop'],
['● Live','● En directo','● Live','● En direct','● Em direto','● Live'],
['Draft','Borrador','Entwurf','Brouillon','Rascunho','Bozza'],
['{n} questions · code {x}','{n} preguntas · código {x}','{n} Fragen · Code {x}','{n} questions · code {x}','{n} perguntas · código {x}','{n} domande · codice {x}'],
['{n} questions','{n} preguntas','{n} Fragen','{n} questions','{n} perguntas','{n} domande'],
['📺 Putting a loop on a TV','📺 Poner un bucle en una tele','📺 Einen Loop auf den Fernseher bringen','📺 Mettre une boucle sur une télé','📺 Pôr um loop numa televisão','📺 Mettere un loop su una TV'],
['On the TV\'s web browser, go to','En el navegador de la tele, ve a','Geh im Browser des Fernsehers zu','Dans le navigateur de la télé, va sur','No navegador da televisão, vá a','Nel browser della TV, vai su'],
['. It shows a code and a QR. Scan the QR with your phone (or click','. Muestra un código y un QR. Escanea el QR con el móvil (o haz clic en','. Er zeigt einen Code und einen QR-Code. Scann den QR-Code mit dem Handy (oder klick auf','. Elle affiche un code et un QR. Scanne le QR avec ton téléphone (ou clique sur','. Mostra um código e um QR. Leia o QR com o telemóvel (ou clique em','. Mostra un codice e un QR. Scansiona il QR col telefono (oppure clicca'],
['📺 Screens → Add a screen','📺 Pantallas → Añadir una pantalla','📺 Bildschirme → Bildschirm hinzufügen','📺 Écrans → Ajouter un écran','📺 Ecrãs → Adicionar um ecrã','📺 Schermi → Aggiungi uno schermo'],
['here and type the code), pick a loop, and the TV starts playing. After that you never touch the TV again — switch loops from here.','aquí y escribe el código), elige un bucle y la tele empieza. A partir de ahí no vuelves a tocar la tele: cambia de bucle desde aquí.','hier und gib den Code ein), wähl einen Loop, und der Fernseher legt los. Danach fasst du ihn nie wieder an – Loops wechselst du hier.','ici et tape le code), choisis une boucle, et la télé démarre. Ensuite, tu ne touches plus la télé — change de boucle d’ici.','aqui e escreva o código), escolha um loop e a televisão começa. Depois disso nunca mais mexe na televisão — mude de loop aqui.','qui e digita il codice), scegli un loop e la TV parte. Da lì in poi non tocchi più la TV: cambi loop da qui.'],
['No browser on your TV? A Fire TV Stick has one built in.','¿Tu tele no tiene navegador? Un Fire TV Stick lo trae incluido.','Kein Browser auf deinem Fernseher? Ein Fire TV Stick hat einen eingebaut.','Pas de navigateur sur ta télé ? Un Fire TV Stick en a un intégré.','A sua televisão não tem navegador? Um Fire TV Stick tem um incluído.','La tua TV non ha un browser? Un Fire TV Stick ne ha uno integrato.'],
['Which TVs work →','Qué teles sirven →','Welche Fernseher funktionieren →','Quelles télés fonctionnent →','Que televisões funcionam →','Quali TV funzionano →'],
['Make your first loop','Crea tu primer bucle','Erstell deinen ersten Loop','Crée ta première boucle','Crie o seu primeiro loop','Crea il tuo primo loop'],
['Start from scratch, or import any deck you already have in PollSlide — polls, quizzes, surveys or study sets.','Empieza desde cero o importa cualquier presentación que ya tengas en PollSlide: encuestas, quizzes, sondeos o sets de estudio.','Fang bei null an oder importiere ein Deck, das du schon in PollSlide hast – Umfragen, Quizze, Befragungen oder Lernsets.','Pars de zéro, ou importe n’importe quel deck que tu as déjà dans PollSlide — sondages, quiz, enquêtes ou sets de révision.','Comece do zero ou importe qualquer deck que já tenha no PollSlide — sondagens, quizzes, inquéritos ou conjuntos de estudo.','Parti da zero o importa un deck che hai già in PollSlide: sondaggi, quiz, questionari o set di studio.'],
['← Loops','← Bucles','← Loops','← Boucles','← Loops','← Loop'],
['One full loop ≈ {n} min · {a} / {b} slides','Un bucle completo ≈ {n} min · {a} / {b} diapositivas','Ein ganzer Loop ≈ {n} Min. · {a} / {b} Folien','Une boucle complète ≈ {n} min · {a} / {b} diapos','Um loop completo ≈ {n} min · {a} / {b} diapositivos','Un loop completo ≈ {n} min · {a} / {b} slide'],
['🗑 Delete loop','🗑 Eliminar bucle','🗑 Loop löschen','🗑 Supprimer la boucle','🗑 Eliminar loop','🗑 Elimina loop'],
['Save','Guardar','Speichern','Enregistrer','Guardar','Salva'],
['Publish','Publicar','Veröffentlichen','Publier','Publicar','Pubblica'],
['Publish changes','Publicar cambios','Änderungen veröffentlichen','Publier les modifications','Publicar alterações','Pubblica le modifiche'],
['It\'s live','Está en directo','Es ist live','C’est en ligne','Está em direto','È live'],
['Code {x}','Código {x}','Code {x}','Code {x}','Código {x}','Codice {x}'],
['📺 Put on a TV','📺 Poner en una tele','📺 Auf einen Fernseher bringen','📺 Mettre sur une télé','📺 Pôr numa televisão','📺 Metti su una TV'],
['Open screen here','Abrir la pantalla aquí','Bildschirm hier öffnen','Ouvrir l’écran ici','Abrir o ecrã aqui','Apri lo schermo qui'],
['Copy screen link','Copiar enlace de pantalla','Bildschirm-Link kopieren','Copier le lien d’écran','Copiar link do ecrã','Copia link dello schermo'],
['📱 Try it on this device','📱 Pruébalo en este dispositivo','📱 Auf diesem Gerät ausprobieren','📱 Essaie sur cet appareil','📱 Experimente neste dispositivo','📱 Provalo su questo dispositivo'],
['↺ Restart from the top','↺ Empezar desde el principio','↺ Von vorn beginnen','↺ Recommencer depuis le début','↺ Recomeçar do início','↺ Ricomincia dall’inizio'],
['👥 Players & moderation','👥 Jugadores y moderación','👥 Spieler & Moderation','👥 Joueurs et modération','👥 Jogadores e moderação','👥 Giocatori e moderazione'],
['Clear the leaderboard','Vaciar la clasificación','Rangliste leeren','Vider le classement','Limpar a classificação','Svuota la classifica'],
['Basics','Lo básico','Grundlagen','L’essentiel','Básico','Impostazioni di base'],
['Loop name','Nombre del bucle','Name des Loops','Nom de la boucle','Nome do loop','Nome del loop'],
['Title shown on screen','Título en pantalla','Titel auf dem Bildschirm','Titre affiché à l’écran','Título no ecrã','Titolo sullo schermo'],
['Logo (https image link)','Logo (enlace https a una imagen)','Logo (https-Bildlink)','Logo (lien https vers une image)','Logótipo (link https de imagem)','Logo (link https a un’immagine)'],
['Accent colour','Color de acento','Akzentfarbe','Couleur d’accent','Cor de destaque','Colore di accento'],
['Questions are written in','Las preguntas están escritas en','Die Fragen sind geschrieben auf','Les questions sont écrites en','As perguntas estão escritas em','Le domande sono scritte in'],
['TV screen language','Idioma de la pantalla de la tele','Sprache auf dem Fernseher','Langue de l’écran télé','Idioma do ecrã da televisão','Lingua dello schermo TV'],
['Automatic (the TV\'s own language)','Automático (el idioma de la tele)','Automatisch (Sprache des Fernsehers)','Automatique (la langue de la télé)','Automático (o idioma da televisão)','Automatica (la lingua della TV)'],
['Translate questions for players automatically','Traducir las preguntas automáticamente para los jugadores','Fragen für Spieler automatisch übersetzen','Traduire automatiquement les questions pour les joueurs','Traduzir automaticamente as perguntas para os jogadores','Traduci automaticamente le domande per i giocatori'],
['Each player sees the game in their phone\'s language. Questions are translated by AI when you publish, and labelled “Auto-translated” so players know. Answers and scores are the same in every language.','Cada jugador ve el juego en el idioma de su móvil. Las preguntas se traducen con IA al publicar y se marcan como “Traducción automática” para que los jugadores lo sepan. Las respuestas y los puntos son iguales en todos los idiomas.','Jeder Spieler sieht das Spiel in der Sprache seines Handys. Die Fragen werden beim Veröffentlichen per KI übersetzt und als „Automatisch übersetzt“ gekennzeichnet, damit die Spieler es wissen. Antworten und Punkte sind in jeder Sprache gleich.','Chaque joueur voit le jeu dans la langue de son téléphone. Les questions sont traduites par IA quand tu publies, et signalées « Traduction automatique » pour que les joueurs le sachent. Les réponses et les scores sont les mêmes dans toutes les langues.','Cada jogador vê o jogo no idioma do telemóvel. As perguntas são traduzidas por IA quando publica e identificadas como “Tradução automática” para os jogadores saberem. As respostas e os pontos são iguais em todos os idiomas.','Ogni giocatore vede il gioco nella lingua del suo telefono. Le domande vengono tradotte con l’IA quando pubblichi ed etichettate “Traduzione automatica”, così i giocatori lo sanno. Risposte e punteggi sono uguali in ogni lingua.'],
['Timing','Tiempos','Timing','Minutage','Tempos','Tempi'],
['Seconds to answer','Segundos para responder','Sekunden zum Antworten','Secondes pour répondre','Segundos para responder','Secondi per rispondere'],
['Seconds showing the answer','Segundos mostrando la respuesta','Sekunden mit der Lösung','Secondes d’affichage de la réponse','Segundos a mostrar a resposta','Secondi di visualizzazione della risposta'],
['Seconds per sponsor card','Segundos por tarjeta de patrocinio','Sekunden pro Sponsorenkarte','Secondes par carte sponsor','Segundos por cartão de patrocínio','Secondi per scheda sponsor'],
['Seconds per leaderboard','Segundos por clasificación','Sekunden pro Rangliste','Secondes par classement','Segundos por classificação','Secondi per classifica'],
['Leaderboard & game rules','Clasificación y reglas del juego','Rangliste & Spielregeln','Classement et règles du jeu','Classificação e regras do jogo','Classifica e regole del gioco'],
['Leaderboard resets','La clasificación se reinicia','Rangliste wird zurückgesetzt','Remise à zéro du classement','A classificação recomeça','La classifica si azzera'],
['Every time the loop starts over','Cada vez que el bucle vuelve a empezar','Jedes Mal, wenn der Loop neu beginnt','À chaque nouveau tour de boucle','Sempre que o loop recomeça','Ogni volta che il loop ricomincia'],
['Every N days','Cada N días','Alle N Tage','Tous les N jours','A cada N dias','Ogni N giorni'],
['Never (all-time board)','Nunca (clasificación histórica)','Nie (ewige Rangliste)','Jamais (classement éternel)','Nunca (classificação de sempre)','Mai (classifica di sempre)'],
['N days (1 = daily, at midnight your time)','N días (1 = diaria, a medianoche en tu hora)','N Tage (1 = täglich, um Mitternacht deiner Zeit)','N jours (1 = quotidien, à minuit heure locale)','N dias (1 = diária, à meia-noite na sua hora)','N giorni (1 = ogni giorno, a mezzanotte ora locale)'],
['Players shown on the board','Jugadores en la clasificación','Spieler in der Rangliste','Joueurs affichés au classement','Jogadores na classificação','Giocatori mostrati in classifica'],
['Faster right answers earn more points','Acertar más rápido da más puntos','Schnellere richtige Antworten bringen mehr Punkte','Les bonnes réponses plus rapides rapportent plus','Respostas certas mais rápidas valem mais pontos','Le risposte giuste più veloci valgono più punti'],
['Streak bonus — up to 2× for answers in a row','Bonus por racha: hasta 2× por aciertos seguidos','Serienbonus – bis zu 2× für Treffer in Folge','Bonus de série — jusqu’à 2× pour les bonnes réponses d’affilée','Bónus de sequência — até 2× por respostas certas seguidas','Bonus serie — fino a 2× per risposte giuste di fila'],
['Players must re-scan the screen each loop (keeps it to people who are actually there)','Los jugadores deben volver a escanear en cada bucle (así solo juega quien está en el local)','Spieler müssen jeden Loop neu scannen (so spielen nur Leute, die wirklich da sind)','Les joueurs doivent rescanner l’écran à chaque boucle (réservé à ceux qui sont vraiment là)','Os jogadores têm de voltar a ler o ecrã em cada loop (só joga quem está mesmo lá)','I giocatori devono riscansionare lo schermo a ogni loop (gioca solo chi è davvero lì)'],
['Rules & compliance','Reglas y cumplimiento','Regeln & Compliance','Règles et conformité','Regras e conformidade','Regole e conformità'],
['Shown to players before they play. You\'re the organiser — the business running this at your venue — so players need to know who you are and how to reach you. These are the basics most countries require; they\'re not legal advice.','Se muestra a los jugadores antes de jugar. Tú eres el organizador —el negocio que lo lleva en tu local—, así que los jugadores deben saber quién eres y cómo contactarte. Es lo básico que exigen la mayoría de países; no es asesoramiento legal.','Wird den Spielern vor dem Spielen angezeigt. Du bist der Veranstalter – das Unternehmen, das das bei dir vor Ort betreibt –, also müssen die Spieler wissen, wer du bist und wie sie dich erreichen. Das sind die Grundlagen, die die meisten Länder verlangen; keine Rechtsberatung.','Affiché aux joueurs avant de jouer. Tu es l’organisateur — l’entreprise qui gère ça dans ton établissement —, donc les joueurs doivent savoir qui tu es et comment te joindre. Ce sont les bases exigées par la plupart des pays ; ce n’est pas un conseil juridique.','Mostrado aos jogadores antes de jogarem. É o organizador — a empresa que gere isto no seu espaço —, por isso os jogadores precisam de saber quem é e como o contactar. É o básico exigido na maioria dos países; não é aconselhamento jurídico.','Mostrato ai giocatori prima di giocare. Sei l’organizzatore — l’attività che lo gestisce nel tuo locale —, quindi i giocatori devono sapere chi sei e come contattarti. Sono le basi richieste dalla maggior parte dei paesi; non è una consulenza legale.'],
['Organiser (your business name) *','Organizador (nombre de tu negocio) *','Veranstalter (Name deines Unternehmens) *','Organisateur (nom de ton entreprise) *','Organizador (nome da sua empresa) *','Organizzatore (nome della tua attività) *'],
['Contact email for players *','Email de contacto para jugadores *','Kontakt-E-Mail für Spieler *','E-mail de contact pour les joueurs *','Email de contacto para jogadores *','Email di contatto per i giocatori *'],
['Minimum age','Edad mínima','Mindestalter','Âge minimum','Idade mínima','Età minima'],
['No age limit','Sin límite de edad','Keine Altersgrenze','Pas de limite d’âge','Sem limite de idade','Nessun limite di età'],
['18+ (e.g. bars in most countries)','18+ (p. ej., bares en la mayoría de países)','18+ (z. B. Bars in den meisten Ländern)','18+ (ex. bars dans la plupart des pays)','18+ (ex.: bares na maioria dos países)','18+ (es. bar nella maggior parte dei paesi)'],
['21+ (e.g. US bars)','21+ (p. ej., bares de EE. UU.)','21+ (z. B. Bars in den USA)','21+ (ex. bars aux États-Unis)','21+ (ex.: bares nos EUA)','21+ (es. bar negli USA)'],
['Prize (optional)','Premio (opcional)','Preis (optional)','Lot (facultatif)','Prémio (opcional)','Premio (facoltativo)'],
['Official rules link (required if there\'s a prize)','Enlace a las bases oficiales (obligatorio si hay premio)','Link zu den Teilnahmebedingungen (Pflicht bei einem Preis)','Lien vers le règlement officiel (obligatoire s’il y a un lot)','Link para o regulamento oficial (obrigatório se houver prémio)','Link al regolamento ufficiale (obbligatorio se c’è un premio)'],
['This loop uses AI-generated text, images or video — show “Some content made with AI” on screen','Este bucle usa texto, imágenes o vídeo generados con IA: mostrar “Parte del contenido se ha creado con IA” en pantalla','Dieser Loop nutzt KI-generierte Texte, Bilder oder Videos – „Einige Inhalte wurden mit KI erstellt“ auf dem Bildschirm zeigen','Cette boucle utilise du texte, des images ou des vidéos générés par IA — afficher « Une partie du contenu a été créée avec l’IA » à l’écran','Este loop usa texto, imagens ou vídeo gerados por IA — mostrar “Parte do conteúdo foi criada com IA” no ecrã','Questo loop usa testi, immagini o video generati con l’IA — mostra “Alcuni contenuti sono stati creati con l’IA” sullo schermo'],
['Prizes turn a game into a promotion, which has its own rules in most places (e.g. US sweepstakes and skill-contest laws, UK and Canadian promotion rules, Quebec\'s registration). Winners here are decided by skill and speed, and no purchase is ever needed to play — keep it that way, and publish your own official rules.','Los premios convierten un juego en una promoción, que tiene sus propias normas en casi todas partes (p. ej., leyes de sorteos y concursos de habilidad de EE. UU., normas de promociones de Reino Unido y Canadá, registro en Quebec). Aquí los ganadores se deciden por habilidad y rapidez, y nunca hace falta comprar para jugar: mantenlo así y publica tus propias bases oficiales.','Preise machen aus einem Spiel eine Werbeaktion, für die fast überall eigene Regeln gelten (z. B. US-Gewinnspiel- und Geschicklichkeitsgesetze, Aktionsregeln in Großbritannien und Kanada, Registrierung in Québec). Hier entscheiden Wissen und Tempo, und zum Mitspielen muss nie etwas gekauft werden – bleib dabei und veröffentliche deine eigenen Teilnahmebedingungen.','Un lot transforme un jeu en opération promotionnelle, qui a ses propres règles presque partout (ex. lois américaines sur les tirages au sort et concours d’adresse, règles britanniques et canadiennes, enregistrement au Québec). Ici, les gagnants sont départagés par le savoir et la rapidité, et aucun achat n’est jamais nécessaire — garde ça ainsi et publie ton propre règlement.','Os prémios transformam um jogo numa promoção, que tem regras próprias na maioria dos sítios (ex.: leis de sorteios e concursos de perícia nos EUA, regras de promoções no Reino Unido e Canadá, registo no Quebeque). Aqui os vencedores são decididos por conhecimento e rapidez, e nunca é preciso comprar nada para jogar — mantenha assim e publique o seu próprio regulamento.','I premi trasformano un gioco in una promozione, che ha le sue regole quasi ovunque (es. leggi USA su lotterie e concorsi di abilità, regole britanniche e canadesi, registrazione in Québec). Qui i vincitori si decidono per abilità e velocità, e non serve mai acquistare nulla per giocare: mantienilo così e pubblica il tuo regolamento ufficiale.'],
['Rounds','Rondas','Runden','Manches','Rondas','Round'],
['Each round ends with its own leaderboard. With more than one round, the loop ends with the overall leaderboard.','Cada ronda termina con su propia clasificación. Con más de una ronda, el bucle acaba con la clasificación general.','Jede Runde endet mit einer eigenen Rangliste. Bei mehreren Runden endet der Loop mit der Gesamtrangliste.','Chaque manche se termine par son propre classement. Avec plusieurs manches, la boucle se termine par le classement général.','Cada ronda termina com a sua própria classificação. Com mais de uma ronda, o loop acaba com a classificação geral.','Ogni round termina con la sua classifica. Con più round, il loop si chiude con la classifica generale.'],
['⬇ Import a PollSlide deck','⬇ Importar una presentación de PollSlide','⬇ PollSlide-Deck importieren','⬇ Importer un deck PollSlide','⬇ Importar um deck do PollSlide','⬇ Importa un deck PollSlide'],
['Import file','Importar archivo','Datei importieren','Importer un fichier','Importar ficheiro','Importa file'],
['Export file','Exportar archivo','Datei exportieren','Exporter un fichier','Exportar ficheiro','Esporta file'],
['+ Round','+ Ronda','+ Runde','+ Manche','+ Ronda','+ Round'],
['⬆ Send to PollSlide','⬆ Enviar a PollSlide','⬆ An PollSlide senden','⬆ Envoyer vers PollSlide','⬆ Enviar para o PollSlide','⬆ Invia a PollSlide'],
['Delete round','Eliminar ronda','Runde löschen','Supprimer la manche','Eliminar ronda','Elimina round'],
['❓ Question {n}','❓ Pregunta {n}','❓ Frage {n}','❓ Question {n}','❓ Pergunta {n}','❓ Domanda {n}'],
['+ Option','+ Opción','+ Option','+ Option','+ Opção','+ Opzione'],
['Opinion — no right answer','Opinión: sin respuesta correcta','Meinung – keine richtige Antwort','Opinion — pas de bonne réponse','Opinião — sem resposta certa','Opinione — nessuna risposta giusta'],
['✨ Made with AI','✨ Hecho con IA','✨ Mit KI erstellt','✨ Créé avec l’IA','✨ Feito com IA','✨ Creato con l’IA'],
['📣 Sponsor card','📣 Tarjeta de patrocinio','📣 Sponsorenkarte','📣 Carte sponsor','📣 Cartão de patrocínio','📣 Scheda sponsor'],
['🖼️ Media card','🖼️ Tarjeta multimedia','🖼️ Medienkarte','🖼️ Carte média','🖼️ Cartão multimédia','🖼️ Scheda media'],
['This is an ad — label it “Sponsored”','Es un anuncio: márcalo como “Patrocinado”','Das ist Werbung – als „Gesponsert“ kennzeichnen','C’est une pub — l’indiquer « Sponsorisé »','É um anúncio — identificar como “Patrocinado”','È una pubblicità — etichettala “Sponsorizzato”'],
['+ Question','+ Pregunta','+ Frage','+ Question','+ Pergunta','+ Domanda'],
['+ Media card','+ Tarjeta multimedia','+ Medienkarte','+ Carte média','+ Cartão multimédia','+ Scheda media'],
['+ Sponsor card','+ Tarjeta de patrocinio','+ Sponsorenkarte','+ Carte sponsor','+ Cartão de patrocínio','+ Scheda sponsor'],
['No questions yet.','Aún no hay preguntas.','Noch keine Fragen.','Pas encore de questions.','Ainda não há perguntas.','Ancora nessuna domanda.'],
['e.g. The Crown & Anchor Quiz Loop','p. ej., El bucle de preguntas del Crown & Anchor','z. B. Das Quiz-Loop im Crown & Anchor','ex. La boucle quiz du Crown & Anchor','ex.: O loop de quiz do Crown & Anchor','es. Il loop quiz del Crown & Anchor'],
['e.g. Crown & Anchor Ltd','p. ej., Crown & Anchor S.L.','z. B. Crown & Anchor GmbH','ex. Crown & Anchor SARL','ex.: Crown & Anchor, Lda.','es. Crown & Anchor S.r.l.'],
['e.g. Tonight\'s winner gets a free pitcher','p. ej., El ganador de esta noche se lleva una jarra gratis','z. B. Der Sieger heute Abend bekommt einen Krug gratis','ex. Le gagnant de ce soir gagne un pichet offert','ex.: O vencedor desta noite ganha um jarro grátis','es. Il vincitore di stasera riceve una caraffa gratis'],
['Round title','Título de la ronda','Titel der Runde','Titre de la manche','Título da ronda','Titolo del round'],
['Ask something… emojis welcome 🎉','Pregunta algo… los emojis son bienvenidos 🎉','Frag etwas… Emojis willkommen 🎉','Pose une question… les emojis sont les bienvenus 🎉','Pergunte algo… emojis são bem-vindos 🎉','Chiedi qualcosa… emoji benvenute 🎉'],
['Add an emoji','Añadir un emoji','Emoji hinzufügen','Ajouter un emoji','Adicionar um emoji','Aggiungi un’emoji'],
['Right answer','Respuesta correcta','Richtige Antwort','Bonne réponse','Resposta certa','Risposta giusta'],
['Option {n}','Opción {n}','Option {n}','Option {n}','Opção {n}','Opzione {n}'],
['Answer image (https)','Imagen de la respuesta (https)','Bild zur Antwort (https)','Image de la réponse (https)','Imagem da resposta (https)','Immagine della risposta (https)'],
['Image, GIF or video for the question (https, optional)','Imagen, GIF o vídeo para la pregunta (https, opcional)','Bild, GIF oder Video zur Frage (https, optional)','Image, GIF ou vidéo pour la question (https, facultatif)','Imagem, GIF ou vídeo para a pergunta (https, opcional)','Immagine, GIF o video per la domanda (https, facoltativo)'],
['Secs (default)','Seg. (predet.)','Sek. (Standard)','Sec. (défaut)','Seg. (predef.)','Sec. (predef.)'],
['Seconds to answer this question — leave blank for the loop\'s default','Segundos para responder esta pregunta; déjalo vacío para usar el valor del bucle','Sekunden für diese Frage – leer lassen für den Standard des Loops','Secondes pour répondre à cette question — laisse vide pour la valeur de la boucle','Segundos para responder a esta pergunta — deixe vazio para usar o valor do loop','Secondi per rispondere a questa domanda — lascia vuoto per il valore del loop'],
['Shows an “AI-generated” label with this question, as AI-transparency laws require','Muestra la etiqueta “Generado con IA” en esta pregunta, como exigen las leyes de transparencia de IA','Zeigt bei dieser Frage die Kennzeichnung „KI-generiert“, wie es KI-Transparenzgesetze verlangen','Affiche la mention « Généré par IA » sur cette question, comme l’exigent les lois sur la transparence de l’IA','Mostra a etiqueta “Gerado por IA” nesta pergunta, como exigem as leis de transparência da IA','Mostra l’etichetta “Generato con IA” su questa domanda, come richiedono le leggi sulla trasparenza dell’IA'],
['Headline — e.g. 2-for-1 wings until 9pm','Titular: p. ej., Alitas 2x1 hasta las 21:00','Überschrift – z. B. Chicken Wings 2 für 1 bis 21 Uhr','Titre — ex. Ailes de poulet 2 pour 1 jusqu’à 21 h','Título — ex.: Asas 2 por 1 até às 21h','Titolo — es. Alette 2x1 fino alle 21'],
['Headline — e.g. Happy birthday, Jess! 🎂','Titular: p. ej., ¡Feliz cumpleaños, Jess! 🎂','Überschrift – z. B. Alles Gute zum Geburtstag, Jess! 🎂','Titre — ex. Joyeux anniversaire, Jess ! 🎂','Título — ex.: Parabéns, Jess! 🎂','Titolo — es. Buon compleanno, Jess! 🎂'],
['Image, GIF or video (https link)','Imagen, GIF o vídeo (enlace https)','Bild, GIF oder Video (https-Link)','Image, GIF ou vidéo (lien https)','Imagem, GIF ou vídeo (link https)','Immagine, GIF o video (link https)'],
['Who it\'s from — e.g. Crown & Anchor Kitchen (required for ads)','De quién es: p. ej., Crown & Anchor Kitchen (obligatorio en anuncios)','Von wem – z. B. Crown & Anchor Kitchen (Pflicht bei Werbung)','De qui — ex. Crown & Anchor Kitchen (obligatoire pour les pubs)','De quem é — ex.: Crown & Anchor Kitchen (obrigatório em anúncios)','Di chi è — es. Crown & Anchor Kitchen (obbligatorio per le pubblicità)'],
['Details (optional)','Detalles (opcional)','Details (optional)','Détails (facultatif)','Detalhes (opcional)','Dettagli (facoltativo)'],
['Link for a scannable QR (https, optional)','Enlace para un QR escaneable (https, opcional)','Link für einen scannbaren QR-Code (https, optional)','Lien pour un QR à scanner (https, facultatif)','Link para um QR (https, opcional)','Link per un QR da scansionare (https, facoltativo)'],
['Screens','Pantallas','Bildschirme','Écrans','Ecrãs','Schermi'],
['TVs showing your loops · {n} of {max} on {plan}','Teles con tus bucles · {n} de {max} en {plan}','Fernseher mit deinen Loops · {n} von {max} im Tarif {plan}','Télés affichant tes boucles · {n} sur {max} avec {plan}','Televisões com os seus loops · {n} de {max} no plano {plan}','TV con i tuoi loop · {n} su {max} con {plan}'],
['TVs showing your loops · {n} on {plan}','Teles con tus bucles · {n} en {plan}','Fernseher mit deinen Loops · {n} im Tarif {plan}','Télés affichant tes boucles · {n} avec {plan}','Televisões com os seus loops · {n} no plano {plan}','TV con i tuoi loop · {n} con {plan}'],
['➕ Add a screen','➕ Añadir una pantalla','➕ Bildschirm hinzufügen','➕ Ajouter un écran','➕ Adicionar um ecrã','➕ Aggiungi uno schermo'],
['On the TV\'s web browser, go to','En el navegador de la tele, ve a','Geh im Browser des Fernsehers zu','Dans le navigateur de la télé, va sur','No navegador da televisão, vá a','Nel browser della TV, vai su'],
['Type the 6-letter code the TV shows — or just scan the QR on the TV with your phone','Escribe el código de 6 caracteres que muestra la tele, o simplemente escanea el QR de la tele con el móvil','Gib den 6-stelligen Code vom Fernseher ein – oder scann einfach den QR-Code auf dem Fernseher mit dem Handy','Tape le code à 6 caractères affiché sur la télé — ou scanne simplement le QR de la télé avec ton téléphone','Escreva o código de 6 caracteres que a televisão mostra — ou simplesmente leia o QR da televisão com o telemóvel','Digita il codice di 6 caratteri che mostra la TV, oppure scansiona il QR della TV col telefono'],
['Pick a loop and press','Elige un bucle y pulsa','Wähl einen Loop und drück','Choisis une boucle et appuie sur','Escolha um loop e carregue em','Scegli un loop e premi'],
['Pair','Emparejar','Koppeln','Associer','Emparelhar','Associa'],
['Pairing…','Emparejando…','Wird gekoppelt…','Association…','A emparelhar…','Associazione…'],
['. The TV starts playing in a few seconds.','. La tele empieza en unos segundos.','. Der Fernseher legt in wenigen Sekunden los.','. La télé démarre en quelques secondes.','. A televisão começa dentro de segundos.','. La TV parte in pochi secondi.'],
['Publish a loop first — a TV can only play a published loop.','Publica antes un bucle: una tele solo puede reproducir bucles publicados.','Veröffentliche zuerst einen Loop – ein Fernseher kann nur veröffentlichte Loops abspielen.','Publie d’abord une boucle — une télé ne peut lire qu’une boucle publiée.','Publique primeiro um loop — uma televisão só passa loops publicados.','Pubblica prima un loop: una TV può mostrare solo loop pubblicati.'],
['Your {plan} plan includes one screen, and it’s in use.','Tu plan {plan} incluye una pantalla y ya está en uso.','Dein Tarif {plan} umfasst einen Bildschirm, und der ist belegt.','Ton forfait {plan} inclut un écran, et il est utilisé.','O seu plano {plan} inclui um ecrã, e já está em uso.','Il tuo piano {plan} include uno schermo, ed è già in uso.'],
['You’re using all {n} screens on {plan}.','Estás usando las {n} pantallas de {plan}.','Du nutzt alle {n} Bildschirme im Tarif {plan}.','Tu utilises les {n} écrans de {plan}.','Está a usar os {n} ecrãs do plano {plan}.','Stai usando tutti i {n} schermi di {plan}.'],
['Unpair one below, or','Desempareja una abajo o','Entkoppel unten einen oder','Dissocies-en un ci-dessous, ou','Desemparelhe um abaixo ou','Scollegane uno qui sotto, oppure'],
['upgrade','mejora tu plan','upgrade deinen Tarif','passe à l’offre supérieure','faça upgrade','passa a un piano superiore'],
['Your screens','Tus pantallas','Deine Bildschirme','Tes écrans','Os seus ecrãs','I tuoi schermi'],
['Rename','Renombrar','Umbenennen','Renommer','Mudar o nome','Rinomina'],
['Unpair','Desemparejar','Entkoppeln','Dissocier','Desemparelhar','Scollega'],
['— loop no longer published —','— bucle ya no publicado —','— Loop nicht mehr veröffentlicht —','— boucle plus publiée —','— loop já não publicado —','— loop non più pubblicato —'],
['Switching the loop here changes the TV within seconds. Unpairing sends the TV back to its code screen.','Si cambias el bucle aquí, la tele cambia en segundos. Al desemparejarla, vuelve a mostrar su código.','Wechselst du hier den Loop, ändert sich der Fernseher in Sekunden. Beim Entkoppeln zeigt er wieder seinen Code.','Changer de boucle ici change la télé en quelques secondes. La dissocier la ramène à son écran de code.','Mudar o loop aqui muda a televisão em segundos. Desemparelhar faz a televisão voltar ao ecrã do código.','Cambiando loop qui la TV cambia in pochi secondi. Scollegandola torna alla schermata del codice.'],
['Getting it onto the TV','Cómo llevarlo a la tele','So kommt es auf den Fernseher','Le mettre sur la télé','Como o pôr na televisão','Come portarlo sulla TV'],
['Any TV with a web browser works. The easiest options:','Sirve cualquier tele con navegador. Las opciones más fáciles:','Jeder Fernseher mit Browser funktioniert. Am einfachsten:','Toute télé avec un navigateur fonctionne. Les options les plus simples :','Serve qualquer televisão com navegador. As opções mais fáceis:','Va bene qualsiasi TV con un browser. Le opzioni più semplici:'],
['Smart TV','Smart TV','Smart-TV','Smart TV','Smart TV','Smart TV'],
['(Samsung, LG, most others) — open the TV\'s','(Samsung, LG y la mayoría) — abre la app','(Samsung, LG, die meisten anderen) – öffne die App','(Samsung, LG, la plupart des autres) — ouvre l’appli','(Samsung, LG, a maioria) — abra a aplicação','(Samsung, LG, la maggior parte) — apri l’app'],
['or','o','oder','ou','ou','o'],
['app','de la tele','des Fernsehers','de la télé','da televisão','della TV'],
['No browser?','¿Sin navegador?','Kein Browser?','Pas de navigateur ?','Sem navegador?','Nessun browser?'],
['Plug in an Amazon Fire TV Stick (about $30) and open its','Conecta un Amazon Fire TV Stick (unos 30 $) y abre su','Steck einen Amazon Fire TV Stick ein (etwa 30 $) und öffne seinen','Branche un Amazon Fire TV Stick (environ 30 $) et ouvre son','Ligue um Amazon Fire TV Stick (cerca de 30 $) e abra o','Collega un Amazon Fire TV Stick (circa 30 $) e apri il'],
['Silk browser','navegador Silk','Silk-Browser','navigateur Silk','navegador Silk','browser Silk'],
['Signage player','Reproductor de cartelería','Signage-Player','Lecteur d’affichage','Leitor de sinalética','Player di signage'],
['(Yodeck, ScreenCloud, OptiSigns, BrightSign…) — add a web page / URL app pointing at the screen link','(Yodeck, ScreenCloud, OptiSigns, BrightSign…) — añade una app de página web / URL que apunte al enlace de pantalla','(Yodeck, ScreenCloud, OptiSigns, BrightSign…) – füg eine Webseiten-/URL-App hinzu, die auf den Bildschirm-Link zeigt','(Yodeck, ScreenCloud, OptiSigns, BrightSign…) — ajoute une appli page web / URL pointant vers le lien d’écran','(Yodeck, ScreenCloud, OptiSigns, BrightSign…) — adicione uma aplicação de página web / URL a apontar para o link do ecrã','(Yodeck, ScreenCloud, OptiSigns, BrightSign…) — aggiungi un’app pagina web / URL che punti al link dello schermo'],
['Then turn off the TV\'s','Después desactiva en la tele el','Schalte dann am Fernseher','Puis désactive sur la télé','Depois desligue na televisão o','Poi disattiva sulla TV'],
['sleep timer','temporizador de apagado','Sleep-Timer','la mise en veille','temporizador de suspensão','lo spegnimento programmato'],
['auto power off','apagado automático','automatische Abschaltung','l’arrêt automatique','desligar automático','lo spegnimento automatico'],
['so it stays on','para que siga encendida','aus, damit er an bleibt','pour qu’elle reste allumée','para ficar ligada','così resta accesa'],
['Step-by-step for each TV →','Paso a paso para cada tele →','Schritt für Schritt für jeden Fernseher →','Pas à pas pour chaque télé →','Passo a passo para cada televisão →','Passo per passo per ogni TV →'],
['Code on the TV','Código de la tele','Code auf dem Fernseher','Code sur la télé','Código na televisão','Codice sulla TV'],
['Loop to play','Bucle a reproducir','Loop zum Abspielen','Boucle à lire','Loop a passar','Loop da mostrare'],
['Name this screen','Ponle nombre a esta pantalla','Diesen Bildschirm benennen','Nommer cet écran','Dar nome a este ecrã','Dai un nome a questo schermo'],
['e.g. K7P4QX','p. ej., K7P4QX','z. B. K7P4QX','ex. K7P4QX','ex.: K7P4QX','es. K7P4QX'],
['e.g. Bar TV','p. ej., Tele del bar','z. B. Bar-TV','ex. Télé du bar','ex.: Televisão do bar','es. TV del bar'],
['That’s the limit on {plan}','Es el límite de {plan}','Das ist das Limit im Tarif {plan}','C’est la limite de {plan}','É o limite do plano {plan}','È il limite di {plan}'],
['See plans','Ver planes','Tarife ansehen','Voir les forfaits','Ver planos','Vedi i piani'],
['OK','OK','OK','OK','OK','OK'],
['Cancel','Cancelar','Abbrechen','Annuler','Cancelar','Annulla'],
['Close','Cerrar','Schließen','Fermer','Fechar','Chiudi'],
['Send “{x}” to PollSlide','Enviar “{x}” a PollSlide','„{x}“ an PollSlide senden','Envoyer « {x} » vers PollSlide','Enviar “{x}” para o PollSlide','Invia “{x}” a PollSlide'],
['this round','esta ronda','diese Runde','cette manche','esta ronda','questo round'],
['A new deck is created in your library. Sponsor cards stay in LoopSlide.','Se crea una presentación nueva en tu biblioteca. Las tarjetas de patrocinio se quedan en LoopSlide.','In deiner Bibliothek wird ein neues Deck angelegt. Sponsorenkarten bleiben in LoopSlide.','Un nouveau deck est créé dans ta bibliothèque. Les cartes sponsor restent dans LoopSlide.','É criado um novo deck na sua biblioteca. Os cartões de patrocínio ficam no LoopSlide.','Nella tua libreria viene creato un nuovo deck. Le schede sponsor restano in LoopSlide.'],
['Create deck →','Crear presentación →','Deck erstellen →','Créer le deck →','Criar deck →','Crea deck →'],
['Before this goes on a public screen','Antes de que esto salga en una pantalla pública','Bevor das auf einen öffentlichen Bildschirm kommt','Avant que ça passe sur un écran public','Antes de isto ir para um ecrã público','Prima che vada su uno schermo pubblico'],
['Fill these in under “Rules & compliance” or on the card:','Rellena esto en “Reglas y cumplimiento” o en la tarjeta:','Füll das unter „Regeln & Compliance“ oder auf der Karte aus:','Remplis ceci dans « Règles et conformité » ou sur la carte :','Preencha isto em “Regras e conformidade” ou no cartão:','Compila questi campi in “Regole e conformità” o nella scheda:'],
['Players on the current board','Jugadores de la clasificación actual','Spieler in der aktuellen Rangliste','Joueurs du classement actuel','Jogadores na classificação atual','Giocatori della classifica attuale'],
['Remove anyone whose nickname shouldn\'t be on a public screen. They disappear from the screen and can\'t keep playing on that phone.','Quita a quien tenga un apodo que no debería salir en una pantalla pública. Desaparece de la pantalla y no puede seguir jugando desde ese móvil.','Entferne alle, deren Spitzname nicht auf einen öffentlichen Bildschirm gehört. Sie verschwinden vom Bildschirm und können auf diesem Handy nicht weiterspielen.','Retire toute personne dont le pseudo ne devrait pas s’afficher sur un écran public. Elle disparaît de l’écran et ne peut plus jouer depuis ce téléphone.','Remova quem tenha uma alcunha que não deve aparecer num ecrã público. Desaparece do ecrã e não pode continuar a jogar nesse telemóvel.','Rimuovi chi ha un nickname che non dovrebbe comparire su uno schermo pubblico. Sparisce dallo schermo e non può più giocare da quel telefono.'],
['Allow again','Volver a permitir','Wieder zulassen','Autoriser à nouveau','Permitir novamente','Consenti di nuovo'],
['Remove','Quitar','Entfernen','Retirer','Remover','Rimuovi'],
['No players on this board yet.','Aún no hay jugadores en esta clasificación.','Noch keine Spieler in dieser Rangliste.','Pas encore de joueurs dans ce classement.','Ainda não há jogadores nesta classificação.','Ancora nessun giocatore in questa classifica.'],
['Import a deck from PollSlide','Importar una presentación de PollSlide','Deck aus PollSlide importieren','Importer un deck depuis PollSlide','Importar um deck do PollSlide','Importa un deck da PollSlide'],
['It becomes a new round in this loop. Your original deck isn\'t changed. Multiple-choice questions and study cards come across; open-text, rating and word-cloud questions are skipped because there\'s nothing to tap on a screen.','Se convierte en una ronda nueva de este bucle. Tu presentación original no cambia. Se importan las preguntas de opción múltiple y las tarjetas de estudio; las de texto libre, valoración y nube de palabras se omiten porque no hay nada que tocar en pantalla.','Es wird eine neue Runde in diesem Loop. Dein Original-Deck bleibt unverändert. Multiple-Choice-Fragen und Lernkarten werden übernommen; Freitext-, Bewertungs- und Wortwolken-Fragen werden übersprungen, weil es auf dem Bildschirm nichts zu tippen gibt.','Il devient une nouvelle manche de cette boucle. Ton deck d’origine n’est pas modifié. Les QCM et les flashcards sont repris ; les questions à texte libre, de notation et de nuage de mots sont ignorées car il n’y a rien à toucher à l’écran.','Passa a ser uma nova ronda deste loop. O deck original não é alterado. As perguntas de escolha múltipla e os cartões de estudo são importados; as de texto livre, avaliação e nuvem de palavras são ignoradas porque não há nada para tocar no ecrã.','Diventa un nuovo round di questo loop. Il deck originale non cambia. Le domande a scelta multipla e le flashcard vengono importate; quelle a testo libero, valutazione e nuvola di parole vengono saltate perché non c’è niente da toccare sullo schermo.'],
['Import →','Importar →','Importieren →','Importer →','Importar →','Importa →'],
['You have no decks yet.','Aún no tienes presentaciones.','Du hast noch keine Decks.','Tu n’as pas encore de decks.','Ainda não tem decks.','Non hai ancora deck.'],
['A contact email players can reach you on.','Un email de contacto en el que los jugadores puedan localizarte.','Eine Kontakt-E-Mail, unter der Spieler dich erreichen.','Un e-mail de contact où les joueurs peuvent te joindre.','Um email de contacto onde os jogadores o possam contactar.','Un’email di contatto a cui i giocatori possano scriverti.'],
['Add at least one question with two or more options first.','Añade primero al menos una pregunta con dos o más opciones.','Füg zuerst mindestens eine Frage mit zwei oder mehr Optionen hinzu.','Ajoute d’abord au moins une question avec deux options ou plus.','Acrescente primeiro pelo menos uma pergunta com duas ou mais opções.','Aggiungi prima almeno una domanda con due o più opzioni.'],
['An official rules link (https) — you’ve offered a prize.','Un enlace a las bases oficiales (https): has ofrecido un premio.','Ein Link zu den Teilnahmebedingungen (https) – du bietest einen Preis an.','Un lien vers le règlement officiel (https) — tu proposes un lot.','Um link para o regulamento oficial (https) — ofereceu um prémio.','Un link al regolamento ufficiale (https): hai offerto un premio.'],
['Clear every score and answer for this loop? This cannot be undone.','¿Borrar todas las puntuaciones y respuestas de este bucle? No se puede deshacer.','Alle Punkte und Antworten dieses Loops löschen? Das lässt sich nicht rückgängig machen.','Effacer tous les scores et réponses de cette boucle ? C’est irréversible.','Apagar todas as pontuações e respostas deste loop? Não é possível anular.','Cancellare tutti i punteggi e le risposte di questo loop? Non si può annullare.'],
['Copied.','Copiado.','Kopiert.','Copié.','Copiado.','Copiato.'],
['Copy this link:','Copia este enlace:','Kopier diesen Link:','Copie ce lien :','Copie este link:','Copia questo link:'],
['Could not delete that loop — try again.','No se pudo eliminar ese bucle: inténtalo de nuevo.','Der Loop konnte nicht gelöscht werden – versuch es noch einmal.','Impossible de supprimer cette boucle — réessaie.','Não foi possível eliminar esse loop — tente de novo.','Impossibile eliminare il loop — riprova.'],
['Could not pair that TV. Ask it for a new code (it refreshes on its own) and try again.','No se pudo emparejar esa tele. Espera a que muestre un código nuevo (se renueva solo) e inténtalo otra vez.','Der Fernseher konnte nicht gekoppelt werden. Warte auf einen neuen Code (er erneuert sich selbst) und versuch es noch einmal.','Impossible d’associer cette télé. Attends un nouveau code (il se renouvelle tout seul) et réessaie.','Não foi possível emparelhar essa televisão. Aguarde um código novo (renova-se sozinho) e tente de novo.','Impossibile associare la TV. Aspetta un nuovo codice (si rinnova da solo) e riprova.'],
['Could not publish. Check your plan’s limits, then try again.','No se pudo publicar. Revisa los límites de tu plan e inténtalo otra vez.','Veröffentlichen fehlgeschlagen. Prüf die Limits deines Tarifs und versuch es noch einmal.','Publication impossible. Vérifie les limites de ton forfait, puis réessaie.','Não foi possível publicar. Verifique os limites do seu plano e tente de novo.','Impossibile pubblicare. Controlla i limiti del tuo piano e riprova.'],
['Could not rename that screen.','No se pudo renombrar esa pantalla.','Der Bildschirm konnte nicht umbenannt werden.','Impossible de renommer cet écran.','Não foi possível mudar o nome desse ecrã.','Impossibile rinominare lo schermo.'],
['Could not switch that screen.','No se pudo cambiar esa pantalla.','Der Bildschirm konnte nicht gewechselt werden.','Impossible de changer cet écran.','Não foi possível mudar esse ecrã.','Impossibile cambiare lo schermo.'],
['Could not unpair that screen.','No se pudo desemparejar esa pantalla.','Der Bildschirm konnte nicht entkoppelt werden.','Impossible de dissocier cet écran.','Não foi possível desemparelhar esse ecrã.','Impossibile scollegare lo schermo.'],
['Created “{x}” in {p} with {n} question(s).','Se creó “{x}” en {p} con {n} pregunta(s).','„{x}“ in {p} mit {n} Frage(n) erstellt.','« {x} » créé dans {p} avec {n} question(s).','“{x}” criado no {p} com {n} pergunta(s).','Creato “{x}” in {p} con {n} domanda/e.'],
['Delete this loop? Its questions, scores and screen links are removed for good.','¿Eliminar este bucle? Sus preguntas, puntuaciones y enlaces de pantalla se borran para siempre.','Diesen Loop löschen? Fragen, Punkte und Bildschirm-Links werden endgültig entfernt.','Supprimer cette boucle ? Ses questions, scores et liens d’écran sont supprimés définitivement.','Eliminar este loop? As perguntas, pontuações e links de ecrã são removidos para sempre.','Eliminare questo loop? Domande, punteggi e link degli schermi vengono rimossi per sempre.'],
['Delete this round and its questions?','¿Eliminar esta ronda y sus preguntas?','Diese Runde und ihre Fragen löschen?','Supprimer cette manche et ses questions ?','Eliminar esta ronda e as suas perguntas?','Eliminare questo round e le sue domande?'],
['Imported {n} question(s), skipped {x} that can’t be tapped on a screen.','Se importaron {n} pregunta(s) y se omitieron {x} que no se pueden tocar en pantalla.','{n} Frage(n) importiert, {x} übersprungen, die sich auf dem Bildschirm nicht antippen lassen.','{n} question(s) importée(s), {x} ignorée(s) car impossibles à toucher à l’écran.','{n} pergunta(s) importada(s), {x} ignorada(s) por não se poderem tocar no ecrã.','Importate {n} domanda/e, saltate {x} che non si possono toccare sullo schermo.'],
['Imported {n} question(s).','Se importaron {n} pregunta(s).','{n} Frage(n) importiert.','{n} question(s) importée(s).','{n} pergunta(s) importada(s).','Importate {n} domanda/e.'],
['Imported {n} round(s).','Se importaron {n} ronda(s).','{n} Runde(n) importiert.','{n} manche(s) importée(s).','{n} ronda(s) importada(s).','Importati {n} round.'],
['Leaderboard cleared.','Clasificación vaciada.','Rangliste geleert.','Classement vidé.','Classificação limpa.','Classifica svuotata.'],
['Loop deleted.','Bucle eliminado.','Loop gelöscht.','Boucle supprimée.','Loop eliminado.','Loop eliminato.'],
['New loop','Nuevo bucle','Neuer Loop','Nouvelle boucle','Novo loop','Nuovo loop'],
['Untitled loop','Bucle sin título','Loop ohne Titel','Boucle sans titre','Loop sem título','Loop senza titolo'],
['untitled','sin título','ohne Titel','sans titre','sem título','senza titolo'],
['Round {n}','Ronda {n}','Runde {n}','Manche {n}','Ronda {n}','Round {n}'],
['No TV is showing that code right now. Check the code on the TV — it changes every 10 minutes.','Ninguna tele muestra ese código ahora mismo. Revisa el código de la tele: cambia cada 10 minutos.','Kein Fernseher zeigt gerade diesen Code. Prüf den Code auf dem Fernseher – er ändert sich alle 10 Minuten.','Aucune télé n’affiche ce code en ce moment. Vérifie le code sur la télé — il change toutes les 10 minutes.','Nenhuma televisão está a mostrar esse código agora. Verifique o código na televisão — muda a cada 10 minutos.','Nessuna TV mostra questo codice in questo momento. Controlla il codice sulla TV: cambia ogni 10 minuti.'],
['Nothing to import — that deck has no multiple-choice questions or study cards.','Nada que importar: esa presentación no tiene preguntas de opción múltiple ni tarjetas de estudio.','Nichts zu importieren – dieses Deck hat keine Multiple-Choice-Fragen oder Lernkarten.','Rien à importer — ce deck n’a ni QCM ni flashcards.','Nada para importar — esse deck não tem perguntas de escolha múltipla nem cartões de estudo.','Niente da importare: il deck non ha domande a scelta multipla né flashcard.'],
['Nothing to send — this round has no finished questions with a right answer.','Nada que enviar: esta ronda no tiene preguntas terminadas con respuesta correcta.','Nichts zu senden – diese Runde hat keine fertigen Fragen mit richtiger Antwort.','Rien à envoyer — cette manche n’a pas de question terminée avec une bonne réponse.','Nada para enviar — esta ronda não tem perguntas terminadas com resposta certa.','Niente da inviare: questo round non ha domande complete con una risposta giusta.'],
['Nothing to send — this round has no finished questions.','Nada que enviar: esta ronda no tiene preguntas terminadas.','Nichts zu senden – diese Runde hat keine fertigen Fragen.','Rien à envoyer — cette manche n’a pas de question terminée.','Nada para enviar — esta ronda não tem perguntas terminadas.','Niente da inviare: questo round non ha domande complete.'],
['Organiser — the business running this loop.','Organizador: el negocio que lleva este bucle.','Veranstalter – das Unternehmen, das diesen Loop betreibt.','Organisateur — l’entreprise qui gère cette boucle.','Organizador — a empresa que gere este loop.','Organizzatore — l’attività che gestisce questo loop.'],
['Paired — the TV is starting now.','Emparejada: la tele está empezando.','Gekoppelt – der Fernseher legt jetzt los.','Associée — la télé démarre.','Emparelhada — a televisão está a começar.','Associata — la TV sta partendo.'],
['Pick a loop to play.','Elige un bucle para reproducir.','Wähl einen Loop zum Abspielen.','Choisis une boucle à lire.','Escolha um loop para passar.','Scegli un loop da mostrare.'],
['Published — screens update within seconds.','Publicado: las pantallas se actualizan en segundos.','Veröffentlicht – die Bildschirme aktualisieren sich in Sekunden.','Publié — les écrans se mettent à jour en quelques secondes.','Publicado — os ecrãs atualizam em segundos.','Pubblicato — gli schermi si aggiornano in pochi secondi.'],
['Published. {n} unfinished question(s) were left out — each needs text and two options.','Publicado. Se dejaron fuera {n} pregunta(s) sin terminar: cada una necesita texto y dos opciones.','Veröffentlicht. {n} unfertige Frage(n) wurden weggelassen – jede braucht Text und zwei Optionen.','Publié. {n} question(s) inachevée(s) ont été ignorées — chacune a besoin d’un texte et de deux options.','Publicado. {n} pergunta(s) por terminar ficaram de fora — cada uma precisa de texto e duas opções.','Pubblicato. {n} domanda/e incomplete sono state escluse — ognuna richiede un testo e due opzioni.'],
['Removed from the screen.','Quitado de la pantalla.','Vom Bildschirm entfernt.','Retiré de l’écran.','Removido do ecrã.','Rimosso dallo schermo.'],
['Restarted from the first question.','Reiniciado desde la primera pregunta.','Ab der ersten Frage neu gestartet.','Redémarré à la première question.','Recomeçado a partir da primeira pergunta.','Ricominciato dalla prima domanda.'],
['Saved.','Guardado.','Gespeichert.','Enregistré.','Guardado.','Salvato.'],
['Switched — the TV changes within seconds.','Cambiado: la tele cambia en segundos.','Gewechselt – der Fernseher ändert sich in Sekunden.','Changé — la télé change en quelques secondes.','Mudado — a televisão muda em segundos.','Cambiato — la TV cambia in pochi secondi.'],
['That file isn’t a LoopSlide export or a PollSlide deck.','Ese archivo no es una exportación de LoopSlide ni una presentación de PollSlide.','Diese Datei ist weder ein LoopSlide-Export noch ein PollSlide-Deck.','Ce fichier n’est ni un export LoopSlide ni un deck PollSlide.','Esse ficheiro não é uma exportação do LoopSlide nem um deck do PollSlide.','Il file non è un’esportazione LoopSlide né un deck PollSlide.'],
['The code on the TV has 6 letters and numbers.','El código de la tele tiene 6 letras y números.','Der Code auf dem Fernseher hat 6 Buchstaben und Zahlen.','Le code sur la télé contient 6 lettres et chiffres.','O código na televisão tem 6 letras e números.','Il codice sulla TV ha 6 lettere e numeri.'],
['This loop has {n} slides; {plan} includes {lim} per loop. Remove {x}, or upgrade.','Este bucle tiene {n} diapositivas; {plan} incluye {lim} por bucle. Quita {x} o mejora tu plan.','Dieser Loop hat {n} Folien; {plan} umfasst {lim} pro Loop. Entferne {x} oder upgrade deinen Tarif.','Cette boucle a {n} diapos ; {plan} en inclut {lim} par boucle. Retires-en {x}, ou passe à l’offre supérieure.','Este loop tem {n} diapositivos; o plano {plan} inclui {lim} por loop. Remova {x} ou faça upgrade.','Questo loop ha {n} slide; {plan} ne include {lim} per loop. Rimuovine {x} o passa a un piano superiore.'],
['Translations for players are ready.','Las traducciones para los jugadores están listas.','Die Übersetzungen für die Spieler sind fertig.','Les traductions pour les joueurs sont prêtes.','As traduções para os jogadores estão prontas.','Le traduzioni per i giocatori sono pronte.'],
['Unpair this screen? It goes back to showing a pairing code.','¿Desemparejar esta pantalla? Volverá a mostrar un código de emparejamiento.','Diesen Bildschirm entkoppeln? Er zeigt dann wieder einen Kopplungscode.','Dissocier cet écran ? Il affichera à nouveau un code d’association.','Desemparelhar este ecrã? Volta a mostrar um código de emparelhamento.','Scollegare questo schermo? Tornerà a mostrare un codice di associazione.'],
['Unpaired.','Desemparejada.','Entkoppelt.','Dissocié.','Desemparelhado.','Scollegato.'],
['Who the ad “{x}” is from (sponsor name).','De quién es el anuncio “{x}” (nombre del patrocinador).','Von wem die Werbung „{x}“ ist (Name des Sponsors).','De qui vient la pub « {x} » (nom du sponsor).','De quem é o anúncio “{x}” (nome do patrocinador).','Di chi è la pubblicità “{x}” (nome dello sponsor).'],
['{n} pts','{n} pts','{n} Pkt.','{n} pts','{n} pts','{n} pt'],
['{plan} includes {n} loop(s). Delete one you no longer use, or upgrade for more.','{plan} incluye {n} bucle(s). Elimina uno que ya no uses o mejora tu plan para tener más.','{plan} umfasst {n} Loop(s). Lösch einen, den du nicht mehr nutzt, oder upgrade für mehr.','{plan} inclut {n} boucle(s). Supprimes-en une que tu n’utilises plus, ou passe à l’offre supérieure.','O plano {plan} inclui {n} loop(s). Elimine um que já não use ou faça upgrade para ter mais.','{plan} include {n} loop. Eliminane uno che non usi più o passa a un piano superiore.'],
['{plan} includes {n} published loop(s). Delete one you no longer use, or upgrade for more.','{plan} incluye {n} bucle(s) publicado(s). Elimina uno que ya no uses o mejora tu plan para tener más.','{plan} umfasst {n} veröffentlichte(n) Loop(s). Lösch einen, den du nicht mehr nutzt, oder upgrade für mehr.','{plan} inclut {n} boucle(s) publiée(s). Supprimes-en une que tu n’utilises plus, ou passe à l’offre supérieure.','O plano {plan} inclui {n} loop(s) publicado(s). Elimine um que já não use ou faça upgrade para ter mais.','{plan} include {n} loop pubblicati. Eliminane uno che non usi più o passa a un piano superiore.'],
['{plan} includes {n} screen(s).','{plan} incluye {n} pantalla(s).','{plan} umfasst {n} Bildschirm(e).','{plan} inclut {n} écran(s).','O plano {plan} inclui {n} ecrã(s).','{plan} include {n} schermo/i.'],
['{plan} includes {n} slides (questions and cards) per loop.','{plan} incluye {n} diapositivas (preguntas y tarjetas) por bucle.','{plan} umfasst {n} Folien (Fragen und Karten) pro Loop.','{plan} inclut {n} diapos (questions et cartes) par boucle.','O plano {plan} inclui {n} diapositivos (perguntas e cartões) por loop.','{plan} include {n} slide (domande e schede) per loop.'],
]);

/* ── Studio: Polly, GIFs, uploads ────────────────────────────────────────── */
LoopI18n.add([
['✨ Draft with Polly','✨ Redactar con Polly','✨ Mit Polly entwerfen','✨ Rédiger avec Polly','✨ Criar com o Polly','✨ Crea con Polly'],
['✨ Draft a round with Polly','✨ Redacta una ronda con Polly','✨ Eine Runde mit Polly entwerfen','✨ Rédige une manche avec Polly','✨ Crie uma ronda com o Polly','✨ Crea un round con Polly'],
['Describe a topic and Polly writes the questions with emojis. You can edit everything before you publish. Questions from Polly are labelled “AI-generated” on screen.','Describe un tema y Polly escribe las preguntas con emojis. Puedes editarlo todo antes de publicar. Las preguntas de Polly se marcan como “Generado con IA” en pantalla.','Beschreib ein Thema, und Polly schreibt die Fragen mit Emojis. Du kannst vor dem Veröffentlichen alles bearbeiten. Fragen von Polly sind auf dem Bildschirm als „KI-generiert“ gekennzeichnet.','Décris un sujet et Polly écrit les questions avec des emojis. Tu peux tout modifier avant de publier. Les questions de Polly sont signalées « Généré par IA » à l’écran.','Descreva um tema e o Polly escreve as perguntas com emojis. Pode editar tudo antes de publicar. As perguntas do Polly aparecem identificadas como “Gerado por IA” no ecrã.','Descrivi un argomento e Polly scrive le domande con le emoji. Puoi modificare tutto prima di pubblicare. Le domande di Polly sono etichettate “Generato con IA” sullo schermo.'],
['Topic','Tema','Thema','Sujet','Tema','Argomento'],
['e.g. 90s movies, football legends, local history','p. ej., cine de los 90, leyendas del fútbol, historia local','z. B. Filme der 90er, Fußballlegenden, Lokalgeschichte','ex. films des années 90, légendes du foot, histoire locale','ex.: filmes dos anos 90, lendas do futebol, história local','es. film anni ’90, leggende del calcio, storia locale'],
['Kind of questions','Tipo de preguntas','Art der Fragen','Type de questions','Tipo de perguntas','Tipo di domande'],
['Trivia — with a right answer','Trivia: con respuesta correcta','Quiz – mit richtiger Antwort','Quiz — avec une bonne réponse','Trivia — com resposta certa','Quiz — con una risposta giusta'],
['Opinion poll — no right answer','Encuesta de opinión: sin respuesta correcta','Meinungsumfrage – ohne richtige Antwort','Sondage d’opinion — sans bonne réponse','Sondagem de opinião — sem resposta certa','Sondaggio d’opinione — nessuna risposta giusta'],
['How many','Cuántas','Wie viele','Combien','Quantas','Quante'],
['✨ Draft questions','✨ Redactar preguntas','✨ Fragen entwerfen','✨ Rédiger les questions','✨ Criar perguntas','✨ Crea domande'],
['Type a topic first.','Escribe primero un tema.','Gib zuerst ein Thema ein.','Saisis d’abord un sujet.','Escreva primeiro um tema.','Scrivi prima un argomento.'],
['Polly is writing…','Polly está escribiendo…','Polly schreibt…','Polly écrit…','O Polly está a escrever…','Polly sta scrivendo…'],
['You’ve used this month’s Polly allowance.','Has usado todo el cupo de Polly de este mes.','Du hast dein Polly-Kontingent für diesen Monat aufgebraucht.','Tu as utilisé ton quota Polly de ce mois-ci.','Já usou a quota do Polly deste mês.','Hai esaurito la quota di Polly di questo mese.'],
['Polly drafted {n} question(s). Check them before you publish.','Polly ha redactado {n} pregunta(s). Revísalas antes de publicar.','Polly hat {n} Frage(n) entworfen. Prüf sie vor dem Veröffentlichen.','Polly a rédigé {n} question(s). Vérifie-les avant de publier.','O Polly criou {n} pergunta(s). Reveja-as antes de publicar.','Polly ha creato {n} domanda/e. Controllale prima di pubblicare.'],
['Polly couldn’t write those just now. Try again, or rephrase the topic.','Polly no ha podido escribirlas ahora. Inténtalo de nuevo o reformula el tema.','Polly konnte die Fragen gerade nicht schreiben. Versuch es noch einmal oder formulier das Thema um.','Polly n’a pas pu les écrire pour l’instant. Réessaie, ou reformule le sujet.','O Polly não conseguiu escrevê-las agora. Tente de novo ou reformule o tema.','Polly non è riuscito a scriverle adesso. Riprova o riformula l’argomento.'],
['🖼 Add media','🖼 Añadir multimedia','🖼 Medien hinzufügen','🖼 Ajouter un média','🖼 Adicionar multimédia','🖼 Aggiungi media'],
['Add media','Añadir multimedia','Medien hinzufügen','Ajouter un média','Adicionar multimédia','Aggiungi media'],
['⬆ Upload a photo or video','⬆ Subir una foto o un vídeo','⬆ Foto oder Video hochladen','⬆ Importer une photo ou une vidéo','⬆ Carregar uma foto ou um vídeo','⬆ Carica una foto o un video'],
['Images up to 8 MB, videos up to 20 MB (played muted on the TV).','Imágenes de hasta 8 MB y vídeos de hasta 20 MB (se reproducen sin sonido en la tele).','Bilder bis 8 MB, Videos bis 20 MB (laufen stumm auf dem Fernseher).','Images jusqu’à 8 Mo, vidéos jusqu’à 20 Mo (lues sans le son sur la télé).','Imagens até 8 MB e vídeos até 20 MB (passam sem som na televisão).','Immagini fino a 8 MB, video fino a 20 MB (riprodotti senza audio sulla TV).'],
['Search GIFs','Buscar GIF','GIFs suchen','Rechercher des GIF','Pesquisar GIF','Cerca GIF'],
['Search','Buscar','Suchen','Rechercher','Pesquisar','Cerca'],
['✨ Generate an image with Polly','✨ Genera una imagen con Polly','✨ Ein Bild mit Polly erstellen','✨ Génère une image avec Polly','✨ Gere uma imagem com o Polly','✨ Genera un’immagine con Polly'],
['Describe the picture','Describe la imagen','Beschreib das Bild','Décris l’image','Descreva a imagem','Descrivi l’immagine'],
['🎨 Illustration','🎨 Ilustración','🎨 Illustration','🎨 Illustration','🎨 Ilustração','🎨 Illustrazione'],
['📷 Realistic photo','📷 Foto realista','📷 Realistisches Foto','📷 Photo réaliste','📷 Foto realista','📷 Foto realistica'],
['😄 Cartoon','😄 Dibujo animado','😄 Cartoon','😄 Dessin animé','😄 Desenho animado','😄 Cartone'],
['🧊 3D render','🧊 Render 3D','🧊 3D-Rendering','🧊 Rendu 3D','🧊 Render 3D','🧊 Render 3D'],
['Generate','Generar','Erstellen','Générer','Gerar','Genera'],
['Generated images are labelled “AI-generated” on screen.','Las imágenes generadas se marcan como “Generado con IA” en pantalla.','Erstellte Bilder sind auf dem Bildschirm als „KI-generiert“ gekennzeichnet.','Les images générées sont signalées « Généré par IA » à l’écran.','As imagens geradas aparecem identificadas como “Gerado por IA” no ecrã.','Le immagini generate sono etichettate “Generato con IA” sullo schermo.'],
['Searching…','Buscando…','Wird gesucht…','Recherche…','A pesquisar…','Ricerca…'],
['No GIFs found — try other words.','No se encontraron GIF: prueba con otras palabras.','Keine GIFs gefunden – probier andere Wörter.','Aucun GIF trouvé — essaie d’autres mots.','Nenhum GIF encontrado — experimente outras palavras.','Nessuna GIF trovata — prova altre parole.'],
['GIF search isn’t available right now.','La búsqueda de GIF no está disponible ahora.','Die GIF-Suche ist gerade nicht verfügbar.','La recherche de GIF n’est pas disponible pour le moment.','A pesquisa de GIF não está disponível neste momento.','La ricerca di GIF non è disponibile al momento.'],
['Generating…','Generando…','Wird erstellt…','Génération…','A gerar…','Generazione…'],
['Image added ✨','Imagen añadida ✨','Bild hinzugefügt ✨','Image ajoutée ✨','Imagem adicionada ✨','Immagine aggiunta ✨'],
['Couldn’t generate that image — try again.','No se pudo generar esa imagen: inténtalo de nuevo.','Das Bild konnte nicht erstellt werden – versuch es noch einmal.','Impossible de générer cette image — réessaie.','Não foi possível gerar essa imagem — tente de novo.','Impossibile generare l’immagine — riprova.'],
['That file is too big — {n} MB maximum.','Ese archivo es demasiado grande: máximo {n} MB.','Die Datei ist zu groß – maximal {n} MB.','Ce fichier est trop lourd — {n} Mo maximum.','Esse ficheiro é demasiado grande — máximo {n} MB.','Il file è troppo grande — massimo {n} MB.'],
['Videos can be up to 30 seconds long.','Los vídeos pueden durar hasta 30 segundos.','Videos dürfen bis zu 30 Sekunden lang sein.','Les vidéos peuvent durer jusqu’à 30 secondes.','Os vídeos podem ter até 30 segundos.','I video possono durare fino a 30 secondi.'],
['Uploading…','Subiendo…','Wird hochgeladen…','Envoi en cours…','A carregar…','Caricamento…'],
['Uploaded.','Subido.','Hochgeladen.','Envoyé.','Carregado.','Caricato.'],
['Upload failed — try again.','Error al subir: inténtalo de nuevo.','Hochladen fehlgeschlagen – versuch es noch einmal.','Échec de l’envoi — réessaie.','Falha no carregamento — tente de novo.','Caricamento non riuscito — riprova.'],
]);
