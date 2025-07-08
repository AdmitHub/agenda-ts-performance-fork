import { MongoClient, MongoClientOptions, Db } from 'mongodb';
import { IConnectionPoolStatus } from '../types/ConnectionPoolOptions';
export declare class ConnectionPoolManager {
    private static instances;
    private static readonly environmentConfigs;
    private mongoClient?;
    private referenceCount;
    private connectionString;
    private options;
    private constructor();
    static getInstance(connectionString: string, options?: MongoClientOptions): ConnectionPoolManager;
    private static getPoolKey;
    private mergeWithEnvironmentDefaults;
    connect(): Promise<Db>;
    private setupPoolMonitoring;
    getPoolStatus(): Promise<IConnectionPoolStatus>;
    private getEmptyMetrics;
    disconnect(): Promise<void>;
    getClient(): MongoClient | undefined;
    getReferenceCount(): number;
    static clearAllPools(): void;
}
