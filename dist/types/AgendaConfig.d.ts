export interface IAgendaConfig {
    name?: string;
    defaultConcurrency: number;
    processEvery: number;
    maxConcurrency: number;
    defaultLockLimit: number;
    lockLimit: number;
    defaultLockLifetime: number;
    batchSize?: number;
    enableBatchProcessing?: boolean;
}
