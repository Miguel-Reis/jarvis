import { test, expect, beforeEach } from 'bun:test';
import { initDatabase } from './schema.ts';
import { createEntity } from './entities.ts';
import { createFact } from './facts.ts';
import { createRelationship } from './relationships.ts';
import { saveUserProfile } from './user-profile.ts';
import {
  extractSearchTerms,
  retrieveForMessage,
  formatKnowledgeContext,
  getKnowledgeForMessage,
} from './retrieval.ts';

beforeEach(() => {
  initDatabase(':memory:');
});

// --- extractSearchTerms ---

test('extractSearchTerms filters stopwords', () => {
  const terms = extractSearchTerms('Where does John work at Google?');
  expect(terms).toContain('john');
  expect(terms).toContain('google');
  expect(terms).not.toContain('where');
  expect(terms).not.toContain('does');
  expect(terms).not.toContain('at');
});

test('extractSearchTerms deduplicates', () => {
  const terms = extractSearchTerms('John and John went to Google Google');
  const johnCount = terms.filter(t => t === 'john').length;
  expect(johnCount).toBe(1);
});

test('extractSearchTerms handles empty input', () => {
  expect(extractSearchTerms('')).toEqual([]);
  expect(extractSearchTerms('the is a')).toEqual([]);
});

// --- retrieveForMessage ---

test('retrieveForMessage finds entities by name', async () => {
  createEntity('person', 'John', { role: 'engineer' });
  createEntity('person', 'Anna');

  const profiles = await retrieveForMessage('Tell me about John');
  expect(profiles.length).toBe(1);
  expect(profiles[0]!.entity.name).toBe('John');
});

test('retrieveForMessage finds entities via fact objects', async () => {
  const john = createEntity('person', 'John');
  createFact(john.id, 'works_at', 'Google');

  // Search for "Google" — should find John because he has a fact with object "Google"
  const profiles = await retrieveForMessage('What do you know about Google?');
  expect(profiles.length).toBeGreaterThanOrEqual(1);
  const names = profiles.map(p => p.entity.name);
  expect(names).toContain('John');
});

test('retrieveForMessage includes facts for matched entities', async () => {
  const john = createEntity('person', 'John');
  createFact(john.id, 'works_at', 'Google');
  createFact(john.id, 'birthday', 'March 15');

  const profiles = await retrieveForMessage('Tell me about John');
  expect(profiles.length).toBe(1);
  expect(profiles[0]!.facts.length).toBe(2);
});

test('retrieveForMessage includes relationships', async () => {
  const john = createEntity('person', 'John');
  const google = createEntity('concept', 'Google');
  createRelationship(john.id, google.id, 'works_at');

  const profiles = await retrieveForMessage('What about John?');
  expect(profiles.length).toBeGreaterThanOrEqual(1);

  const johnProfile = profiles.find(p => p.entity.name === 'John');
  expect(johnProfile).toBeDefined();
  expect(johnProfile!.relationships.length).toBeGreaterThanOrEqual(1);
});

test('retrieveForMessage returns empty for irrelevant query', async () => {
  createEntity('person', 'John');
  const profiles = await retrieveForMessage('the is a');
  expect(profiles.length).toBe(0);
});

test('retrieveForMessage includes current user profile for self queries', async () => {
  saveUserProfile({
    preferred_name: 'Alex',
    interests: 'AI, cars',
  });

  const profiles = await retrieveForMessage('What do you know about me?');
  expect(profiles.length).toBeGreaterThanOrEqual(1);
  expect(profiles[0]!.entity.name).toBe('Alex');
  expect(profiles[0]!.facts.some((fact) => fact.predicate === 'interests' && fact.object === 'AI, cars')).toBe(true);
});

// --- formatKnowledgeContext ---

test('formatKnowledgeContext formats entity with facts', async () => {
  const john = createEntity('person', 'John');
  createFact(john.id, 'works_at', 'Google');

  const profiles = await retrieveForMessage('John');
  const context = formatKnowledgeContext(profiles);

  expect(context).toContain('**John** (person)');
  expect(context).toContain('works_at: Google');
});

test('formatKnowledgeContext returns empty for no profiles', () => {
  expect(formatKnowledgeContext([])).toBe('');
});

// --- getKnowledgeForMessage (integration) ---

test('getKnowledgeForMessage end-to-end', async () => {
  const john = createEntity('person', 'John');
  createFact(john.id, 'works_at', 'Google');
  createFact(john.id, 'location', 'San Francisco');

  const anna = createEntity('person', 'Anna');
  createFact(anna.id, 'sister_of', 'John');

  const context = await getKnowledgeForMessage('Where does John live?');
  expect(context).toContain('John');
  expect(context).toContain('works_at: Google');
  expect(context).toContain('location: San Francisco');
});

test('getKnowledgeForMessage handles no matches gracefully', async () => {
  const context = await getKnowledgeForMessage('Tell me about quantum physics');
  expect(context).toBe('');
});
