#!/usr/bin/env bun
/**
 * Memory Cleanup Script
 *
 * Limpa dados antigos da base de dados do Jarvis:
 * - Observações antigas (>30 dias)
 * - Sessions de awareness expiradas
 * - Conversas antigas
 * - Facts sem referência
 * - Compacta a base de dados
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), '.jarvis', 'jarvis.db');

// Configuração de retenção (em dias)
const RETENTION = {
  observations: 30,      // Observações: 30 dias
  awareness_sessions: 7, // Sessions de awareness: 7 dias
  conversations: 90,     // Conversas: 90 dias
  facts: 60,             // Facts: 60 dias
};

console.log('🧹 Jarvis Memory Cleanup');
console.log('========================\n');

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

// 1. Limpar observações antigas
console.log('📋 Limpando observações antigas...');
const beforeObs = db.query('SELECT COUNT(*) as c FROM observations').get() as { c: number };
const obsDate = new Date();
obsDate.setDate(obsDate.getDate() - RETENTION.observations);

const deleteObs = db.prepare(`
  DELETE FROM observations
  WHERE created_at < ?
`);
deleteObs.run(obsDate.getTime());

const afterObs = db.query('SELECT COUNT(*) as c FROM observations').get() as { c: number };
console.log(`   Antes: ${beforeObs.c} | Depois: ${afterObs.c} | Removidas: ${beforeObs.c - afterObs.c}`);

// 2. Limpar sessions de awareness expiradas
console.log('\n🧠 Limpando sessions de awareness expiradas...');
const beforeSessions = db.query('SELECT COUNT(*) as c FROM awareness_sessions').get() as { c: number };
const sessionDate = new Date();
sessionDate.setDate(sessionDate.getDate() - RETENTION.awareness_sessions);

const deleteSessions = db.prepare(`
  DELETE FROM awareness_sessions
  WHERE started_at < ?
`);
deleteSessions.run(sessionDate.getTime());

const afterSessions = db.query('SELECT COUNT(*) as c FROM awareness_sessions').get() as { c: number };
console.log(`   Antes: ${beforeSessions.c} | Depois: ${afterSessions.c} | Removidas: ${beforeSessions.c - afterSessions.c}`);

// 3. Limpar suggestions antigas de awareness
console.log('\n💡 Limpando suggestions antigas de awareness...');
const beforeSuggestions = db.query('SELECT COUNT(*) as c FROM awareness_suggestions').get() as { c: number };

const deleteSuggestions = db.prepare(`
  DELETE FROM awareness_suggestions
  WHERE created_at < ?
`);
deleteSuggestions.run(sessionDate.getTime());

const afterSuggestions = db.query('SELECT COUNT(*) as c FROM awareness_suggestions').get() as { c: number };
console.log(`   Antes: ${beforeSuggestions.c} | Depois: ${afterSuggestions.c} | Removidas: ${beforeSuggestions.c - afterSuggestions.c}`);

// 4. Limpar facts órfãos/antigos
console.log('\n📌 Limpando facts antigos...');
const beforeFacts = db.query('SELECT COUNT(*) as c FROM facts').get() as { c: number };
const factsDate = new Date();
factsDate.setDate(factsDate.getDate() - RETENTION.facts);

const deleteFacts = db.prepare(`
  DELETE FROM facts
  WHERE created_at < ?
`);
deleteFacts.run(factsDate.getTime());

const afterFacts = db.query('SELECT COUNT(*) as c FROM facts').get() as { c: number };
console.log(`   Antes: ${beforeFacts.c} | Depois: ${afterFacts.c} | Removidos: ${beforeFacts.c - afterFacts.c}`);

// 5. Limpar conversas antigas (manter últimas 5)
console.log('\n💬 Limpando conversas antigas...');
const beforeConv = db.query('SELECT COUNT(*) as c FROM conversations').get() as { c: number };

const deleteConv = db.prepare(`
  DELETE FROM conversations
  WHERE id NOT IN (
    SELECT id FROM conversations
    ORDER BY updated_at DESC
    LIMIT 5
  )
`);
deleteConv.run();

const afterConv = db.query('SELECT COUNT(*) as c FROM conversations').get() as { c: number };
console.log(`   Antes: ${beforeConv.c} | Depois: ${afterConv.c} | Removidas: ${beforeConv.c - afterConv.c}`);

// 6. Limpar mensagens de conversas removidas
console.log('\n📝 Limpando mensagens órfãs...');
const beforeMsgs = db.query('SELECT COUNT(*) as c FROM conversation_messages').get() as { c: number };

const deleteOrphanMsgs = db.prepare(`
  DELETE FROM conversation_messages
  WHERE conversation_id NOT IN (SELECT id FROM conversations)
`);
deleteOrphanMsgs.run();

const afterMsgs = db.query('SELECT COUNT(*) as c FROM conversation_messages').get() as { c: number };
console.log(`   Antes: ${beforeMsgs.c} | Depois: ${afterMsgs.c} | Removidas: ${beforeMsgs.c - afterMsgs.c}`);

// 7. Vacuum para compactar base de dados
console.log('\n🗜️ Compactando base de dados (VACUUM)...');
const beforeSize = Bun.file(DB_PATH).size;
db.exec('VACUUM');
const afterSize = Bun.file(DB_PATH).size;

const savedKB = Math.round((beforeSize - afterSize) / 1024);
console.log(`   Antes: ${Math.round(beforeSize / 1024 / 1024)} MB | Depois: ${Math.round(afterSize / 1024 / 1024)} MB | Economizado: ${savedKB} KB`);

// 8. Analyze para otimizar queries
console.log('\n📊 Otimizando índices (ANALYZE)...');
db.exec('ANALYZE');

console.log('\n✅ Limpeza concluída!');
console.log('\n📊 Resumo final:');
console.log(`   - Observações: ${afterObs.c}`);
console.log(`   - Awareness sessions: ${afterSessions.c}`);
console.log(`   - Awareness suggestions: ${afterSuggestions.c}`);
console.log(`   - Facts: ${afterFacts.c}`);
console.log(`   - Conversas: ${afterConv.c}`);
console.log(`   - Tamanho DB: ${Math.round(afterSize / 1024 / 1024)} MB`);

db.close();
