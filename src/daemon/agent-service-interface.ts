/**
 * Common interface for agent services that can handle messages.
 * Both the main AgentService (user chat) and BackgroundAgentService
 * (heartbeat/reactions) implement this.
 */
export interface IAgentService {
  handleMessage(text: string, channel?: string): Promise<string>;
  handleHeartbeat(coalescedEvents?: string): Promise<string | null>;
}
