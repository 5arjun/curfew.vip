/**
 * DJ Platform — WTP & Free/Paid Boundary Survey
 * Google Apps Script that builds the entire Google Form automatically.
 *
 * HOW TO USE (2 minutes):
 *  1. Go to https://script.google.com  →  "New project"
 *  2. Delete the default code, paste ALL of this file.
 *  3. Click "Run" (▶). First run asks for authorization — approve it
 *     (it only creates a Form in your Drive; safe to allow).
 *  4. Open "Execution log" (Ctrl+Enter) — it prints the live EDIT and
 *     SHARE (respondent) URLs. Open the edit URL to tweak; send the
 *     share URL to your DJs.
 *
 * The form is created in your Google Drive root, titled below.
 */

function createDJSurvey() {
  var form = FormApp.create('DJ Set Reflection App — Quick DJ Survey');

  form.setDescription(
    "You DJ — we're building a tool for you and want your honest take (no wrong answers). " +
    "It reads your Serato history after a gig and turns it into stats + a private feed of your scene. " +
    "~7 minutes. Anonymous unless you leave an email for the launch waitlist at the end. Thanks 🙏"
  );

  form.setProgressBar(true);
  form.setCollectEmail(false);       // keep anonymous; email is an optional question
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);

  // ---------- SECTION A — WHO YOU ARE ----------
  form.addSectionHeaderItem()
    .setTitle('About your DJing')
    .setHelpText('Helps us understand who you are. No wrong answers.');

  form.addMultipleChoiceItem()
    .setTitle('How would you describe your DJing?')
    .setChoiceValues([
      'Hobby / bedroom — mostly practice or mix at home, rarely/never gig',
      'Part-time / occasional — I play out a few times a year',
      'Regular gigging — I play out at least monthly',
      'Full-time / professional — DJing is a primary income source'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('In a typical month, how many sets do you play OUT (venues/events, not home)?')
    .setChoiceValues(['0', '1–2', '3–5', '6–10', '10+'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('What DJ software do you use most?')
    .setChoiceValues(['Serato', 'rekordbox', 'Traktor', 'VirtualDJ', 'Engine DJ'])
    .showOtherOption(true)
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('How do you mostly get your music? (select all that apply)')
    .setChoiceValues([
      'Buy from Beatport / Bandcamp / record pools / iTunes',
      'Streaming inside DJ software (Beatport LINK, TIDAL, etc.)',
      'Free / ripped / shared',
      'Promos / my own productions / edits'
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("Do you have DJ friends in your scene whose sets you'd want to see?")
    .setChoiceValues(['Yes, an active group', 'A few', 'Not really'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Do you produce your own edits / mashups / tracks?')
    .setChoiceValues(['Yes, regularly', 'Occasionally', 'No'])
    .setRequired(true);

  // ---------- SECTION B — THE PROBLEM ----------
  form.addSectionHeaderItem()
    .setTitle('Looking back at your sets');

  var q7 = form.addMultipleChoiceItem();
  q7.setTitle('After a gig, do you ever look back at what you played?')
    .setChoiceValues(['Yes, I review most sets', 'Sometimes', 'Rarely', 'Never'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('If yes — what do you look at, and using what tool today?')
    .setRequired(false);

  form.addScaleItem()
    .setTitle("How much do you agree: \"I'd like to understand my own DJing better — how I actually play, how it's changing over time.\"")
    .setBounds(1, 5)
    .setLabels('Strongly disagree', 'Strongly agree')
    .setRequired(true);

  // ---------- SECTION C — THE BOUNDARY ----------
  form.addSectionHeaderItem()
    .setTitle('Which features would you pay for?')
    .setHelpText('Imagine the app reads your Serato history after each gig and turns it into stats + a private feed of your scene. For each feature below, pick one.');

  var features = [
    "See your scene's feed (what friends played, as energy-arc thumbnails)",
    'Follow other DJs / profiles',
    'Hide individual tracks in your shared setlist',
    'Basic stats for a single set (BPM range, genres, key mix)',
    '"Compared to what?" — every stat vs. your own baseline',
    'Library utilization — "am I playing what I bought?" (aging shelf, time-to-first-play)',
    'Style evolution over time (how your sound is changing)',
    'Taste leaderboards vs. your scene',
    'Full searchable history of every set'
  ];

  form.addGridItem()
    .setTitle('For EACH feature: would you expect it free, pay to unlock it, or not use it?')
    .setRows(features)
    .setColumns(['Expect free', 'Would pay', "Wouldn't use"])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Of everything above, which ONE feature would most make you want the app?')
    .setChoiceValues(features)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Which ONE feature would you be most annoyed to find behind a paywall?')
    .setChoiceValues(features)
    .setRequired(true);

  // ---------- SECTION D — PRICE ----------
  form.addSectionHeaderItem()
    .setTitle('Pricing')
    .setHelpText('Assume the app works great and reads your Serato history automatically. Answer in whole dollars per month.');

  var q12 = form.addMultipleChoiceItem();
  q12.setTitle('Would you pay a monthly subscription for the premium features you marked above?')
    .setChoiceValues(['Yes', 'Maybe', 'No'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('If Maybe/No — what would change your mind?')
    .setRequired(false);

  // Van Westendorp Price Sensitivity Meter — 4 open numeric prompts
  form.addTextItem()
    .setTitle('At what monthly price would this be SO CHEAP you\'d question its quality? ($/month)')
    .setRequired(true);
  form.addTextItem()
    .setTitle('At what monthly price would it be a GREAT DEAL — clearly worth it? ($/month)')
    .setRequired(true);
  form.addTextItem()
    .setTitle('At what monthly price would it start to feel EXPENSIVE, but you\'d still consider it? ($/month)')
    .setRequired(true);
  form.addTextItem()
    .setTitle('At what monthly price would it be TOO EXPENSIVE — you wouldn\'t buy? ($/month)')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Would you prefer to pay:')
    .setChoiceValues([
      'Monthly',
      'Annual (cheaper per month)',
      'One-time purchase',
      "Wouldn't pay"
    ])
    .setRequired(true);

  // ---------- SECTION E — GROWTH LOOP & CLOSE ----------
  form.addSectionHeaderItem()
    .setTitle('Last few');

  form.addScaleItem()
    .setTitle('If a DJ friend invited you so you could see each other\'s sets, how likely are you to try it?')
    .setBounds(1, 5)
    .setLabels('Not likely', 'Very likely')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle("Anything you'd want this app to do that we haven't mentioned?")
    .setRequired(false);

  form.addTextItem()
    .setTitle('(Optional) Email — join the launch waitlist')
    .setRequired(false);

  // ---------- OUTPUT THE LINKS ----------
  var editUrl = form.getEditUrl();
  var pubUrl = form.getPublishedUrl();
  Logger.log('✅ Form created!');
  Logger.log('EDIT (you):      ' + editUrl);
  Logger.log('SHARE (DJs):     ' + pubUrl);
  Logger.log('Tip: In the editor, the "Responses" tab → green Sheets icon links results to a spreadsheet for analysis.');
}
