export type UserProfileQuestionId =
  | 'preferred_name'
  | 'pronouns'
  | 'location_timezone'
  | 'work_role'
  | 'interests'
  | 'current_projects'
  | 'goals_next_90_days'
  | 'communication_preferences'
  | 'pet_peeves'
  | 'routines_constraints'
  | 'tools_stack'
  | 'important_people'
  | 'anything_else';

export type UserProfileQuestion = {
  id: UserProfileQuestionId;
  step: number;
  step_title: string;
  label: string;
  prompt: string;
  description: string;
  placeholder?: string;
  multiline?: boolean;
};

export type UserProfileRecord = {
  version: 1;
  answers: Partial<Record<UserProfileQuestionId, string>>;
  qualities: string[];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

export const USER_PROFILE_SETTING_KEY = 'user.profile.v1';

export const USER_PROFILE_QUESTIONS: UserProfileQuestion[] = [
  {
    id: 'preferred_name',
    step: 1,
    step_title: 'Identity',
    label: 'Preferred Name',
    prompt: 'What should JARVIS call you?',
    description: 'Use the name you actually want the assistant to use in conversation.',
    placeholder: 'e.g. Alex',
  },
  {
    id: 'pronouns',
    step: 1,
    step_title: 'Identity',
    label: 'Pronouns',
    prompt: 'What pronouns do you want JARVIS to use, if any?',
    description: 'Optional, but useful for natural and respectful replies.',
    placeholder: 'e.g. she/her, he/him, they/them',
  },
  {
    id: 'location_timezone',
    step: 1,
    step_title: 'Identity',
    label: 'Location / Timezone',
    prompt: 'What location or timezone should JARVIS keep in mind?',
    description: 'This helps with scheduling, recommendations, and time references.',
    placeholder: 'e.g. Miami, FL / America/New_York',
  },
  {
    id: 'work_role',
    step: 1,
    step_title: 'Identity',
    label: 'Work / Role',
    prompt: 'What do you do, or what roles do you usually operate in?',
    description: 'Career, studies, side hustles, and the kinds of responsibilities you handle.',
    placeholder: 'e.g. founder, student, engineer, creator',
    multiline: true,
  },
  {
    id: 'interests',
    step: 2,
    step_title: 'Interests',
    label: 'Interests',
    prompt: 'What are you genuinely interested in?',
    description: 'Topics, hobbies, communities, subjects, and rabbit holes you care about.',
    placeholder: 'e.g. AI, fitness, cars, anime, startups',
    multiline: true,
  },
  {
    id: 'current_projects',
    step: 2,
    step_title: 'Interests',
    label: 'Current Projects',
    prompt: 'What are you actively working on right now?',
    description: 'Projects, businesses, classes, routines, or personal efforts already in motion.',
    placeholder: 'What is already on your plate?',
    multiline: true,
  },
  {
    id: 'goals_next_90_days',
    step: 2,
    step_title: 'Interests',
    label: 'Goals',
    prompt: 'What do you want to accomplish over the next 30 to 90 days?',
    description: 'Short-term outcomes that JARVIS should optimize around.',
    placeholder: 'What should JARVIS help push forward?',
    multiline: true,
  },
  {
    id: 'communication_preferences',
    step: 3,
    step_title: 'Working Style',
    label: 'Communication Preferences',
    prompt: 'How do you want JARVIS to communicate with you?',
    description: 'Tone, directness, detail level, structure, reminders, and how much pushback you want.',
    placeholder: 'e.g. blunt, concise, actionable, no fluff',
    multiline: true,
  },
  {
    id: 'pet_peeves',
    step: 3,
    step_title: 'Working Style',
    label: 'Pet Peeves',
    prompt: 'What annoys you or wastes your time?',
    description: 'Patterns to avoid in planning, writing, or collaboration.',
    placeholder: 'What should JARVIS not do?',
    multiline: true,
  },
  {
    id: 'routines_constraints',
    step: 3,
    step_title: 'Working Style',
    label: 'Routines & Constraints',
    prompt: 'What routines, limits, or constraints should JARVIS know?',
    description: 'Schedule constraints, health habits, budget limits, availability, or boundaries.',
    placeholder: 'Anything that should shape reminders or recommendations',
    multiline: true,
  },
  {
    id: 'tools_stack',
    step: 4,
    step_title: 'Context',
    label: 'Tools & Stack',
    prompt: 'What tools, apps, or technical stack do you use most?',
    description: 'Software, devices, languages, frameworks, and workflows JARVIS should assume.',
    placeholder: 'e.g. GitHub, Bun, React, Notion, Telegram, Windows',
    multiline: true,
  },
  {
    id: 'important_people',
    step: 4,
    step_title: 'Context',
    label: 'Important People',
    prompt: 'Who are the important people, teams, or audiences around you?',
    description: 'Managers, cofounders, clients, family, friends, or communities that matter in your context.',
    placeholder: 'Who should JARVIS keep in mind?',
    multiline: true,
  },
  {
    id: 'anything_else',
    step: 4,
    step_title: 'Context',
    label: 'Anything Else',
    prompt: 'What else should JARVIS know to be useful from day one?',
    description: 'Any extra context that does not fit the earlier prompts.',
    placeholder: 'Anything important you want carried forward',
    multiline: true,
  },
];

export function createEmptyUserProfile(): UserProfileRecord {
  const now = Date.now();
  return {
    version: 1,
    answers: {},
    qualities: [],
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}

export function normalizeUserProfileAnswers(
  input: Record<string, unknown>,
): Partial<Record<UserProfileQuestionId, string>> {
  const answers: Partial<Record<UserProfileQuestionId, string>> = {};

  for (const question of USER_PROFILE_QUESTIONS) {
    const raw = input[question.id];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    answers[question.id] = value;
  }

  return answers;
}

export function countAnsweredUserProfileQuestions(profile: UserProfileRecord | null): number {
  if (!profile) return 0;
  return USER_PROFILE_QUESTIONS.filter((question) => Boolean(profile.answers[question.id]?.trim())).length;
}

export function hasUserProfile(profile: UserProfileRecord | null): boolean {
  return countAnsweredUserProfileQuestions(profile) > 0;
}

/**
 * Preset profiles for quick onboarding
 */
export const USER_PROFILE_PRESETS: Record<string, Partial<Record<UserProfileQuestionId, string>>> = {
  coder: {
    preferred_name: 'Developer',
    pronouns: '',
    location_timezone: '',
    work_role: 'Full-stack software engineer / developer. I build web applications, APIs, and automation tools.',
    interests: 'Software architecture, clean code, developer tools, AI/LLMs, automation, open source',
    current_projects: 'Active development on web applications, backend services, and developer tooling',
    goals_next_90_days: 'Ship clean, well-tested code. Reduce technical debt. Build scalable systems.',
    communication_preferences: 'Direct, technical, and concise. Show code examples. Explain trade-offs briefly. Skip fluff.',
    pet_peeves: 'Verbose explanations of obvious things. Magic abstractions without docs. Tests that dont test anything meaningful.',
    routines_constraints: 'Deep work blocks of 90min. Prefer async communication. Available during typical dev hours.',
    tools_stack: 'TypeScript, Bun, Node.js, React, Next.js, PostgreSQL, SQLite, Docker, Git, Linux, VS Code',
    important_people: 'Development team, code reviewers, project stakeholders',
    anything_else: 'I value: readability over cleverness, explicit over implicit, simple over complex. Security is non-negotiable.',
  },
  metin2_dev: {
    preferred_name: 'Metin2 Developer',
    pronouns: '',
    location_timezone: '',
    work_role: 'Metin2 private server developer. I compile, modify, and maintain Metin2 server sources (EPHY/MALENTENDED), create Lua quests, optimize databases, and deploy on FreeBSD.',
    interests: 'Metin2 private servers, C++ game programming, reverse engineering, Lua quest scripting, MySQL optimization, FreeBSD server administration, EPHY/MALENTENDED sources, game file decryption (.dat/.epk)',
    current_projects: 'Building a complete Metin2 private server from scratch - compiling Game99/DB/Channel sources, setting up FreeBSD VM, creating custom quests, configuring channels and server files',
    goals_next_90_days: 'Have a fully functional Metin2 server running with custom features, stable database, working client-server connection, and beta-ready environment for testing',
    communication_preferences: 'Direto e técnico. Ler os ficheiros das sources antes de sugerir soluções. Mostrar código real das minhas sources. Não explicar o óbvio.',
    pet_peeves: 'Inventar código que não existe nas minhas sources. Dar respostas genéricas sem ler os ficheiros. Confundir structures do Metin2 com web development.',
    routines_constraints: 'Compilações demoradas exigem paciência. Testar no FreeBSD após mudanças. Backup antes de modificar core files. Work sessions focused em compilação e debug.',
    tools_stack: 'C++, Visual Studio 2015-2022, FreeBSD 12-14, MySQL/MariaDB, Python 3, Lua 5.1, EPHY Source v45/v55, MALENTENDED Source, Putty, WinSCP, Navicat, HeidiSQL, Metin2 Client, Git, WSL2, EterNix, ETER Manager',
    important_people: 'Comunidade Metin2 PT/BR, contributors EPHY/MALENTENDED, beta testers, jogadores do servidor',
    anything_else: 'Sempre verificar estrutura /usr/home/metin2/. Entender arquitetura: DBServer → Channel → Game99. Ler files antes de sugerir: /src/game, /src/db, /src/lib. Quests em /usr/home/metin2/quest. Scripts Python para automação de tasks.',
  },
  data_scientist: {
    preferred_name: 'Data Scientist',
    pronouns: '',
    location_timezone: '',
    work_role: 'Data scientist / ML engineer. I build models, analyze data, and create insights.',
    interests: 'Machine learning, statistics, data visualization, Python, AI research',
    current_projects: 'Model training, data pipelines, exploratory analysis, feature engineering',
    goals_next_90_days: 'Deploy production ML models. Improve model accuracy. Build robust data pipelines.',
    communication_preferences: 'Technical but accessible. Show data and evidence. Explain statistical concepts clearly.',
    pet_peeves: 'Overpromising on model capabilities. Ignoring data quality issues. Poor documentation.',
    routines_constraints: 'Need long focus blocks for model training. Flexible schedule.',
    tools_stack: 'Python, Jupyter, pandas, scikit-learn, PyTorch, TensorFlow, SQL, AWS, Git',
    important_people: 'Research team, data engineers, product managers',
    anything_else: 'I value reproducibility, clear metrics, and honest uncertainty estimates.',
  },
  founder: {
    preferred_name: 'Founder',
    pronouns: '',
    location_timezone: '',
    work_role: 'Startup founder / entrepreneur. Building and scaling a business.',
    interests: 'Product development, growth, fundraising, team building, strategy',
    current_projects: 'Product launches, investor meetings, hiring, market validation',
    goals_next_90_days: 'Achieve key milestones. Close funding round. Grow user base.',
    communication_preferences: 'Executive summary style. Actionable insights. Flag risks early.',
    pet_peeves: 'Long meetings without agenda. Optimism without data. Slow decision making.',
    routines_constraints: 'Early mornings. Back-to-back meetings. Need focus time for strategy.',
    tools_stack: 'Notion, Slack, Linear, GitHub, Figma, Google Workspace, Calendly',
    important_people: 'Co-founders, investors, early customers, key hires',
    anything_else: 'Speed matters. Perfect is enemy of good. Focus on what moves the needle.',
  },
};

export function applyUserProfilePreset(presetId: string): Partial<Record<UserProfileQuestionId, string>> | null {
  return USER_PROFILE_PRESETS[presetId] ?? null;
}

export function formatUserProfileForPrompt(profile: UserProfileRecord | null): string | undefined {
  if (!profile) return undefined;

  const lines: string[] = [];
  for (const question of USER_PROFILE_QUESTIONS) {
    const answer = profile.answers[question.id]?.trim();
    if (!answer) continue;
    lines.push(`- ${question.label}: |`);
    lines.push(indentPromptValue(answer));
  }

  if (profile.qualities && profile.qualities.length > 0) {
    lines.push('- Qualities & Specializations:');
    for (const quality of profile.qualities) {
      lines.push(`  - ${quality}`);
    }
  }

  if (lines.length === 0) return undefined;
  return lines.join('\n');
}

function indentPromptValue(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
