/**
 * The assessment areas, in one place.
 *
 * This list previously lived in nine files — the question bank, the shortlist
 * and results pages, three test pages, and the import/export routes — each with
 * its own copy of the values and labels. Adding an area meant finding all nine,
 * and the results export silently dropped any area whose column nobody
 * remembered to add.
 *
 * Order here is the order shown in every dropdown. `AssessmentArea` in
 * prisma/schema.prisma is the source of truth for what the database accepts;
 * keep the two in step.
 */
export const AREAS = [
  'APTITUDE',
  'DOTNET',
  'COMMUNICATION',
  'AI',
  'PYTHON',
  'JAVA',
  'JAVASCRIPT',
  'SQL',
  'API',
  'CLOUD',
  'GENAI',
  'DEPLOYMENT',
] as const

export type Area = (typeof AREAS)[number]

export const AREA_LABELS: Record<string, string> = {
  APTITUDE: 'Aptitude',
  DOTNET: '.NET',
  COMMUNICATION: 'Communication',
  AI: 'AI',
  PYTHON: 'Python',
  JAVA: 'Java',
  JAVASCRIPT: 'JavaScript',
  SQL: 'SQL',
  API: 'APIs',
  CLOUD: 'Cloud (AWS / Azure / GCP)',
  GENAI: 'Generative AI / LLMs',
  DEPLOYMENT: 'Deployment / Integration',
}

/** Compact labels for dense tables, where the full name would wrap. */
export const AREA_LABELS_SHORT: Record<string, string> = {
  ...AREA_LABELS,
  COMMUNICATION: 'Comm.',
  CLOUD: 'Cloud',
  GENAI: 'GenAI',
  DEPLOYMENT: 'Deploy',
}

/** `{ value, label }` pairs, for the test-builder selects. */
export const AREA_OPTIONS = AREAS.map(value => ({ value, label: AREA_LABELS[value] }))

export const areaLabel = (area: string) => AREA_LABELS[area] ?? area
