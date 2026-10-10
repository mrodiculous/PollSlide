/* Stage-only demo content in each video language (2026-10-10), so a German video shows a
 * German deck, German answers, German AI Insights and German co-pilot suggestions — not an
 * English demo inside a German app. Used by server.js (Polly / Insights / co-pilot stand-ins)
 * and by the team video scripts. Nothing here reaches production. All facts are fictional. */
const ONBOARD = {
  en: [['How many days do you have to submit an expense claim?', ['7 days', '14 days', '30 days', '60 days'], 2],
       ['Your laptop is lost or stolen. Who do you contact first?', ['Your manager', 'The IT help desk', 'HR', 'Facilities'], 1],
       ['When is the weekly team planning meeting?', ['Monday 10:00', 'Tuesday 14:00', 'Thursday 9:30', 'Friday 16:00'], 0],
       ['What do you need before sharing a customer file outside the company?', ['Nothing', "A colleague's OK", 'Written approval from your manager', 'A new file name'], 2],
       ['How many days of paid leave do new starters get in their first year?', ['20', '25', '28', '30'], 1]],
  es: [['¿Cuántos días tienes para presentar una nota de gastos?', ['7 días', '14 días', '30 días', '60 días'], 2],
       ['Pierdes el portátil o te lo roban. ¿A quién avisas primero?', ['A tu responsable', 'Al soporte informático', 'A RR. HH.', 'A Servicios Generales'], 1],
       ['¿Cuándo es la reunión semanal de planificación?', ['Lunes 10:00', 'Martes 14:00', 'Jueves 9:30', 'Viernes 16:00'], 0],
       ['¿Qué necesitas antes de compartir un archivo de un cliente fuera de la empresa?', ['Nada', 'El visto bueno de un compañero', 'Aprobación por escrito de tu responsable', 'Cambiarle el nombre'], 2],
       ['¿Cuántos días de vacaciones pagadas tiene una persona nueva el primer año?', ['20', '25', '28', '30'], 1]],
  de: [['Wie viele Tage hast du Zeit, eine Spesenabrechnung einzureichen?', ['7 Tage', '14 Tage', '30 Tage', '60 Tage'], 2],
       ['Dein Laptop ist verloren oder gestohlen. Wen kontaktierst du zuerst?', ['Deine Führungskraft', 'Den IT-Helpdesk', 'HR', 'Das Facility-Management'], 1],
       ['Wann ist das wöchentliche Planungsmeeting?', ['Montag 10:00', 'Dienstag 14:00', 'Donnerstag 9:30', 'Freitag 16:00'], 0],
       ['Was brauchst du, bevor du eine Kundendatei nach außen weitergibst?', ['Nichts', 'Das OK einer Kollegin', 'Eine schriftliche Freigabe deiner Führungskraft', 'Einen neuen Dateinamen'], 2],
       ['Wie viele Tage bezahlten Urlaub haben Neue im ersten Jahr?', ['20', '25', '28', '30'], 1]],
  fr: [['Combien de jours as-tu pour déclarer une note de frais ?', ['7 jours', '14 jours', '30 jours', '60 jours'], 2],
       ['Ton ordinateur est perdu ou volé. Qui préviens-tu en premier ?', ['Ton manager', 'Le support informatique', 'Les RH', 'Les services généraux'], 1],
       ['Quand a lieu la réunion de planification hebdomadaire ?', ['Lundi 10 h', 'Mardi 14 h', 'Jeudi 9 h 30', 'Vendredi 16 h'], 0],
       ['De quoi as-tu besoin avant de partager un fichier client hors de l’entreprise ?', ['De rien', 'De l’accord d’un collègue', 'D’une validation écrite de ton manager', 'D’un nouveau nom de fichier'], 2],
       ['Combien de jours de congés payés ont les nouveaux la première année ?', ['20', '25', '28', '30'], 1]],
  pt: [['Quantos dias tem para submeter uma despesa?', ['7 dias', '14 dias', '30 dias', '60 dias'], 2],
       ['O seu portátil foi perdido ou roubado. Quem contacta primeiro?', ['O seu responsável', 'O apoio informático', 'Os RH', 'Os serviços gerais'], 1],
       ['Quando é a reunião semanal de planeamento?', ['Segunda 10:00', 'Terça 14:00', 'Quinta 9:30', 'Sexta 16:00'], 0],
       ['O que precisa antes de partilhar um ficheiro de cliente fora da empresa?', ['Nada', 'O OK de um colega', 'Aprovação escrita do seu responsável', 'Um novo nome de ficheiro'], 2],
       ['Quantos dias de férias pagas têm os novos colaboradores no primeiro ano?', ['20', '25', '28', '30'], 1]],
  it: [['Quanti giorni hai per presentare una nota spese?', ['7 giorni', '14 giorni', '30 giorni', '60 giorni'], 2],
       ['Hai perso il portatile o te l’hanno rubato. Chi contatti per primo?', ['Il tuo responsabile', 'L’help desk IT', 'Le risorse umane', 'I servizi generali'], 1],
       ['Quando c’è la riunione settimanale di pianificazione?', ['Lunedì 10:00', 'Martedì 14:00', 'Giovedì 9:30', 'Venerdì 16:00'], 0],
       ['Cosa ti serve prima di condividere un file di un cliente fuori dall’azienda?', ['Niente', 'L’ok di un collega', 'L’approvazione scritta del tuo responsabile', 'Un nuovo nome del file'], 2],
       ['Quanti giorni di ferie pagate hanno i nuovi assunti nel primo anno?', ['20', '25', '28', '30'], 1]],
};
const INSIGHTS = {
  en: { good: 'A productive week', hard: 'Stretched thin', mixed: 'Mixed',
        sGood: 'Most of the team had a productive week, though a few are feeling stretched.',
        sHard: 'Most of the team had a busy week, and a few are feeling stretched. Worth asking what would help.' },
  es: { good: 'Una semana productiva', hard: 'Al límite', mixed: 'Variado',
        sGood: 'La mayoría del equipo tuvo una semana productiva, aunque algunos van al límite.',
        sHard: 'La mayoría del equipo tuvo una semana muy cargada y algunos van al límite. Vale la pena preguntar qué ayudaría.' },
  de: { good: 'Eine produktive Woche', hard: 'Am Limit', mixed: 'Gemischt',
        sGood: 'Die meisten im Team hatten eine produktive Woche, ein paar sind aber am Limit.',
        sHard: 'Die meisten im Team hatten eine volle Woche, ein paar sind am Limit. Frag nach, was helfen würde.' },
  fr: { good: 'Une semaine productive', hard: 'Sous pression', mixed: 'Mitigé',
        sGood: 'La plupart de l’équipe a eu une semaine productive, même si quelques-uns sont sous pression.',
        sHard: 'La plupart de l’équipe a eu une semaine chargée, et quelques-uns sont sous pression. Demande ce qui aiderait.' },
  pt: { good: 'Uma semana produtiva', hard: 'No limite', mixed: 'Misto',
        sGood: 'A maioria da equipa teve uma semana produtiva, embora alguns estejam no limite.',
        sHard: 'A maioria da equipa teve uma semana cheia, e alguns estão no limite. Vale a pena perguntar o que ajudaria.' },
  it: { good: 'Una settimana produttiva', hard: 'Sotto pressione', mixed: 'Misto',
        sGood: 'Quasi tutto il team ha avuto una settimana produttiva, anche se qualcuno è sotto pressione.',
        sHard: 'Quasi tutto il team ha avuto una settimana piena, e qualcuno è sotto pressione. Chiedi cosa aiuterebbe.' },
};
// Words the stand-in Insights sorts into "good" and "hard" weeks, in every video language.
const GOOD = /product|produkt|produtiv|produttiv|great|good|genial|super|ótima|ottima|focus|fokus|concentr|centrad|focad|calm|happy|smooth/i;
const HARD = /busy|hectic|tired|stretch|stress|liad|caót|agobi|cansad|hektisch|müde|ausgelastet|charg|agité|débord|fatigu|ocupad|agitad|sobrecarreg|piena|frenetic|pression|stanc/i;
const COPILOT = {
  en: [['What would help most to get the release out on time?', ['More time for testing', 'Fewer meetings this sprint', 'Clearer priorities', 'Help from another team'], 'The room split almost evenly between the two projects. Ask what is really holding people back.'],
       ['How confident are you that we hit the release date?', ['Very confident', 'Fairly confident', 'Not sure', 'Worried'], 'A quick confidence check tells you whether the split is about priorities or about risk.']],
  es: [['¿Qué ayudaría más a sacar el lanzamiento a tiempo?', ['Más tiempo para pruebas', 'Menos reuniones este sprint', 'Prioridades más claras', 'Ayuda de otro equipo'], 'La sala se dividió casi a partes iguales entre los dos proyectos. Pregunta qué está frenando de verdad al equipo.'],
       ['¿Qué confianza tienes en llegar a la fecha de lanzamiento?', ['Mucha', 'Bastante', 'No estoy seguro', 'Me preocupa'], 'Una comprobación rápida de confianza te dice si la división es por prioridades o por riesgo.']],
  de: [['Was würde am meisten helfen, das Release pünktlich rauszubringen?', ['Mehr Zeit zum Testen', 'Weniger Meetings in diesem Sprint', 'Klarere Prioritäten', 'Hilfe von einem anderen Team'], 'Der Raum ist fast genau zwischen den beiden Projekten gespalten. Frag, was das Team wirklich bremst.'],
       ['Wie sicher bist du, dass wir den Release-Termin halten?', ['Sehr sicher', 'Ziemlich sicher', 'Unsicher', 'Besorgt'], 'Ein kurzer Stimmungscheck zeigt, ob es um Prioritäten oder um Risiko geht.']],
  fr: [['Qu’est-ce qui aiderait le plus à sortir la version à temps ?', ['Plus de temps pour tester', 'Moins de réunions ce sprint', 'Des priorités plus claires', 'L’aide d’une autre équipe'], 'La salle s’est partagée presque à égalité entre les deux projets. Demande ce qui bloque vraiment.'],
       ['À quel point es-tu confiant pour la date de sortie ?', ['Très confiant', 'Plutôt confiant', 'Pas sûr', 'Inquiet'], 'Un rapide point de confiance te dit si le partage vient des priorités ou du risque.']],
  pt: [['O que mais ajudaria a lançar a versão a tempo?', ['Mais tempo para testes', 'Menos reuniões neste sprint', 'Prioridades mais claras', 'Ajuda de outra equipa'], 'A sala dividiu-se quase ao meio entre os dois projetos. Pergunte o que está realmente a travar a equipa.'],
       ['Que confiança tem em cumprir a data de lançamento?', ['Muita', 'Alguma', 'Não sei', 'Estou preocupado'], 'Uma verificação rápida de confiança mostra se a divisão é sobre prioridades ou sobre risco.']],
  it: [['Cosa aiuterebbe di più a fare il rilascio in tempo?', ['Più tempo per i test', 'Meno riunioni in questo sprint', 'Priorità più chiare', 'Aiuto da un altro team'], 'La sala si è divisa quasi a metà tra i due progetti. Chiedi cosa frena davvero il team.'],
       ['Quanto sei sicuro di rispettare la data di rilascio?', ['Molto sicuro', 'Abbastanza sicuro', 'Non so', 'Preoccupato'], 'Un rapido controllo di fiducia ti dice se la divisione riguarda le priorità o il rischio.']],
};
const L = (lang, table) => table[lang] ? lang : 'en';
module.exports = { ONBOARD, INSIGHTS, COPILOT, GOOD, HARD, L };
