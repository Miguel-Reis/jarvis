/**
 * Vault Extractor — LLM-powered knowledge extraction from conversations
 *
 * Extracts entities, facts, relationships, and commitments from user/assistant
 * message pairs and persists them to the vault. Best-effort: failures never
 * block the conversation flow.
 *
 * Extraction logic is split into focused helpers:
 *   - buildExtractionPrompt()  — constructs the LLM prompt
 *   - parseExtractionResponse() — parses and validates the JSON response
 *   - extractAndStore()        — orchestrates LLM call + vault persistence
 */

import type { LLMProvider } from '../llm/provider.ts';
import { createEntity, findEntities } from './entities.ts';
import { createFact } from './facts.ts';
import { createRelationship } from './relationships.ts';
import { createCommitment } from './commitments.ts';
import { withTransaction } from './schema.ts';
import { getActiveProjectId } from './projects.ts';
import { extractGoalCompletion } from './goal-extractor.ts';

export type ExtractionResult = {
  entities: Array<{ name: string; type: string; properties?: Record<string, unknown> }>;
  facts: Array<{ subject: string; predicate: string; object: string; confidence: number }>;
  relationships: Array<{ from: string; to: string; type: string }>;
  commitments: Array<{ what: string; when_due?: string; priority?: string }>;
};

/**
 * Build extraction prompt for LLM
 */
export function buildExtractionPrompt(userMessage: string, assistantResponse: string): string {
  return `You are an expert at extracting structured information from conversations. Analyze the following conversation and extract entities, facts, relationships, and commitments.

USER MESSAGE:
${userMessage}

ASSISTANT RESPONSE:
${assistantResponse}

Extract the following information and return ONLY valid JSON (no markdown, no explanation):

{
  "entities": [
    {
      "name": "Entity name",
      "type": "person|project|tool|place|concept|event",
      "properties": {}
    }
  ],
  "facts": [
    {
      "subject": "Entity name",
      "predicate": "property_name",
      "object": "value",
      "confidence": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "from": "Entity A name",
      "to": "Entity B name",
      "type": "relationship_type"
    }
  ],
  "commitments": [
    {
      "what": "Description of commitment",
      "when_due": "ISO date string (optional)",
      "priority": "low|normal|high|critical (optional)"
    }
  ]
}

GUIDELINES:
- Extract only concrete, verifiable information
- For entities: identify people, projects, tools, places, concepts, events
- For facts: extract attributes about entities (e.g., "birthday_is", "works_at", "location_is")
- For relationships: extract connections between entities (e.g., "sister_of", "manages", "part_of")
- For commitments: extract any promises, tasks, or reminders mentioned
- Use snake_case for predicates and relationship types
- Set confidence lower (0.5-0.8) for implied or uncertain information
- If no information to extract, return empty arrays
- Respond with ONLY the JSON object, no other text`;
}

/**
 * Parse LLM response into ExtractionResult
 */
export function parseExtractionResponse(llmResponse: string): ExtractionResult {
  // Clean up response - remove markdown code blocks if present
  let cleaned = llmResponse.trim();

  // Remove markdown JSON code blocks
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate and normalize the structure
    const result: ExtractionResult = {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
    };

    return result;
  } catch (parseError) {
    const preview = cleaned.slice(0, 200);
    console.warn(
      `[Extractor] Failed to parse LLM extraction response: ${parseError instanceof Error ? parseError.message : String(parseError)}\n` +
      `Response preview: ${preview}${cleaned.length > 200 ? '…' : ''}`
    );
    // Return empty result on parse failure
    return {
      entities: [],
      facts: [],
      relationships: [],
      commitments: [],
    };
  }
}

/**
 * Parse ISO date string to timestamp, return null if invalid
 */
function parseDate(dateStr?: string): number | null {
  if (!dateStr) return null;

  try {
    const timestamp = new Date(dateStr).getTime();
    return isNaN(timestamp) ? null : timestamp;
  } catch {
    return null;
  }
}

/**
 * Validate entity type
 */
