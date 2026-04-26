/**
 * YAML Export/Import for workflows
 */

import YAML from 'yaml';
import type { Workflow, WorkflowVersion, WorkflowDefinition, WorkflowNode, WorkflowEdge } from './types.ts';

export type WorkflowYaml = {
  name: string;
  description: string;
  authority_level: number;
  tags: string[];
  settings: WorkflowDefinition['settings'];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables?: Record<string, unknown>;
};

export function exportWorkflowYaml(
  workflow: Workflow,
  version: WorkflowVersion,
  variables: Record<string, unknown>,
): string {
  const doc: WorkflowYaml = {
    name: workflow.name,
    description: workflow.description,
    authority_level: workflow.authority_level,
    tags: workflow.tags,
    settings: version.definition.settings,
    nodes: version.definition.nodes,
    edges: version.definition.edges,
    variables: Object.keys(variables).length > 0 ? variables : undefined,
  };

  return YAML.stringify(doc, { indent: 2 });
}

export function importWorkflowYaml(yamlText: string): {
  name: string;
  description: string;
  authority_level: number;
  tags: string[];
  definition: WorkflowDefinition;
  variables: Record<string, unknown>;
} {
  const doc = YAML.parse(yamlText) as WorkflowYaml;

  return {
    name: doc.name,
    description: doc.description ?? '',
    authority_level: doc.authority_level ?? 3,
    tags: doc.tags ?? [],
    definition: {
      nodes: doc.nodes,
      edges: doc.edges,
      settings: doc.settings,
    },
    variables: doc.variables ?? {},
  };
}

export type VersionDiff = {
  nodesAdded: string[];
  nodesRemoved: string[];
  nodesModified: string[];
  edgesAdded: string[];
  edgesRemoved: string[];
  settingsChanged: string[];
};

export function diffVersions(
  v1: WorkflowDefinition,
  v2: WorkflowDefinition,
): VersionDiff {
  const v1NodeIds = new Set(v1.nodes.map(n => n.id));
  const v2NodeIds = new Set(v2.nodes.map(n => n.id));
  const v1EdgeIds = new Set(v1.edges.map(e => e.id));
  const v2EdgeIds = new Set(v2.edges.map(e => e.id));

  const nodesAdded = [...v2NodeIds].filter(id => !v1NodeIds.has(id));
  const nodesRemoved = [...v1NodeIds].filter(id => !v2NodeIds.has(id));
  const nodesModified: string[] = [];

  // Check modified nodes (same ID, different config/type/label)
  const v1NodeMap = new Map(v1.nodes.map(n => [n.id, n]));
  for (const n2 of v2.nodes) {
    const n1 = v1NodeMap.get(n2.id);
    if (n1 && JSON.stringify(n1) !== JSON.stringify(n2)) {
      nodesModified.push(n2.id);
    }
  }

  const edgesAdded = [...v2EdgeIds].filter(id => !v1EdgeIds.has(id));
  const edgesRemoved = [...v1EdgeIds].filter(id => !v2EdgeIds.has(id));

  const settingsChanged: string[] = [];
  for (const key of Object.keys(v2.settings) as (keyof typeof v2.settings)[]) {
    if (v1.settings[key] !== v2.settings[key]) {
      settingsChanged.push(key);
    }
  }

  return { nodesAdded, nodesRemoved, nodesModified, edgesAdded, edgesRemoved, settingsChanged };
}
