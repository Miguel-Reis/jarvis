/**
 * Daemon Types
 *
 * Shared type definitions for daemon services.
 */

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface Service {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ServiceStatus;
}
