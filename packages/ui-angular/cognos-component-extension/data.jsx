// Cognos — mock data. Privacy / institutional flavour, brand voice (spare, no chatter).

const MODELS = [
  { id: 'cognos-sov', name: 'Cognos Sovereign', tag: 'ON-PREM', desc: 'Runs entirely on Swiss on-prem compute. Nothing leaves the jurisdiction.', ctx: '200K', host: 'Zürich · on-prem' },
  { id: 'cognos-pro', name: 'Cognos Pro', tag: 'SWISS CLOUD', desc: 'Frontier reasoning. Processed in Swiss cloud, re-encrypted on return.', ctx: '1M', host: 'Swiss cloud' },
  { id: 'cognos-fast', name: 'Cognos Fast', tag: 'SWISS CLOUD', desc: 'Low-latency model for quick drafts and everyday questions.', ctx: '128K', host: 'Swiss cloud' },
  { id: 'cognos-local', name: 'Cognos Local', tag: 'THIS DEVICE', desc: 'Small model running fully in your browser. Plaintext never leaves the device.', ctx: '32K', host: 'This device' },
];

const SKILLS = [
  { id: 'redact', name: 'Auto-redact', icon: 'eraser', desc: 'Strips names, IDs and locations before the model sees them.', on: true },
  { id: 'cite', name: 'Cite sources', icon: 'quote', desc: 'Every claim is footnoted to a retrievable source.', on: true },
  { id: 'legal', name: 'Statute lookup', icon: 'scale', desc: 'Cross-references Swiss federal & cantonal law.', on: false },
  { id: 'translate', name: 'DE · FR · IT', icon: 'languages', desc: 'Answers in any Swiss national language.', on: false },
  { id: 'tables', name: 'Structured output', icon: 'table', desc: 'Returns tables, CSV and JSON on request.', on: false },
  { id: 'lesson', name: 'Lesson planner', icon: 'graduation-cap', desc: 'Curriculum-aligned plans for the classroom.', on: false },
];

const PROMPTS = [
  { id: 'p1', name: 'Brief from documents', icon: 'file-text', body: 'Summarise the attached documents into a one-page brief — key facts, risks, and recommended action. Cite each point.' },
  { id: 'p2', name: 'Redact & share', icon: 'eraser', body: 'Rewrite this so it can be shared externally: remove personal data, internal references and anything classified.' },
  { id: 'p3', name: 'Devil\u2019s advocate', icon: 'swords', body: 'Argue the strongest case against the position below. Be specific and unsparing.' },
  { id: 'p4', name: 'Plain-language explainer', icon: 'message-square', body: 'Explain the following for a citizen with no background in the subject. Short sentences, no jargon.' },
  { id: 'p5', name: 'Lesson plan', icon: 'graduation-cap', body: 'Build a 45-minute lesson plan on the topic below for the given year group, with objectives and an exit task.' },
];

// People who can decrypt (sharing). fingerprint = key id.
const PEOPLE = [
  { id: 'me', name: 'You', email: 'you@etat.ge.ch', role: 'Owner', fp: '9F2A · 7C41 · DD08', you: true },
  { id: 'u1', name: 'L. Moreau', email: 'l.moreau@etat.ge.ch', role: 'Can decrypt', fp: 'A1B4 · 22E9 · 50CF' },
  { id: 'u2', name: 'Policy Unit', email: 'policy@etat.ge.ch', role: 'Can decrypt', fp: '7D30 · 9911 · 0AAB', group: true },
];

const PROJECTS = [
  {
    id: 'pol', name: 'Cantonal Policy', icon: 'landmark', members: 4,
    instr: 'Formal register. Cite Swiss federal and cantonal sources. Never include personal data in outputs.',
    chats: [
      { id: 'c1', title: 'Data Protection Act — impact', model: 'cognos-sov', pinned: true, when: '2h' },
      { id: 'c2', title: 'Consultation response draft', model: 'cognos-pro', when: 'Yesterday' },
      { id: 'c3', title: 'Cross-border data transfer memo', model: 'cognos-sov', when: 'Mon' },
    ],
  },
  {
    id: 'edu', name: 'Lycée — Year 11', icon: 'graduation-cap', members: 2,
    instr: 'Plain language. Curriculum-aligned. Encourage reasoning over answers.',
    chats: [
      { id: 'c4', title: 'Photosynthesis lesson plan', model: 'cognos-fast', when: 'Tue' },
      { id: 'c5', title: 'Marking rubric — essays', model: 'cognos-fast', when: 'Last week' },
    ],
  },
  {
    id: 'pers', name: 'Private', icon: 'lock', members: 1,
    instr: 'Casual. This project never leaves my devices — Cognos Local only.',
    chats: [
      { id: 'c6', title: 'Health questions', model: 'cognos-local', when: '3d' },
      { id: 'c7', title: 'Trip planning — Ticino', model: 'cognos-local', when: 'Last week' },
    ],
  },
];

const RECENTS = [
  { id: 'r0', title: 'FOI request — draft reply', model: 'cognos-sov', when: '9:14' },
  { id: 'r1', title: 'Encryption key rotation', model: 'cognos-sov', when: '1h' },
  { id: 'r2', title: 'Summarise procurement PDF', model: 'cognos-pro', when: '4h' },
  { id: 'r3', title: 'FOI request triage', model: 'cognos-pro', when: 'Yesterday' },
  { id: 'r4', title: 'Translate notice → FR, IT', model: 'cognos-fast', when: 'Yesterday' },
  { id: 'r5', title: 'Draft staff guidance', model: 'cognos-fast', when: 'Wed' },
];

// A worked conversation shown in the main chat.
const SAMPLE_THREAD = {
  id: 'c1', title: 'Data Protection Act — impact', projectId: 'pol', model: 'cognos-sov',
  messages: [
    { role: 'user', text: 'We\u2019re drafting guidance on the revised Federal Act on Data Protection. What changes most for a cantonal authority handling residents\u2019 data?' },
    { role: 'assistant', text: 'Three shifts matter most for a cantonal authority:\n\n**01 — Accountability moves up front.** You must be able to demonstrate compliance, not just assert it. Keep a register of processing activities and document the legal basis for each.\n\n**02 — Privacy by design becomes a duty, not a courtesy.** New systems must default to data minimisation. A DPIA is required wherever processing is likely to be high-risk — large registers, profiling, cross-border flows.\n\n**03 — Breach notification has teeth.** Report to the FDPIC as soon as practicable where risk to the data subject is high.\n\nWould you like this as a one-page brief for the unit, or a checklist your teams can work against?', cites: 2 },
    { role: 'user', text: 'A checklist. Keep it to the cantonal context.' },
  ],
};

Object.assign(window, { MODELS, SKILLS, PROMPTS, PEOPLE, PROJECTS, RECENTS, SAMPLE_THREAD });