function isValidEntityType(type: string): type is 'person' | 'project' | 'tool' | 'place' | 'concept' | 'event' {
  return ['person', 'project', 'tool', 'place', 'concept', 'event'].includes(type);
}

/**
 * High-level: extract and store in vault
 */
export async function extractAndStore(
  userMessage: string,
  assistantResponse: string,
  provider?: LLMProvider
): Promise<ExtractionResult> {
  // If no provider, skip silently (extraction is best-effort)
  if (!provider) {
    console.warn('[Extractor] No LLM provider available — skipping knowledge extraction');
    return { entities: [], facts: [], relationships: [], commitments: [] };
  }

  // Skip extraction for very short exchanges that are unlikely to contain new knowledge
  // (e.g. single-word acks like "ok" / "yes" — not realistic conversations)
  const combinedLength = userMessage.length + assistantResponse.length;
  if (combinedLength < 20) {
    return { entities: [], facts: [], relationships: [], commitments: [] };
  }

  try {
    // Build prompt
    const prompt = buildExtractionPrompt(userMessage, assistantResponse);

    // Call LLM
    const response = await provider.chat([
      { role: 'user', content: prompt },
    ], {
      temperature: 0.1, // Low temperature for consistent extraction
      max_tokens: 2000,
    });

    // Parse response
    const extraction = parseExtractionResponse(response.content);

    // Store all extracted data atomically — if any step fails, nothing is committed
    const activeProject = getActiveProjectId();
    const entityMap = withTransaction(() => {
      const map = new Map<string, string>(); // name -> id

      // Store entities
      for (const entityData of extraction.entities) {
        const { name, type, properties } = entityData;

        if (!isValidEntityType(type)) {
          console.warn(`[Extractor] Invalid entity type: ${type}, skipping entity "${name}"`);
          continue;
        }

        const existing = findEntities({ name, type });
        if (existing.length > 0) {
          map.set(name, existing[0]!.id);
        } else {
          const entity = createEntity(type, name, properties, 'llm_extraction', activeProject);
          map.set(name, entity.id);
        }
      }

      // Store facts
      for (const factData of extraction.facts) {
        const { subject, predicate, object, confidence } = factData;
        const subjectId = map.get(subject);
        if (!subjectId) {
          console.warn(`[Extractor] Subject entity not found: "${subject}", skipping fact`);
          continue;
        }
        createFact(subjectId, predicate, object, {
          confidence: confidence ?? 1.0,
          source: 'llm_extraction',
        });
      }

      // Store relationships
      for (const relData of extraction.relationships) {
        const { from, to, type } = relData;
        const fromId = map.get(from);
        const toId = map.get(to);
        if (!fromId || !toId) {
          console.warn(`[Extractor] Relationship entities not found: "${from}" -> "${to}", skipping`);
          continue;
        }
        createRelationship(fromId, toId, type);
      }

      // Store commitments
      for (const commitmentData of extraction.commitments) {
        const { what, when_due, priority } = commitmentData;
        createCommitment(what, {
          when_due: parseDate(when_due) ?? undefined,
          priority: (priority as any) ?? 'normal',
          context: 'Extracted from conversation',
          created_from: 'llm_extraction',
          project_id: activeProject,
        });
      }

      return map;
    });

    const totalExtracted = extraction.entities.length + extraction.facts.length
      + extraction.relationships.length + extraction.commitments.length;
    if (totalExtracted > 0) {
      console.log(
        `[Extractor] Stored: ${extraction.entities.length} entities, ` +
        `${extraction.facts.length} facts, ${extraction.relationships.length} relationships, ` +
        `${extraction.commitments.length} commitments`
      );
    }

    return extraction;
  } catch (error) {
    console.error('[Extractor] Failed to extract and store knowledge:', error);

    // Return empty result on error
    return {
      entities: [],
      facts: [],
      relationships: [],
      commitments: [],
    };
  }
}

// ── Re-export for backward compatibility ─────────────────────────────

export { extractGoalCompletion };
